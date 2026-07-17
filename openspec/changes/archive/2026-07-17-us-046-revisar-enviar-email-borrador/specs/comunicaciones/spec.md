# Spec Delta — Capability `comunicaciones`

> **US-046 / UC-36** — El Gestor revisa, edita opcionalmente y envía un email que el
> sistema dejó en `borrador` (E1 con comentarios, US-045), lo descarta, o crea y envía
> un email `manual` desde la ficha de la RESERVA. Introduce la **primera superficie
> HTTP** del módulo `comunicaciones` (acción manual del gestor) **reutilizando** el
> motor y los puertos de US-045 (`EnviarEmailPort`, `ComunicacionRepositoryPort`,
> `AuditLogPort`, transporte real/fake). NO reimplementa el transporte de email, el
> bloqueo atómico de fecha ni la máquina de estados de la RESERVA.
>
> Fuente: `US-046`; UC-36; `er-diagram §3.17 COMUNICACION`, `§CLIENTE`, `§AUDIT_LOG`;
> spec viva `comunicaciones` (US-045); `CLAUDE.md §Multi-tenancy`, `§Máquina de estados`.

## ADDED Requirements

### Requirement: Listado de las comunicaciones de una RESERVA para la ficha del gestor

El sistema SHALL (DEBE) exponer un listado de todas las `COMUNICACION` asociadas a una
RESERVA (sección "Comunicaciones" de la ficha), devolviendo por cada fila al menos
`id`, `codigo_email`, `estado`, `asunto`, `destinatario_email`, `fecha_creacion`,
`fecha_envio` y `es_reenvio`. El listado DEBE ejecutarse bajo el **contexto RLS del
`tenant_id` del JWT** del gestor autenticado y devolver **únicamente** comunicaciones
cuyo `reserva_id` es la RESERVA solicitada y cuyo `tenant_id` coincide con el del JWT
(nunca cross-tenant). Las comunicaciones en `estado = 'enviado'` o `'fallido'` se
presentan como **solo lectura**; las de `estado = 'borrador'` son accionables (enviar
/ descartar). (Fuente: `US-046 §Supuestos` sección Comunicaciones de la ficha,
`§Happy Path`; UC-36; `CLAUDE.md §Multi-tenancy`.)

#### Scenario: El gestor lista las comunicaciones de su reserva

- **GIVEN** una RESERVA del tenant del gestor con varias `COMUNICACION`
  (p. ej. una E1 en `borrador`, una E2 `enviado`)
- **WHEN** el gestor solicita el listado de comunicaciones de esa RESERVA
- **THEN** el sistema devuelve todas las filas de esa RESERVA con su `codigo_email`,
  `estado`, `asunto`, `destinatario_email`, `fecha_creacion`, `fecha_envio` y
  `es_reenvio`
- **AND** las de `estado = 'enviado'`/`'fallido'` se marcan de solo lectura y las de
  `'borrador'` como accionables

#### Scenario: El listado no expone comunicaciones de otro tenant

- **GIVEN** una RESERVA cuyo `tenant_id` no coincide con el `tenant_id` del JWT del
  gestor
- **WHEN** el gestor solicita el listado de comunicaciones de esa RESERVA
- **THEN** el sistema no devuelve comunicaciones de esa RESERVA (aislamiento RLS por
  tenant)

### Requirement: Confirmación de envío de un borrador con edición opcional de asunto y cuerpo

El sistema SHALL (DEBE) permitir al gestor **confirmar el envío** de una
`COMUNICACION` en `estado = 'borrador'`: envía el email al `destinatario_email` de la
comunicación (heredado del `CLIENTE`) **reutilizando el camino de envío del motor de
US-045** (`EnviarEmailPort`), y al aceptar el proveedor actualiza la fila a
`estado = 'enviado'` con `fecha_envio` **no nulo**. El gestor PUEDE editar opcionalmente
`asunto` y `cuerpo` antes de confirmar; cuando lo hace, el `asunto`/`cuerpo`
**persistido** en `COMUNICACION` DEBE reflejar el contenido **efectivamente enviado**
(no la versión original del borrador). El gestor NO PUEDE modificar `codigo_email` ni
`destinatario_email`. La acción DEBE registrarse en `AUDIT_LOG` y ejecutarse bajo el
`tenant_id` del JWT. (Fuente: `US-046 §Happy Path — Revisar y enviar`, `§Happy Path —
Revisar, editar y enviar`, `§Reglas de Validación`; UC-36.)

