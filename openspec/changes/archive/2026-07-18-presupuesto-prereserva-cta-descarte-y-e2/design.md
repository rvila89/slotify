# Design — presupuesto-prereserva-cta-descarte-y-e2

Decisiones técnicas no triviales de los tres workstreams. Las tres decisiones (D-1, D-2, D-3)
fueron sometidas al Gate SDD y el humano las **cerró**: D-1 = **requerido** (anula la
recomendación de "opcional"), D-2 = **reutilizar `POST /reservas/{id}/descartar`** (anula la
recomendación de endpoint dedicado), D-3 = **sí** (coincide con la recomendación). Este
documento refleja ya las decisiones cerradas; para cada una se conserva la recomendación
original y por qué el humano decidió lo que decidió.

---

## Contexto compartido

Los tres workstreams tocan la fase `pre_reserva` de la RESERVA pero son **independientes**:
pueden implementarse y probarse por separado. Se agrupan porque comparten la superficie de la
sección "Acciones" de la ficha (A y B) y el flujo del presupuesto (C es el email que se dispara
al generar el presupuesto que luego se confirma/descarta).

Reglas duras que gobiernan el diseño:

- **Bloqueo atómico**: toda liberación de fecha pasa por `liberarFecha()` dentro de una
  transacción con `SELECT … FOR UPDATE`; nunca por otra vía; sin Redis/Redlock (hook
  `no-distributed-lock`).
- **Máquina de estados declarativa**: las transiciones y guardas se modelan como estructura de
  datos en `maquina-estados.ts`, no como `if/else` dispersos (skill `state-machine`).
- **Hexagonal**: `domain/` no importa infra ni framework (hook `no-infra-in-domain`); el
  use-case orquesta y delega la transacción atómica en el puerto/adaptador (UoW).
- **Multi-tenancy/RLS**: `tenant_id`/`usuario_id` siempre del JWT; contexto RLS en cada tx.
- **Guardrail frontend**: helpers/guardas van en `lib/`, nunca en `components/` (solo `.tsx`).

---

## Workstream A — CTA verde y primero (solo frontend)

### Decisión: reordenar y recolorear sin tocar lógica

- En `AccionesPreReserva.tsx` se **invierte el orden** de los dos bloques: primero "Confirmar
  pago de señal", después "Editar presupuesto".
- "Confirmar pago de señal" adopta la clase del CTA verde de `AccionPresupuesto.tsx`
  (`bg-accent-success` + `text-accent-success-foreground`, mismo alto/padding/forma).
- "Editar presupuesto" conserva `brand-primary` (secundaria).
- No cambian las guardas (`puedeEditarPresupuesto`, `puedeConfirmarSenal`), ni los handlers, ni
  el contrato. Es un cambio puramente presentacional + de orden.

### D-3 (CERRADA = SÍ) — Verde también en el botón "Confirmar" interno del diálogo

- **Decisión del humano**: **sí** (coincide con la recomendación). Se alinea `claseBotonPrimario`
  de `ConfirmarSenalDialog.tsx` (`bg-brand-primary`, líneas ~65-66) al verde `accent-success`
  para que el CTA de confirmación sea coherente de principio a fin (la ficha abre el diálogo
  verde y el diálogo confirma en verde). El botón "Cancelar" (secundario) no cambia.
- **Alternativa descartada**: dejar el diálogo en `brand-primary` (solo recolorear la ficha), por
  incoherencia visual (botón verde que abre un modal cuyo confirmar es terracota).

---

## Workstream B — Descartar pre-reserva

### Decisión: modelar como transición terminal, espejo de US-013 en `pre_reserva`

- `pre_reserva → reserva_cancelada` es el destino terminal ya existente para la expiración de
  TTL de `pre_reserva` (`MAPA_EXPIRACION_TTL`: `{pre_reserva,null} → {reserva_cancelada,null}`).
  El descarte manual reutiliza ese **mismo destino** pero disparado deliberadamente por el
  gestor (paralelo a US-013, que es el descarte manual de una consulta a `2z`).
- La **guarda de origen** es una nueva tabla declarativa
  `ORIGENES_TRANSICION_DESCARTAR_PRERESERVA = [{ estado: 'pre_reserva', subEstado: null }]`, con
  su función `esOrigenValidoParaDescartarPreReserva(estado, subEstado)`, calcada de
  `ORIGENES_TRANSICION_CONFIRMAR_SENAL` (US-021). Un solo origen legal: `pre_reserva`.
