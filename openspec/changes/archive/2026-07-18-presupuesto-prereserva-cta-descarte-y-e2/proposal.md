# Change: presupuesto-prereserva-cta-descarte-y-e2

> Change **no-US** (UX + feature + bugfix) sobre la fase `pre_reserva` de la RESERVA.
> Agrupa tres workstreams independientes que comparten superficie (la sección "Acciones"
> de la ficha en `pre_reserva` y el disparo del email E2 del presupuesto) y por eso se
> abren en un solo change trazable.
>
> Branch (Step 0): `feature/presupuesto-prereserva-cta-descarte-e2` (desde `master`).
> Capabilities afectadas: `confirmacion`, `consultas`, `comunicaciones`, `bloqueo-fecha`.

## Why

La fase `pre_reserva` de la ficha tiene tres carencias detectadas en uso real:

1. **CTA de confirmación poco visible (UX)**: el botón "Confirmar pago de señal" —la acción
   que hace avanzar el negocio— aparece **después** de "Editar presupuesto" y usa el color
   secundario `brand-primary` (terracota). El patrón del proyecto reserva el **verde**
   (`accent-success`) para el CTA que avanza de estado (así lo hace "Generar presupuesto" en
   `consulta`). El gestor no distingue la acción principal de la secundaria.

2. **Falta la acción "Descartar pre-reserva" (feature)**: hoy un lead que llegó a
   `pre_reserva` pero no paga la señal solo puede caducar por TTL (A5, US-012). No existe una
   acción **manual** que el gestor pueda aplicar para cerrar la pre-reserva, liberar la fecha
   y promover la cola de inmediato. Es el espejo, en `pre_reserva`, de "Marcar como descartada
   por cliente" (US-013) que ya existe en `consulta`.

3. **El email E2 (presupuesto enviado) no llega al cliente (bugfix)**: la plantilla E2 está
   **diseñada pero inactiva** (`CODIGOS_DIFERIDOS`, render placeholder "(pendiente de
   cableado)", `activa: false`) aunque su trigger post-commit (`DispararE2Adapter`) SÍ está
   cableado desde US-014. Resultado: al generar el presupuesto se traza una `COMUNICACION` E2
   pero con contenido placeholder y —cuando lleva adjunto— puede quedar en `fallido` sin log
   claro. El cliente no recibe el presupuesto.

## What Changes

### A — CTA "Confirmar pago de señal" verde y primero (solo frontend, sin contrato)

