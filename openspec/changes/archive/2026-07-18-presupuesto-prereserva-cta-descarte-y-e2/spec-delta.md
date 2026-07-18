# Spec Delta — Índice (presupuesto-prereserva-cta-descarte-y-e2)

> Los deltas ejecutables (los que valida `openspec validate --strict`) viven en
> `specs/<capability>/spec.md` de este change, siguiendo la convención de OpenSpec y del
> proyecto. Este archivo es solo un índice legible de qué requirements se añaden/modifican y
> en qué capability, con su identificador nemotécnico. La fuente de verdad para el validador
> son los ficheros enlazados abajo.

## `openspec/specs/confirmacion/spec.md` → [`specs/confirmacion/spec.md`](specs/confirmacion/spec.md)

- **ADDED `R-CTA-SENAL-VERDE`** (workstream A) — "El CTA de confirmar la señal es la acción
  primaria (verde) y primera de la fase pre_reserva": en la sección "Acciones" de
  `pre_reserva`, "Confirmar pago de señal" se muestra **primero** y con el token semántico
  verde `accent-success` / `accent-success-foreground`; "Editar presupuesto" queda debajo, en
  `brand-primary` (secundaria). El botón "Confirmar" del diálogo alinea su color al verde
  (D-3). Cambio presentacional/orden, sin alterar guardas ni contrato.

## `openspec/specs/consultas/spec.md` → [`specs/consultas/spec.md`](specs/consultas/spec.md)

- **ADDED `R-DESCARTE-PRERESERVA`** (workstream B) — "El gestor descarta manualmente una
  pre-reserva, transicionándola a terminal, liberando la fecha y promoviendo la cola": nueva
  transición manual `pre_reserva → reserva_cancelada` en una transacción atómica que valida el
  origen (422/409), fija `ttl_expiracion = NULL`, libera la `FECHA_BLOQUEADA` vía
  `liberarFecha()`, reordena/promueve la cola de esa fecha (misma mecánica que US-013/US-018) y
  audita el `motivo` OPCIONAL en `AUDIT_LOG` (`accion = 'transicion'`). Guarda de origen
  declarativa `ORIGENES_TRANSICION_DESCARTAR_PRERESERVA` en `maquina-estados.ts`. Expuesta por el
  endpoint **REUTILIZADO** `POST /reservas/{id}/descartar` (D-2 CERRADA = reutilizar, no endpoint
  dedicado): el mismo endpoint de US-013 despacha por el estado de la RESERVA (`consulta` → `2z`;
  `pre_reserva` → `reserva_cancelada`; otros → 422/409). `@Roles('gestor')`, tenant/usuario del
  JWT, body `{ motivo?: string }`. Contrato: se MODIFICA la operación `descartar` existente.

## `openspec/specs/bloqueo-fecha/spec.md` → [`specs/bloqueo-fecha/spec.md`](specs/bloqueo-fecha/spec.md)

- **ADDED `R-LIBERACION-DESCARTE-PRERESERVA`** (workstream B) — "El descarte manual de una
  pre-reserva libera su fecha por la única función canónica": aclara que el descarte manual de
  una pre-reserva es un invocante más de `liberarFecha()`; la liberación de la
  `FECHA_BLOQUEADA` de una `pre_reserva` descartada por el gestor pasa por la **única** función
  canónica `liberarFecha()` dentro de la transacción atómica (`SELECT … FOR UPDATE`), nunca por
  otra vía, y dispara la promoción de la cola (seam US-018) en la misma transacción, con
  garantía de exactamente-una-vez. Se ADD (en vez de MODIFY) para no reescribir los requirements
  vivos de liberación de US-041; el nuevo requisito solo declara este invocante adicional.

## `openspec/specs/comunicaciones/spec.md` → [`specs/comunicaciones/spec.md`](specs/comunicaciones/spec.md)

- **MODIFIED `R-E2-CABLEADA`** (workstream C) — "El email E2 (presupuesto enviado) está cableado
  y llega al cliente CON el presupuesto adjunto": la plantilla E2 pasa a `activa: true` con
  `renderE2` real (`variablesRequeridas: ['nombre', 'codigoReserva']`), se retira `'E2'` de los
  códigos diferidos, y el adjunto del presupuesto es **REQUERIDO** (D-1 CERRADA = requerido,
  `adjuntosRequeridos: ['presupuesto']`, como E3 con `'senal'`): si falta el PDF el envío se
  **BLOQUEA**. El fix del `fallido` es **ruta crítica** (ya no degrada/omite el adjunto): debe
  garantizar que el presupuesto se ENVÍA de verdad — PDF existente y **alcanzable por Resend** en
  el disparo E2 (path local ⇒ `content` Buffer en `resend.email.adapter.ts`; URL ⇒ alcanzable) y
  `pdfUrl` no-nulo al motor (orden PDF-antes-de-E2 en `generar-presupuesto.use-case.ts`). Se
  corrige la causa del `fallido` del adjunto tras diagnóstico sistemático.