- Cualquier otro estado (consulta y sus sub-estados, `reserva_confirmada` y posteriores,
  `reserva_cancelada`/`reserva_completada` inmutables) NO es origen → 422 origen inválido; una
  RESERVA que ya está `reserva_cancelada` por una carrera perdida → 409.

### Decisión: liberar fecha + promover/reordenar cola en la MISMA transacción atómica

- Dentro de la UoW (adaptador Prisma), bajo `SELECT … FOR UPDATE` de `FECHA_BLOQUEADA` y
  RESERVA:
  1. Re-evaluar la guarda de origen bajo el lock (detecta doble clic / carrera → 409).
  2. Transicionar `estado = 'reserva_cancelada'`, `ttl_expiracion = NULL`.
  3. `liberarFecha()` (la pre_reserva SIEMPRE tiene un bloqueo firme/blando activo sobre su
     fecha; se libera por la única función canónica).
  4. Promover el primero en cola (`promoverPrimeroEnCola` / A15) o reordenar la cola de esa
     fecha, **exactamente la misma operación** que el descarte de consulta (US-013) y la
     promoción de cola (US-018). No se reimplementa la mecánica de cola.
  5. `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`, origen→destino y `motivo`
     opcional en `datos_nuevos`.
- Todo all-or-nothing: cualquier fallo hace rollback total (no queda fecha liberada sin la
  RESERVA cancelada, ni cola promovida a medias).

### Decisión: hexagonal — use-case orquesta, UoW encapsula la transacción

- `DescartarPreReservaUseCase` recibe `{ tenantId, usuarioId, reservaId, motivo? }` (del JWT +
  path + body), delega en `DescartePreReservaUoWPort` y propaga el desenlace o el error de
  dominio. No atrapa errores (rollback total en fallo). Idéntico patrón a
  `DescartarConsultaPorClienteUseCase`.
- Errores de dominio DISJUNTOS que el controller mapea a HTTP distintos:
  `DescartePreReservaOrigenInvalidoError` (422), `DescartePreReservaEstadoTerminalError` /
  carrera (409), `ReservaNoEncontradaError` (404).

### D-2 (CERRADA = REUTILIZAR `POST /reservas/{id}/descartar`) — anula el endpoint dedicado

- **Decisión del humano**: **NO** se crea `POST /reservas/{id}/descartar-prereserva`. Se
  **EXTIENDE** el endpoint de descarte existente de US-013 —`POST /reservas/{id}/descartar`— para
  que también gestione el descarte de una `pre_reserva`, **despachando por el estado actual de la
  RESERVA**:
  - estado `consulta` (+ sub-estados válidos `2a|2b|2c|2d|2v`) → comportamiento **actual de
    US-013** (→ `2z`), sin cambios.
  - estado `pre_reserva` → **NUEVA transición** → `reserva_cancelada` (`sub_estado = NULL`,
    `ttl_expiracion = NULL`) + `liberarFecha()` + promoción/reordenación de cola + `AUDIT_LOG`
    con `accion = 'transicion'` y `motivo` opcional.
  - **otros estados** (`reserva_confirmada` y posteriores) → **422** origen inválido; RESERVA ya
    terminal (`reserva_cancelada`/`reserva_completada`) o carrera perdida → **409**.
- **Recomendación original (anulada)**: endpoint dedicado
  `POST /reservas/{id}/descartar-prereserva`. La recomendación argüía "mejor trazabilidad" al no
  mezclar dos transiciones en un endpoint. El humano priorizó **no proliferar endpoints** y que
  "descartar una reserva" sea **una sola acción de negocio** cuyo efecto depende de la fase (el
  gestor pulsa "descartar" y el sistema resuelve la transición según el estado). El endpoint ya
  existe, el frontend ya lo consume y el SDK ya lo cubre.

#### Dónde vive el despacho por fase (branch)

- Se inspeccionaron los artefactos reales de US-013:
  `interface/descartar-consulta.controller.ts` (`@Post(':id/descartar')`, `@Roles('gestor')`,
  body `{ motivo?: string }`, `tenant_id`/`usuario_id` del JWT vía `@CurrentUser`; mapea
  `ReservaNoEncontradaDescarteError`→404 y `DescarteEstadoTerminalError`→409),
  `interface/descartar-consulta.dto.ts` (`DescartarConsultaRequestDto` con `motivo?` opcional
  validado por `class-validator` + `whitelist`), y
  `application/descartar-consulta-por-cliente.use-case.ts` (orquesta y delega en
  `DescarteConsultaUoWPort`; la atomicidad y la re-guarda bajo `SELECT … FOR UPDATE` viven en el
  adaptador Prisma).