- En la sección "Acciones" de `pre_reserva`, "Confirmar pago de señal" pasa a ser la
  **primera** acción y usa el **verde** del sistema (`accent-success` /
  `accent-success-foreground`, #5f7d52), el mismo token que "Generar presupuesto".
- "Editar presupuesto" queda **debajo**, en `brand-primary` (secundaria).
- El botón "Confirmar" interno del diálogo `ConfirmarSenalDialog` alinea su color al verde por
  coherencia (**D-3**, recomendación: sí).
- Ficheros: `AccionesPreReserva.tsx` (orden + clase), `ConfirmarSenalDialog.tsx`
  (`claseBotonPrimario`). Sin cambios de contrato ni de backend.
- Nemónico: **`R-CTA-SENAL-VERDE`** en `confirmacion` (MODIFIED).

### B — Descartar pre-reserva (slice vertical completo)

- **Nueva transición manual** de la máquina de estados:
  `pre_reserva → reserva_cancelada` (terminal), con **liberación de `FECHA_BLOQUEADA`** y
  **reordenación/promoción de la cola** de esa fecha, y **motivo OPCIONAL** auditado en
  `AUDIT_LOG` (`accion = 'transicion'`). Confirmado con el usuario.
- **Backend (declarativo, hexagonal, atómico)**:
  - `maquina-estados.ts`: añadir la tabla declarativa
    `ORIGENES_TRANSICION_DESCARTAR_PRERESERVA = [{ estado: 'pre_reserva', subEstado: null }]`
    y su guarda (mismo patrón que `ORIGENES_TRANSICION_CONFIRMAR_SENAL`).
  - `descartar-prereserva.use-case.ts` (modelado sobre
    `descartar-consulta-por-cliente.use-case.ts`): en **una** transacción atómica valida
    origen (422 origen inválido / 409 si ya terminal o carrera perdida), transiciona a
    `reserva_cancelada` con `ttl_expiracion = NULL`, `liberarFecha()` (regla dura: nunca por
    otra vía), reordena/promueve la cola (misma operación que el descarte de consulta /
    A15-A16) y audita el `motivo` opcional.
  - UoW adapter Prisma modelado sobre `descartar-consulta-uow.prisma.adapter.ts`
    (`SELECT … FOR UPDATE` + retry-on-conflict). Sin locks distribuidos.
  - **Endpoint REUTILIZADO** (**D-2**, CERRADA): NO se crea endpoint nuevo. Se **extiende** el
    `POST /reservas/{id}/descartar` de US-013 para **despachar por el estado actual de la
    RESERVA** — `consulta` (+sub-estados) → comportamiento US-013 (→ `2z`); `pre_reserva` → nueva
    transición → `reserva_cancelada`; otros → 422/409. El despacho por fase vive en un use-case
    orquestador (no en `if/else` de negocio en el controller). Se conservan el body
    `{ motivo?: string }`, `@Roles('gestor')` y `tenant_id`/`usuario_id` del JWT.
- **Contrato** (**D-2**, CERRADA): se **MODIFICA** la operación `descartar` existente en
  `docs/api-spec.yml` (ampliar semántica y responses para cubrir `pre_reserva`: 200/404/409/422)
  **sin romper** el contrato de US-013; NO se añade operación nueva. SDK regenerado ya cubre la
  llamada del frontend (dueño `contract-engineer`, fase posterior).
- **Frontend**: nuevo `AccionDescartarPreReserva.tsx` (estilo secundario/destructivo, patrón
  `AccionDescartar.tsx`, botón outline, **NO verde**, visible solo en `pre_reserva`) + diálogo de
  confirmación con motivo opcional (RHF + Zod, `useMutation`); **llama al MISMO endpoint
  `descartar`**; guarda `puedeDescartarPreReserva({ estado })` en `lib/` (NO en `components/`,
  guardrail); cableado en `AccionesPreReserva.tsx`.
- Nemónicos: **`R-DESCARTE-PRERESERVA`** en `consultas` (ADDED); aclaración de la liberación en
  **`bloqueo-fecha`** (MODIFIED: `R-LIBERACION-DESCARTE-PRERESERVA`).

### C — Cablear el email E2 real (backend + depuración, sin contrato)

- **Activar E2**: crear `renderE2` (modelado sobre `renderE3`), registrar `PLANTILLA_E2_ES`
  con `activa: true`, `variablesRequeridas: ['nombre', 'codigoReserva']`,
  **`adjuntosRequeridos: ['presupuesto']`** (**D-1**, CERRADA = requerido); quitar `'E2'` de
  `CODIGOS_DIFERIDOS`.
- **Adjunto presupuesto REQUERIDO** (**D-1**, CERRADA, anula "opcional"): como E3 con `'senal'`,
  si falta el PDF el envío se **BLOQUEA**. El fix ya no puede degradar/omitir el adjunto: debe
  conseguir que el presupuesto se **ENVÍE DE VERDAD** — garantizar que el PDF existe y es
  **alcanzable por Resend** en el disparo de E2 (path local ⇒ `content` Buffer, ya soportado en
  `resend.email.adapter.ts`; URL ⇒ alcanzable).
- **Corregir el `fallido` real (ruta crítica, systematic-debugging, NO asumir)**: reproducir el
  disparo de E2 y confirmar que el adjunto llega (path local ⇒ Buffer; URL ⇒ alcanzable). Riesgo
  a mitigar: que el disparo E2 post-commit ocurra antes de que el PDF esté disponible o que
  `pdfUrl` llegue `null` — asegurar en `generar-presupuesto.use-case.ts` que el PDF está
  generado/persistido ANTES/EN el disparo E2 y que `pdfUrl` no llega `null` al motor (ver
  design.md §D-1 riesgo+mitigación). E1 funciona por no llevar adjuntos.
- Nemónico: **`R-E2-CABLEADA`** en `comunicaciones` (MODIFIED).

## Impact

- **Specs (delta)**: `confirmacion` (MODIFIED), `consultas` (ADDED), `comunicaciones`
  (MODIFIED), `bloqueo-fecha` (MODIFIED). Ver `spec-delta.md`.
- **Contrato OpenAPI**: se **MODIFICA** la operación `descartar` existente (`docs/api-spec.yml`)
  para cubrir la semántica de `pre_reserva` (200/404/409/422) sin romper US-013; NO se añade
  operación nueva. SDK regenerado (workstream B). Workstreams A y C no tocan contrato.
- **Backend** (`apps/api`): `reservas/domain/maquina-estados.ts`,
  `reservas/application/descartar-prereserva.use-case.ts` (nuevo) + un use-case orquestador que
  despacha `descartar` por fase (reutiliza `descartar-consulta-por-cliente.use-case.ts`),
  `reservas/infrastructure/descartar-prereserva-uow.prisma.adapter.ts` (nuevo),
  **extensión de `reservas/interface/descartar-consulta.controller.ts`** (el mismo
  `@Post(':id/descartar')` pasa a despachar por estado; se conservan DTO `{ motivo? }`,
  `@Roles('gestor')`, JWT) — workstream B;
  `comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts` (E2 activa +
  `adjuntosRequeridos: ['presupuesto']`), `presupuestos/infrastructure/disparar-e2.adapter.ts`
  (garantizar `pdfUrl` no-nulo / adjunto requerido), `presupuestos/application/generar-presupuesto.use-case.ts`
  (orden PDF-antes-de-E2 / `pdfUrl` no-nulo) y (según diagnóstico)
  `comunicaciones/infrastructure/resend.email.adapter.ts` (path local ⇒ `content` Buffer /
  URL alcanzable) — workstream C.
- **Frontend** (`apps/web`): `AccionesPreReserva.tsx`, `ConfirmarSenalDialog.tsx`
  (workstream A); `AccionDescartarPreReserva.tsx` + diálogo + `lib/` guard + cableado
  (workstream B).
- **Datos**: sin migración de esquema. La transición de descarte usa las entidades y columnas
  existentes (`RESERVA`, `FECHA_BLOQUEADA`, `AUDIT_LOG`); el motivo se audita en `AUDIT_LOG`
  (mismo tratamiento que el motivo de US-013).
- **Multi-tenancy/RLS**: todas las operaciones bajo el contexto RLS del `tenant_id` del JWT.
- **Bloqueo atómico**: la liberación de fecha usa exclusivamente `liberarFecha()` dentro de la
  transacción con `SELECT … FOR UPDATE`; sin Redis ni locks distribuidos.

## Fuentes

- `apps/web/src/features/reservas/pages/FichaConsulta/components/AccionesPreReserva.tsx`,
  `AccionPresupuesto.tsx`, `AccionDescartar.tsx`
- `apps/web/src/features/confirmacion/components/ConfirmarSenalDialog.tsx`
- `apps/api/src/reservas/domain/maquina-estados.ts`
  (`ORIGENES_TRANSICION_CONFIRMAR_SENAL`, `MAPA_EXPIRACION_TTL`, `MAPA_PROMOCION_COLA`)
- `apps/api/src/reservas/application/descartar-consulta-por-cliente.use-case.ts`,
  `reservas/infrastructure/descartar-consulta-uow.prisma.adapter.ts`
- `apps/api/src/confirmacion/interface/confirmar-pago-senal.controller.ts`
- `apps/api/src/comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts`
  (`renderE3`, `CODIGOS_DIFERIDOS`, `PLANTILLA_E3_ES`)
- `apps/api/src/presupuestos/infrastructure/disparar-e2.adapter.ts`
- `apps/api/src/comunicaciones/infrastructure/resend.email.adapter.ts` (adjuntos)
- Specs vivas: `openspec/specs/{confirmacion,consultas,comunicaciones,bloqueo-fecha}/spec.md`
- `CLAUDE.md §Regla crítica`, `§Multi-tenancy`, `§Máquina de estados`; `docs/er-diagram.md`
