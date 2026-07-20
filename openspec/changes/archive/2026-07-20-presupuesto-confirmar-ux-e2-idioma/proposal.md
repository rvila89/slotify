# Change: presupuesto-confirmar-ux-e2-idioma

> Change **no-US** (bugfix + UX) sobre la **confirmación del presupuesto** (US-014 · UC-14).
> Agrupa 5 defectos detectados en uso real que comparten superficie —la confirmación del
> presupuesto desde la `FichaConsulta` y el email E2 que la acompaña— y por eso se abren en un
> solo change trazable.
>
> Branch (Step 0): ya estamos en la rama del worktree
> (`worktree-presupuesto-confirmar-ux-e2-idioma`); **no** se crea ni se cambia de rama.
> Capabilities afectadas: `comunicaciones` (backend E2: idioma + contenido/variante `ca`) y
> `pipeline-ui` (frontend: scroll al confirmar, refresco de comunicaciones, estado siempre
> visible en la ficha).

## Why

Al confirmar un presupuesto (US-014 · UC-14) —creación del PRESUPUESTO congelado + transición
a `pre_reserva` + disparo del E2— la experiencia y el email tienen 5 carencias:

1. **El usuario no ve el resultado (UX frontend)**: tras confirmar y cerrarse el modal, la
   `FichaConsulta` NO hace scroll al top, así que el banner de éxito «Presupuesto generado…»
   queda fuera de la vista y el gestor cree que no ha pasado nada. La `NuevaConsultaPage` YA
   resuelve esto (`window.scrollTo({ top: 0 })`, `NuevaConsultaPage.tsx:78`).

2. **El listado de comunicaciones no se refresca al momento (bugfix frontend)**: el hook
   `useConfirmarPresupuesto` solo invalida la query de la **reserva**; NO invalida la query de
   **comunicaciones** (`['comunicaciones', id]`). Resultado: el gestor confirma, se traza E1
   (confirmación de consulta) y E2 (presupuesto), pero el listado de comunicaciones de la ficha
   sigue mostrando datos viejos hasta un refresco manual.

3. **El estado deja de verse en la ficha (bugfix frontend)**: el `Badge` de la `FichaConsulta`
   solo pinta **sub-estados de consulta** (`2a…2z`) y devuelve `null` para los estados sin
   sub-estado (`pre_reserva`, `reserva_confirmada`…). Tras confirmar, la reserva pasa a
   `pre_reserva` y el badge **desaparece**: el gestor no ve en qué estado está la reserva.

4. **El E2 sale en el idioma del tenant, no en el del cliente (bugfix backend)**: el
   `DispararE2Adapter` invoca el motor de email (`DespacharEmailService.despachar`) **sin**
   pasar `idioma: reserva.idioma`. El motor entonces resuelve el idioma del `TENANT_SETTINGS`
   (`'es'`) y el cliente catalán recibe el E2 en castellano, pese a que su `RESERVA.idioma` es
   `'ca'`. E1 ya se envía en el idioma del lead; E2 debe hacer lo mismo.

5. **El E2 no existe en catalán y su texto castellano no es el de marca (bugfix backend)**: el
   catálogo de plantillas solo tiene `PLANTILLA_E2_ES` con un cuerpo genérico de relleno; no
   hay variante `ca`. Aunque el defecto (4) propague el idioma, el catálogo devolvería `null`
   en `ca` y el motor caería al fallback `es`. Hay que reescribir el cuerpo del E2 en castellano
   con el texto de marca definitivo y crear la variante catalana activa.

## What Changes

### A — Scroll al top tras confirmar el presupuesto (solo frontend, sin contrato)

- En el callback `onConfirmadoPresupuesto` de `FichaConsulta/FichaConsultaPage.tsx`, tras
  cerrarse el modal y fijarse el resultado, hacer `window.scrollTo({ top: 0 })` para que el
  banner «Presupuesto generado…» quede visible. Precedente vivo: `NuevaConsultaPage.tsx:78`.