- **Branch elegido: en un use-case ORQUESTADOR, no en el controller.** El controller
  `descartar` sigue siendo el único punto HTTP; carga la RESERVA (o delega esa carga) y despacha
  al caso de uso correspondiente **según `reserva.estado`**:
  - `consulta` → `DescartarConsultaPorClienteUseCase` (existente, intacto).
  - `pre_reserva` → `DescartarPreReservaUseCase` (nuevo, workstream B).
  - resto → error de origen inválido (422) / conflicto terminal (409).
- **Por qué en un orquestador y no `if/else` en el controller**: mantiene la máquina de estados
  como estructura de datos (skill `state-machine`) y evita que el controller HTTP conozca las
  reglas de fase; cada fase conserva su use-case, su UoW atómica y sus errores de dominio
  DISJUNTOS. El controller solo elige el use-case por estado y mapea errores a HTTP. La forma
  concreta (un `DescartarReservaOrquestadorUseCase` que lee el estado y delega, vs. el controller
  que hace la lectura mínima del estado y elige) se decide en implementación; la **regla dura** es
  que el despacho NO se dispersa en condicionales de negocio en el controller.
- Se **conservan** el body `{ motivo?: string }` ya existente, `@Roles('gestor')` y
  `tenant_id`/`usuario_id` del JWT. La respuesta 200 sigue devolviendo la `RESERVA` re-leída tras
  el commit (el `estado` resultante será `2z` para consulta o `reserva_cancelada` para
  pre_reserva).

#### Contrato: MODIFICAR la operación existente, no añadir una nueva

- El cambio de contrato es **MODIFICAR** la operación `descartar` existente en `docs/api-spec.yml`
  (ampliar su semántica y sus responses para cubrir el descarte de `pre_reserva`: 200 / 404 / 409
  / 422) **sin romper** el contrato de US-013. No se añade una operación `descartarPreReserva`.
  El SDK regenerado ya cubre la llamada del frontend (la firma no cambia; cambia la semántica).

### Decisión: frontend — acción secundaria/destructiva, NO verde, MISMO endpoint

- `AccionDescartarPreReserva.tsx` sigue el patrón de `AccionDescartar.tsx` (US-013): botón
  **outline/secundario** (no un CTA de avance), NO verde. Visible **solo en `pre_reserva`**.
  Diálogo de confirmación con **motivo opcional** (RHF + Zod, `useMutation`), coherente con los
  diálogos del proyecto.
- **Llama al MISMO endpoint** `POST /reservas/{id}/descartar` (D-2): el SDK regenerado ya lo
  cubre; el frontend NO conoce una operación `descartar-prereserva`, solo invoca `descartar`
  sobre una RESERVA que sabe en `pre_reserva`, y el backend despacha por fase.
- La guarda `puedeDescartarPreReserva({ estado })` vive en `lib/` (guardrail: no en
  `components/`). Se cablea en `AccionesPreReserva.tsx` junto a las otras dos acciones de
  `pre_reserva`.

---

## Workstream C — Cablear el email E2 real

### Decisión: activar la plantilla E2 como se hizo con E3

- Crear `renderE2` modelado sobre `renderE3` (asunto "Tu presupuesto para el evento",
  cuerpo con el nombre y el `codigoReserva`, próximos pasos: revisar el presupuesto adjunto y
  responder para confirmar).
- Registrar `PLANTILLA_E2_ES` con `activa: true`,
  `variablesRequeridas: ['nombre', 'codigoReserva']`, **`adjuntosRequeridos: ['presupuesto']`**
  (ver D-1, CERRADA = requerido).
- Quitar `'E2'` de `CODIGOS_DIFERIDOS` para que deje de registrarse como inactiva.
- El trigger `DispararE2Adapter` YA está cableado (US-014): no se reimplementa el envío; solo se
  activa la plantilla que ese trigger despacha.

### D-1 (CERRADA = REQUERIDO) — Adjunto E2 requerido (anula la recomendación de "opcional")

- **Decisión del humano**: **requerido**. La plantilla E2 lleva
  `adjuntosRequeridos: ['presupuesto']` (igual que E3 con `'senal'`). Si falta el PDF del
  presupuesto, el envío se **BLOQUEA** (no se envía un E2 sin adjunto). El presupuesto es el
  contenido central de la comunicación: un E2 sin él no aporta valor.
- **Recomendación original (anulada)**: opcional (el adjunto degradaba sin tumbar el envío
  post-commit). Se descartó: se prioriza que el cliente reciba el presupuesto **con** el PDF, no
  que reciba un email vacío.