#### Scenario: Confirmar el envío sin editar deja la comunicación enviada

- **GIVEN** una `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'borrador'`,
  vinculada a una RESERVA activa, con `destinatario_email` válido
- **WHEN** el gestor confirma el envío sin editar
- **THEN** el sistema envía el email al `destinatario_email` reutilizando el puerto de
  envío del motor
- **AND** actualiza la fila a `estado = 'enviado'` con `fecha_envio` no nulo
- **AND** registra la operación en `AUDIT_LOG`

#### Scenario: Editar el cuerpo persiste el contenido efectivamente enviado

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'`
- **WHEN** el gestor modifica el `cuerpo` con texto personalizado y confirma el envío
- **THEN** el sistema envía el email con el `cuerpo` editado
- **AND** actualiza `estado = 'enviado'`, registra `fecha_envio` y el `cuerpo`
  almacenado en `COMUNICACION` refleja el contenido enviado (no el original)

#### Scenario: El gestor no puede modificar el código ni el destinatario

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'`
- **WHEN** el gestor confirma el envío
- **THEN** el sistema mantiene `codigo_email` y `destinatario_email` originales
  (solo `asunto` y `cuerpo` son editables)

### Requirement: Solo un borrador es enviable — enviado y fallido son de solo lectura (idempotencia de la acción manual)

El sistema SHALL (DEBE) permitir confirmar el envío **únicamente** de una
`COMUNICACION` en `estado = 'borrador'`. Una `COMUNICACION` en `estado = 'enviado'`
DEBE tratarse como **terminal y de solo lectura**: el sistema NO DEBE permitir un
segundo envío, NO DEBE revertirla a `borrador` y NO DEBE crear una entrada duplicada
en `COMUNICACION`. Una `COMUNICACION` en `estado = 'fallido'` es igualmente de solo
lectura para esta acción (el reintento se hace creando/reenviando, no re-enviando la
misma fila). Un intento de enviar una fila que no está en `borrador` DEBE rechazarse
como conflicto de estado sin efectos. (Fuente: `US-046 §Borrador ya enviado (intento
de reenvío duplicado)`, `§Reglas de Validación` idempotencia; UC-36.)

#### Scenario: Un segundo envío del mismo borrador ya enviado se rechaza sin duplicar

- **GIVEN** una `COMUNICACION` que ya está en `estado = 'enviado'`
- **WHEN** el gestor intenta enviarla de nuevo (doble clic o petición duplicada)
- **THEN** el sistema la muestra como "ya enviada" en solo lectura y rechaza el segundo
  envío
- **AND** no revierte el estado a `borrador` ni crea una entrada duplicada en
  `COMUNICACION`

#### Scenario: Enviar una comunicación en fallido se rechaza como conflicto de estado

- **GIVEN** una `COMUNICACION` en `estado = 'fallido'`
- **WHEN** el gestor intenta confirmar su envío como si fuera un borrador
- **THEN** el sistema rechaza la acción como conflicto de estado sin efectos

### Requirement: Validación del destinatario antes del envío deja el borrador en borrador