- Sin cambios de contrato ni de backend.
- Nemónico: **`R-SCROLL-CONFIRMAR-PRESUPUESTO`** en `pipeline-ui` (ADDED).

### B — Refresco inmediato del listado de comunicaciones tras confirmar (solo frontend)

- En `useConfirmarPresupuesto.ts`, en `onSuccess`, invalidar **también** la query
  `comunicacionesReservaQueryKey(id)` (`['comunicaciones', id]`), además de la query de la
  reserva, para que el listado muestre al momento E1 (confirmación de consulta) y E2
  (presupuesto). Patrón vivo: `useCrearEmailManual.ts`/`useDescartarBorrador.ts` ya invalidan
  esa query tras mutar comunicaciones.
- Sin cambios de contrato ni de backend.
- Nemónico: **`R-REFRESCO-COMUNICACIONES-CONFIRMAR`** en `pipeline-ui` (ADDED).

### C — Estado SIEMPRE visible en la ficha (solo frontend)

- El `Badge` de `FichaConsulta/components/Badge.tsx` debe mostrar **siempre** el estado: si hay
  `subEstado` → etiqueta del sub-estado (comportamiento actual `2a…2z`); si NO hay `subEstado`
  → etiqueta del **estado principal** (`pre_reserva → «Pre-reserva»`, `reserva_confirmada →
  «Confirmada»`, etc.).
- El mapa de etiquetas por estado principal vive en `lib/` (guardrail: `components/` solo
  `.tsx`), **reutilizando** `COLUMNAS_KANBAN` de `features/reservas/lib/columnasKanban.ts`
  (misma fuente declarativa de etiquetas de fase: `pre_reserva → «Pre-reserva»`, `confirmada →
  «Confirmada»`, `en_curso → «En Curso»`, `post_evento → «Post-evento»`), evitando un segundo
  mapa divergente.
- Sin cambios de contrato ni de backend.
- Nemónico: **`R-ESTADO-SIEMPRE-VISIBLE-FICHA`** en `pipeline-ui` (ADDED).

### D — El E2 se envía en el idioma de la reserva (backend, sin contrato)

- En `presupuestos/infrastructure/disparar-e2.adapter.ts`, propagar `idioma: reserva.idioma`
  en el comando del motor (`DespacharEmailService.despachar`), de modo que la selección de
  plantilla use el idioma del lead (`RESERVA.idioma`) —igual que E1— y NO el del tenant. El
  campo `idioma` del `DespacharEmailComando` YA existe y **precede** al `TENANT_SETTINGS`; el
  motor mantiene su fallback a `'es'` si no hay plantilla en el idioma pedido.
- Nemónico: **`R-E2-IDIOMA-RESERVA`** en `comunicaciones` (MODIFIED sobre el requisito vivo de
  disparo de E2).

### E — Contenido de marca del E2 (ES) + variante catalana activa (backend, sin contrato)

- En `comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts`:
  - **Reescribir** el cuerpo de `renderE2` (ES) con el texto de marca definitivo (asunto ES
    «Tu presupuesto para el evento (reserva {codigo})»; `{nombre}` = nombre de pila).
  - **Crear** `renderE2Ca` y `PLANTILLA_E2_CA` (`idioma: 'ca'`, `activa: true`,
    `variablesRequeridas: ['nombre', 'codigoReserva']`, `adjuntosRequeridos: ['presupuesto']`),
    con asunto CA «El teu pressupost per a l'esdeveniment (reserva {codigo})», y **añadir**
    `['E2', PLANTILLA_E2_CA]` a `registroCa` (junto a `E1` en catalán, hoy única activa `ca`).
  - El adjunto `'condiciones'` NO se declara en `adjuntosRequeridos` (lo añade el adapter de
    forma best-effort, sin bloquear el envío), igual que hoy.