- **CONSECUENCIA CRÍTICA — el fix del `fallido` cambia de naturaleza**: al ser el adjunto
  requerido, la depuración del `fallido` YA NO puede "degradar/omitir el adjunto" como salida.
  El fix debe conseguir que el adjunto se **ENVÍE DE VERDAD**: garantizar que el PDF del
  presupuesto **existe y es ALCANZABLE por Resend en el momento del disparo E2**. La corrección
  del bug es **ruta crítica**, no un fallback graceful.
  - Si el adjunto es un **path local** (dev sin S3): enviarlo como `content` Buffer — ya
    soportado en `resend.email.adapter.ts` (`adjuntosResend`: path local ⇒ `fs.readFileSync` ⇒
    `{ filename, content }`; el SDK de Resend NO lee paths locales y la API los rechaza con 422).
  - Si el adjunto es una **URL**: que sea **alcanzable por Resend** (Resend descarga el `path`
    URL; una URL no accesible ⇒ error de la API ⇒ `COMUNICACION = 'fallido'`).

### D-1 — Riesgo del adjunto requerido y su mitigación de diseño

- **Riesgo**: al ser el adjunto **requerido**, si la generación del PDF falla (p. ej. la
  flakiness ESM de react-pdf documentada, o que el disparo E2 post-commit ocurra **antes** de que
  el PDF esté disponible/subido, o que `pdfUrl` llegue `null` al motor), el E2 quedaría
  **bloqueado** y el cliente **no recibiría nada**. A diferencia de la variante opcional, aquí un
  fallo del PDF ya no degrada a "email sin adjunto": deja al cliente sin comunicación.
- **Mitigación (consideración de diseño explícita, ruta crítica)**: asegurar que el PDF del
  presupuesto está **generado y persistido ANTES / EN el disparo de E2**, y que `pdfUrl` **no
  llega `null`** al motor:
  - Revisar el **orden** en `generar-presupuesto.use-case.ts`: hoy el post-commit ejecuta
    `generarPdfPostCommit(...)` y **luego** `dispararE2PostCommit(comando, pdfUrl ?? salida.presupuesto.pdfUrl)`
    (líneas ~709-712). El PDF ya se genera **antes** del disparo E2; la mitigación es **garantizar
    que ese `pdfUrl` es no-nulo y el fichero/URL está realmente disponible** en ese punto (no
    tragarse silenciosamente un fallo de `generarPdfPostCommit` de forma que E2 arranque con
    `pdfUrl = null`).
  - Revisar `disparar-e2.adapter.ts`: hoy solo añade el adjunto `'presupuesto'` si
    `params.pdfUrl !== null` (línea ~52). Con adjunto requerido, un `pdfUrl = null` NO debe
    traducirse en "E2 sin adjunto" silencioso: debe hacer que el motor **bloquee** el E2 (validación
    de `adjuntosRequeridos`) y trace el intento, de modo que el fallo sea **observable** (no un
    envío silenciosamente incompleto). El objetivo del fix es que el camino feliz entregue **E2 con
    presupuesto adjunto**, y que el fallo de PDF sea diagnosticable y reintentable (idempotencia
    `(reserva_id, E2)` del motor de US-045 permite el reintento del E2 una vez el PDF esté listo).
- **Depuración sistemática del `fallido` (ANTES de cerrar el punto, no asumir)**: reproducir el
  disparo de E2 con PDF disponible y con PDF ausente/no-alcanzable, inspeccionar la `COMUNICACION`
  resultante y los logs del adaptador Resend, y **confirmar** que el fix consigue el envío CON
  adjunto (path local ⇒ Buffer; URL ⇒ alcanzable) antes de dar por cerrado el workstream. E1
  funciona por no llevar adjuntos; el `fallido` observado en E2 con adjunto es exactamente el
  síntoma a corregir para que el adjunto llegue.

---

## Resumen de decisiones del Gate SDD (CERRADAS)

| Id  | Decisión | Recomendación original | Cierre del humano |
|-----|----------|------------------------|-------------------|
| D-1 | Adjunto E2 requerido vs opcional | Opcional (degrada) | **REQUERIDO** (`adjuntosRequeridos: ['presupuesto']`); el fix garantiza entrega CON adjunto — **anula** la recomendación |
| D-2 | Endpoint del descarte de pre-reserva | `POST /reservas/{id}/descartar-prereserva` dedicado | **REUTILIZAR `POST /reservas/{id}/descartar`** con despacho por fase; contrato MODIFICADO — **anula** la recomendación |
| D-3 | Verde también en el botón "Confirmar" del diálogo `ConfirmarSenalDialog` | Sí | **SÍ** — coincide |