El sistema SHALL (DEBE), **antes** de intentar el envío de un borrador, validar que el
`destinatario_email` (heredado del `CLIENTE.email`) **no es nulo** y tiene un **formato
válido (RFC 5321)**. Si la validación falla, el sistema NO DEBE llamar al proveedor de
email, DEBE devolver un **error de validación** ("El cliente no tiene un email válido
registrado") y DEBE dejar la `COMUNICACION` **en `estado = 'borrador'`** (no la pasa a
`fallido`, porque el envío ni siquiera se intentó). El sistema DEBE invitar al gestor a
actualizar el email del `CLIENTE` antes de reintentar. Esta validación es **previa** al
envío, no posterior. (Fuente: `US-046 §Borrador con destinatario nulo o email
inválido`, `§Reglas de Validación`; spec viva `comunicaciones` "Bloqueo de envío ante
variable de plantilla nula".)

#### Scenario: Email de cliente nulo o inválido bloquea el envío y conserva el borrador

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` cuyo `destinatario_email` /
  `CLIENTE.email` es nulo o tiene formato inválido
- **WHEN** el gestor intenta confirmar el envío
- **THEN** el sistema devuelve un error de validación y no llama al proveedor de email
- **AND** la `COMUNICACION` permanece en `estado = 'borrador'` (no pasa a `fallido`)

### Requirement: Fallo del proveedor al enviar un borrador deja la comunicación en fallido sin reintento automático

El sistema SHALL (DEBE), cuando el gestor confirma el envío de un borrador con
destinatario válido pero el **proveedor de email falla** (timeout, bounce permanente,
credenciales inválidas), actualizar la `COMUNICACION` a `estado = 'fallido'` **sin**
`fecha_envio`, registrar el error en `AUDIT_LOG` y mostrar al gestor un mensaje
indicando que el envío falló y que puede **reintentarlo**. El sistema NO DEBE reintentar
el envío automáticamente en el MVP. La confirmación de envío del gestor NO DEBE propagar
la excepción del proveedor como error no controlado. (Fuente: `US-046 §Fallo del
proveedor de email al confirmar el envío`; spec viva `comunicaciones` "Fallo del
proveedor sin reintento automático".)

#### Scenario: El proveedor falla y la comunicación queda en fallido y auditada

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` con `destinatario_email` válido
- **WHEN** el gestor confirma el envío y el proveedor de email devuelve un error
- **THEN** la `COMUNICACION` queda en `estado = 'fallido'` sin `fecha_envio`
- **AND** el error se registra en `AUDIT_LOG` y el gestor ve un mensaje de que puede
  reintentar
- **AND** el sistema no reintenta el envío automáticamente

### Requirement: Descarte de un borrador por el gestor lo lleva a fallido sin envío y con causa auditada

El sistema SHALL (DEBE) permitir al gestor **descartar** una `COMUNICACION` en
`estado = 'borrador'`: la fila pasa a `estado = 'fallido'` (no existe un estado
"descartado" en el enum), **sin** enviar ningún email y **sin** `fecha_envio`, y el
sistema DEBE registrar la acción en `AUDIT_LOG` con la **causa "descartado por
gestor"** (distinguible de un fallo del proveedor por dicha causa). Tras el descarte, el
borrador **desaparece de la bandeja de borradores pendientes** de la ficha; la RESERVA
puede continuar su ciclo de vida con normalidad y el gestor puede crear un email manual
si lo necesita. Solo se puede descartar una fila en `estado = 'borrador'`. (Fuente:
`US-046 §Gestor descarta el borrador sin enviar`, `§Reglas de negocio` descarte; UC-36.)

#### Scenario: Descartar un borrador lo pasa a fallido y lo audita como descartado

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` vinculada a una RESERVA
- **WHEN** el gestor selecciona "Descartar"
- **THEN** la `COMUNICACION` pasa a `estado = 'fallido'` sin `fecha_envio` y sin enviar
  ningún email
- **AND** se registra en `AUDIT_LOG` con la causa "descartado por gestor"
- **AND** el borrador deja de aparecer en la bandeja de borradores pendientes

#### Scenario: No se puede descartar una comunicación que no está en borrador

- **GIVEN** una `COMUNICACION` en `estado = 'enviado'` o `'fallido'`
- **WHEN** el gestor intenta descartarla
- **THEN** el sistema rechaza la acción como conflicto de estado sin efectos

### Requirement: Creación y envío de un email manual desde la ficha de la RESERVA

El sistema SHALL (DEBE) permitir al gestor **crear y enviar un email manual** desde la
ficha de una RESERVA: el gestor redacta `asunto` y `cuerpo`, y al confirmar el sistema
envía el email al `CLIENTE.email` de la RESERVA **reutilizando el puerto de envío del
motor de US-045**, y crea una `COMUNICACION` con `codigo_email = 'manual'`,
`estado = 'enviado'`, `fecha_envio` **no nulo**, `reserva_id` = la RESERVA,
`cliente_id` = el CLIENTE de esa RESERVA y el `tenant_id` del JWT, registrando la
operación en `AUDIT_LOG`. Al ser `manual`, la fila queda **fuera del índice UNIQUE
parcial de idempotencia** `(reserva_id, codigo_email)` de US-045 (permitiendo varios
emails manuales por RESERVA), de modo que no colisiona con otras comunicaciones de la
misma RESERVA. Antes de enviar, se aplica la misma validación de destinatario (email no
nulo y válido). (Fuente: `US-046 §Happy Path — Crear y enviar email manual`,
`§Reglas de negocio` `codigo_email = manual`; spec viva `comunicaciones` "Idempotencia
de un email por reserva y código" índice parcial.)

#### Scenario: Crear un email manual lo envía y crea la fila enviada

- **GIVEN** una RESERVA activa del tenant del gestor con `CLIENTE.email` válido
- **WHEN** el gestor selecciona "Nuevo email manual", redacta `asunto` y `cuerpo`, y
  confirma el envío
- **THEN** el sistema envía el email al `CLIENTE.email` reutilizando el puerto de envío
- **AND** crea `COMUNICACION` con `codigo_email = 'manual'`, `estado = 'enviado'`,
  `fecha_envio` no nulo, `reserva_id`, `cliente_id` y `tenant_id` correctos
- **AND** registra la operación en `AUDIT_LOG`

#### Scenario: Varios emails manuales sobre la misma reserva no colisionan por idempotencia

- **GIVEN** una RESERVA que ya tiene una `COMUNICACION` `manual` enviada
- **WHEN** el gestor crea y envía un segundo email manual sobre esa misma RESERVA
- **THEN** el sistema crea una segunda `COMUNICACION` `manual` sin error de unicidad
  (los emails `manual` quedan fuera del índice UNIQUE parcial de US-045)

#### Scenario: Email manual con cliente sin email válido bloquea el envío

- **GIVEN** una RESERVA cuyo `CLIENTE.email` es nulo o inválido
- **WHEN** el gestor intenta crear y enviar un email manual
- **THEN** el sistema devuelve un error de validación y no crea una `COMUNICACION`
  `enviado` ni llama al proveedor

### Requirement: Toda acción manual de comunicaciones corre bajo el tenant del JWT y el cliente de la reserva

El sistema SHALL (DEBE) ejecutar el listado, el envío, el descarte y el email manual
bajo el **contexto RLS del `tenant_id` del JWT** del gestor autenticado, verificando
que el `tenant_id` de la `COMUNICACION`/RESERVA coincide con el del JWT y que el
`cliente_id` corresponde al `CLIENTE` de la RESERVA asociada. El sistema NO DEBE operar
sobre comunicaciones ni reservas de otro tenant (cross-tenant), ni tomar el
`tenant_id`/`cliente_id` del path o del body en lugar del JWT y de la relación de la
RESERVA. (Fuente: `US-046 §Reglas de Validación` tenant/cliente; UC-36; `CLAUDE.md
§Multi-tenancy`.)

#### Scenario: Enviar un borrador de otro tenant se rechaza

- **GIVEN** una `COMUNICACION` cuyo `tenant_id` no coincide con el `tenant_id` del JWT
  del gestor
- **WHEN** el gestor intenta enviarla o descartarla
- **THEN** el sistema rechaza la acción (aislamiento RLS por tenant) sin efectos

#### Scenario: El tenant y el cliente se toman del JWT y de la reserva, no del body

- **GIVEN** una acción manual de comunicaciones con `tenant_id`/`cliente_id` en el body
  distintos de los del JWT y de la RESERVA
- **WHEN** el sistema procesa la acción
- **THEN** usa el `tenant_id` del JWT y el `cliente_id` del CLIENTE de la RESERVA,
  ignorando los del body