- Textos de marca confirmados por el usuario (Masia l'Encís; firma «Ari»), en `es` y `ca`,
  detallados en `spec-delta.md`.
- Nemónico: **`R-E2-CONTENIDO-Y-VARIANTE-CA`** en `comunicaciones` (MODIFIED sobre el requisito
  vivo del catálogo por código e idioma).

## Impact

- **Specs (delta)**: `comunicaciones` (MODIFIED ×2) y `pipeline-ui` (ADDED ×3). Ver
  `spec-delta.md`.
- **Contrato OpenAPI**: **sin cambios**. Ningún workstream toca `docs/api-spec.yml` ni el SDK
  generado (el idioma y el contenido del E2 son internos del backend; los fixes de frontend
  reutilizan operaciones existentes: `POST /reservas/{id}/presupuesto` y
  `GET /reservas/{id}/comunicaciones`).
- **Backend** (`apps/api`):
  - `presupuestos/infrastructure/disparar-e2.adapter.ts` — propagar `idioma: reserva.idioma`
    (workstream D). El adapter ya carga la RESERVA; añadir `idioma` al `select`/comando.
  - `comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts` — reescribir `renderE2`
    (ES) + `renderE2Ca` + `PLANTILLA_E2_CA` en `registroCa` (workstream E).
- **Frontend** (`apps/web`):
  - `features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx` — `window.scrollTo` en
    `onConfirmadoPresupuesto` (workstream A).
  - `features/presupuestos/api/useConfirmarPresupuesto.ts` — invalidar además
    `comunicacionesReservaQueryKey(id)` (workstream B).
  - `features/reservas/pages/FichaConsulta/components/Badge.tsx` — estado siempre visible
    (workstream C); mapa de etiquetas de estado principal en `lib/` reutilizando
    `COLUMNAS_KANBAN` (guardrail `components/` solo `.tsx`).
- **Datos**: sin migración de esquema. Se usan entidades/columnas existentes (`RESERVA.idioma`,
  `COMUNICACION`); el E2 mantiene su idempotencia `(reserva_id, codigo_email)` y su registro en
  `COMUNICACION`/`AUDIT_LOG`.
- **Multi-tenancy/RLS**: sin cambios; el disparo de E2 sigue bajo el contexto RLS del `tenant_id`
  del JWT y el `idioma` viaja como dato de la RESERVA, no del body de un request de usuario.
- **Bloqueo atómico**: no se toca. El E2 sigue siendo fire-and-forget post-commit; un fallo del
  envío NO revierte la `pre_reserva`.

## Fuentes

- Frontend:
  - `apps/web/src/features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx`
    (`onConfirmadoPresupuesto`), `NuevaConsultaPage.tsx:78` (precedente `scrollTo`)
  - `apps/web/src/features/presupuestos/api/useConfirmarPresupuesto.ts` (`onSuccess`)
  - `apps/web/src/features/comunicaciones/api/useComunicacionesReserva.ts`
    (`comunicacionesReservaQueryKey`), `useCrearEmailManual.ts`, `useDescartarBorrador.ts`
    (patrón de invalidación)
  - `apps/web/src/features/reservas/pages/FichaConsulta/components/Badge.tsx`
  - `apps/web/src/features/reservas/lib/columnasKanban.ts` (`COLUMNAS_KANBAN`)
- Backend:
  - `apps/api/src/presupuestos/infrastructure/disparar-e2.adapter.ts`
  - `apps/api/src/comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts`
    (`renderE2`, `renderE1Ca`, `PLANTILLA_E2_ES`, `registroEs`, `registroCa`, `seleccionar`)
  - `apps/api/src/comunicaciones/application/despachar-email.service.ts` (resolución de idioma
    `comando.idioma ?? TENANT_SETTINGS ?? 'es'`, fallback de idioma)
- Specs vivas: `openspec/specs/comunicaciones/spec.md` (requisitos "Catálogo de plantillas por
  código de email e idioma" y "La activación de pre_reserva dispara el email E2 con el PDF del
  presupuesto"), `openspec/specs/pipeline-ui/spec.md`.
- `US-014 §Email relacionado E2`; UC-14; `US-045 §Reglas de negocio` idioma; `CLAUDE.md
  §Multi-tenancy`, `§Estructura del frontend por dominio` (guardrail `components/` solo `.tsx`).
