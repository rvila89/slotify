# Spec Delta — Capability `comunicaciones`

> **Workstream C (bugfix)** — El email **E2** (presupuesto enviado) estaba **diseñado pero
> inactivo** (`CODIGOS_DIFERIDOS`, render placeholder "(pendiente de cableado)", `activa:
> false`) pese a que su trigger post-commit (`DispararE2Adapter`) SÍ estaba cableado desde
> US-014. Este delta **MODIFICA** el requisito vivo de disparo de E2 para reflejar el
> comportamiento REAL cableado: plantilla activa con render real, y el **adjunto del
> presupuesto como REQUERIDO** (D-1 CERRADA = requerido; `adjuntosRequeridos: ['presupuesto']`,
> como E3 con `'senal'`) —si falta el PDF el envío se **BLOQUEA**— de modo que el email E2
> **siempre llega CON el presupuesto adjunto**. El fix del `fallido` es ruta crítica: garantiza
> que el PDF existe y es **alcanzable por Resend** (path local ⇒ `content` Buffer; URL ⇒
> alcanzable) y que `pdfUrl` no llega `null` al motor. Reutiliza el motor de email y la interfaz
> de adjuntos de US-045; NO reimplementa el transporte ni la máquina de estados.
>
> Fuente: workstream C del change; `catalogo-plantillas.ts` (`renderE3`, `CODIGOS_DIFERIDOS`,
> `PLANTILLA_E3_ES`), `disparar-e2.adapter.ts`, `generar-presupuesto.use-case.ts` (orden
> PDF-antes-de-E2), `resend.email.adapter.ts` (adjuntos, path local ⇒ Buffer); spec viva
> `comunicaciones` "La activación de pre_reserva dispara el email E2 con el PDF del presupuesto";
> `US-014 §Email relacionado E2`.

## MODIFIED Requirements

### Requirement: La activación de pre_reserva dispara el email E2 con el PDF del presupuesto

El sistema SHALL (DEBE), tras la activación exitosa de la pre-reserva (creación del PRESUPUESTO
+ transición de la RESERVA a `pre_reserva`), disparar el envío del email **E2** al cliente de la
RESERVA reutilizando el **motor de email de US-045** y su **interfaz de adjuntos**, con la
plantilla E2 **ACTIVA** (`activa: true`, render real `renderE2` con
`variablesRequeridas: ['nombre', 'codigoReserva']`; el código `'E2'` deja de estar entre los
`CODIGOS_DIFERIDOS`). El adjunto del **PDF del presupuesto** (`PRESUPUESTO.pdf_url`) es
**REQUERIDO** (D-1: `adjuntosRequeridos: ['presupuesto']`, como E3 con `'senal'`): si el PDF
falta, el envío de E2 se **BLOQUEA** (no se envía un E2 sin el presupuesto). En consecuencia, el
sistema DEBE **garantizar que el PDF existe y es alcanzable por el proveedor de email en el
momento del disparo de E2**: (a) el PDF se **genera y persiste ANTES / EN el disparo de E2** (el
post-commit de `generar-presupuesto.use-case.ts` produce el `pdf_url` y NO dispara E2 con
`pdf_url = null` de forma silenciosa); y (b) si el adjunto es un **path local** (dev sin S3) se
envía como `content` **Buffer** (`resend.email.adapter.ts` ya lo soporta: el SDK de Resend no lee
paths locales), y si es una **URL** debe ser **alcanzable por Resend**. El sistema DEBE registrar
el resultado en `COMUNICACION` con `codigo_email = 'E2'`, `reserva_id` = la RESERVA, `cliente_id`
= el CLIENTE de esa RESERVA y el `tenant_id` correspondiente, y registrar la operación en
`AUDIT_LOG`. La idempotencia por `(reserva_id, codigo_email)` del motor de US-045 garantiza **una
sola** E2 por RESERVA y **permite reintentar** el E2 una vez el PDF esté disponible. La causa raíz
del `estado = 'fallido'` observado con adjunto (tratamiento de adjuntos por URL/path local en
`resend.email.adapter.ts`) se **diagnostica de forma sistemática** y se corrige de modo que el
adjunto **se envíe de verdad** (path local ⇒ Buffer; URL ⇒ alcanzable) — la corrección es **ruta
crítica**, NO un fallback que omita el adjunto. (Fuente: workstream C; `US-014 §Email relacionado
E2`, `§Happy Path`; UC-14; E2 §9.3; US-045 §Catálogo de plantillas, §Interfaz de adjuntos,
§Idempotencia; `catalogo-plantillas.ts`, `disparar-e2.adapter.ts`,
`generar-presupuesto.use-case.ts`, `resend.email.adapter.ts`.)

#### Scenario: Con PDF disponible, E2 se envía con el presupuesto adjunto y se traza

- **GIVEN** una activación de `pre_reserva` que acaba de crear el PRESUPUESTO con su `pdf_url`
  disponible y alcanzable
- **WHEN** el sistema completa la operación tras el commit
- **THEN** el motor de email envía E2 al cliente con el PDF del presupuesto adjunto (path local ⇒
  `content` Buffer; URL ⇒ descargada por Resend) y contenido real (no placeholder)
- **AND** se crea una fila en `COMUNICACION` con `codigo_email = 'E2'`, `estado = 'enviado'`,
  `reserva_id` = esta RESERVA, `cliente_id` = el CLIENTE de la reserva y el `tenant_id` correcto

#### Scenario: Sin PDF disponible, E2 NO se envía sin el presupuesto (D-1 requerido)

- **GIVEN** una activación de `pre_reserva` cuyo `PRESUPUESTO.pdf_url` aún no está disponible o no
  es alcanzable en el disparo de E2
- **WHEN** el sistema intenta disparar E2 tras el commit
- **THEN** el motor **NO envía** un E2 sin el presupuesto adjunto (adjunto requerido): el envío
  queda bloqueado y el intento es **observable** (no un envío silenciosamente incompleto)
- **AND** por la idempotencia `(reserva_id, 'E2')` el E2 puede **reintentarse** una vez el PDF esté
  generado y alcanzable, entregándose entonces CON el presupuesto adjunto

#### Scenario: E2 no se duplica ante un segundo disparo sobre la misma RESERVA

- **GIVEN** una RESERVA que ya tiene una `COMUNICACION` con `codigo_email = 'E2'`
- **WHEN** el trigger E2 se vuelve a disparar para esa RESERVA
- **THEN** el motor detecta la entrada existente y no crea una segunda `COMUNICACION` E2 ni
  reenvía el email (idempotencia por `(reserva_id, codigo_email)` de US-045)

#### Scenario: En test/CI E2 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una activación de `pre_reserva` dispara E2
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E2 y su registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests
