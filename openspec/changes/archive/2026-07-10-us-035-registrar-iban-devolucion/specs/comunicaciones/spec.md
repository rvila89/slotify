# comunicaciones (delta US-035)

## ADDED Requirements

### Requirement: El gestor registra el IBAN de devolución sobre CLIENTE con validación mod-97 previa

El sistema SHALL (DEBE) permitir al **gestor** registrar el **IBAN de devolución de fianza** que el
cliente le ha proporcionado, sobre una RESERVA concreta, y persistirlo en **`CLIENTE.iban_devolucion`**
(atributo del `CLIENTE`, **no** de la RESERVA, disponible para futuras reservas del mismo cliente).
La acción SHALL (DEBE) estar disponible **únicamente** cuando `RESERVA.estado = 'post_evento'` **Y**
`RESERVA.fianza_eur > 0`. Antes de **cualquier** escritura, el sistema SHALL (DEBE) validar el IBAN
con el algoritmo de **checksum módulo 97** (longitud según país, prefijo de país, dígitos de control);
si el IBAN no supera la validación, el sistema NO DEBE actualizar `CLIENTE.iban_devolucion` ni enviar
E8, y DEBE devolver un error de validación. Toda actualización de `CLIENTE.iban_devolucion` SHALL
(DEBE) quedar registrada en `AUDIT_LOG` con `accion = 'actualizar'`, `entidad = 'CLIENTE'`,
`datos_anteriores = {iban_devolucion: <previo o null>}` y `datos_nuevos = {iban_devolucion: <nuevo>}`.
La acción se ejecuta bajo el contexto RLS del `tenant` del gestor autenticado (JWT), nunca
cross-tenant. (Fuente: `US-035 §Historia`, `§Reglas de negocio`, `§Reglas de Validación`, `FA-01`;
UC-26/UC-27; `CLAUDE.md §Multi-tenancy`.)

#### Scenario: Registro de un IBAN válido persiste en CLIENTE y audita

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_eur = 1000.00` y `CLIENTE.iban_devolucion = null`
- **WHEN** el gestor registra el IBAN válido `ES9121000418450200051332`
- **THEN** el sistema valida el IBAN por checksum módulo 97 con éxito
- **AND** actualiza `CLIENTE.iban_devolucion = 'ES9121000418450200051332'`
- **AND** registra en `AUDIT_LOG` `accion = 'actualizar'`, `entidad = 'CLIENTE'`,
  `datos_anteriores = {iban_devolucion: null}`, `datos_nuevos = {iban_devolucion: 'ES9121000418450200051332'}`

#### Scenario: IBAN con formato inválido bloquea la escritura antes de persistir (FA-01)

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_eur > 0`
- **WHEN** el gestor intenta registrar el valor `ES12345INVALIDO`
- **THEN** la validación de checksum módulo 97 falla y el sistema devuelve un error de validación
  ("El IBAN introducido no tiene un formato válido. Verifica los dígitos de control y la longitud.")
- **AND** `CLIENTE.iban_devolucion` no se actualiza
- **AND** no se envía E8 ni se crea `COMUNICACION` para E8

#### Scenario: Corrección de un IBAN previo lo sobreescribe y audita el valor anterior (FA-02)

- **GIVEN** un `CLIENTE.iban_devolucion = 'ES0000000000000000000001'` (registrado pero erróneo) sobre
  una RESERVA en `post_evento` con `fianza_eur > 0`
- **WHEN** el gestor registra el IBAN corregido `ES9121000418450200051332`
- **THEN** `CLIENTE.iban_devolucion` se sobreescribe con `'ES9121000418450200051332'`
- **AND** registra en `AUDIT_LOG` `datos_anteriores = {iban_devolucion: 'ES0000000000000000000001'}`,
  `datos_nuevos = {iban_devolucion: 'ES9121000418450200051332'}`

### Requirement: El registro de un IBAN válido dispara el email E8 al CLIENTE reutilizando el motor de comunicaciones

El sistema SHALL (DEBE), tras persistir un IBAN válido en `CLIENTE.iban_devolucion`, disparar el
envío del email **E8** (confirmación de recepción del IBAN + descripción de los próximos pasos para la
devolución de la fianza) a través del **motor de email** de `comunicaciones` (US-045), enviándolo al
**`CLIENTE.email`** — **nunca** al gestor. El motor SHALL (DEBE) crear una `COMUNICACION` con
`codigo_email = 'E8'`, `reserva_id` = la RESERVA de la acción, `cliente_id` = el `CLIENTE`,
`tenant_id` correcto y `estado = 'enviado'` con `fecha_envio` no nulo cuando el proveedor acepta el
envío. US-035 **no reimplementa** el motor: lo **invoca** con el trigger E8; `E8` pertenece al
catálogo E1–E8 declarado por US-045. (Fuente: `US-035 §Reglas de negocio`, `§Email relacionado` E8,
`§Happy Path`, `§Reglas de Validación`; `comunicaciones` Requirement "Motor de email reutilizable".)

#### Scenario: Guardar un IBAN válido envía E8 al cliente y crea la fila de COMUNICACION

- **GIVEN** una RESERVA en `post_evento` con `fianza_eur = 1000.00` y un `CLIENTE.email` no nulo
- **WHEN** el gestor registra el IBAN válido `ES9121000418450200051332` y el proveedor acepta el envío
- **THEN** el motor envía E8 al `CLIENTE.email` con la confirmación de recepción y los próximos pasos
- **AND** crea `COMUNICACION` con `codigo_email = 'E8'`, `estado = 'enviado'`, `fecha_envio` no nulo,
  `reserva_id`, `cliente_id` y `tenant_id` correctos

#### Scenario: E8 se envía al cliente, nunca al gestor

- **GIVEN** un registro de IBAN válido realizado por el gestor autenticado
- **WHEN** el motor despacha E8
- **THEN** el destinatario del email es `CLIENTE.email`
- **AND** el email E8 no se envía en ningún caso a la dirección del gestor

### Requirement: El guardado del IBAN y el envío de E8 son operaciones separadas — un fallo de E8 no revierte el IBAN

El sistema SHALL (DEBE) tratar el **guardado de `CLIENTE.iban_devolucion`** y el **envío de E8** como
operaciones **separadas** (patrón "guardar-luego-enviar"): si el IBAN es válido pero el proveedor de
email no está disponible al enviar E8, el IBAN SHALL (DEBE) quedar **guardado igualmente** (el fallo
de email **NO** revierte la actualización del IBAN), la `COMUNICACION` SHALL (DEBE) quedar en
`estado = 'fallido'` sin `fecha_envio`, y el sistema DEBE presentar al gestor una alerta ("⚠️ IBAN
guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha."). El gestor SHALL (DEBE) poder
**reintentar** el envío de E8 desde la ficha de la RESERVA, apoyándose en el mecanismo de reintento
del motor de `comunicaciones`. El `AUDIT_LOG` de la actualización del IBAN DEBE reflejar el fallo del
email. En entornos `test`/CI el transporte de email DEBE operar en **modo fake** (sin envíos reales
por red), de modo que las pruebas verifiquen el disparo de E8 y su registro en `COMUNICACION` sin
enviar correos a destinatarios reales. (Fuente: `US-035 §Reglas de negocio`, `FA-03`; `US-045
§Transporte real / modo sandbox`, `§Fallo del proveedor sin reintento automático`.)

#### Scenario: Fallo de E8 deja el IBAN guardado y la comunicación en fallido (FA-03)

- **GIVEN** una RESERVA en `post_evento` con `fianza_eur > 0` y el proveedor de email no disponible
- **WHEN** el gestor registra un IBAN válido y el envío posterior de E8 falla
- **THEN** `CLIENTE.iban_devolucion` queda guardado con el nuevo IBAN (no se revierte)
- **AND** `COMUNICACION.estado = 'fallido'` sin `fecha_envio` para E8
- **AND** el gestor ve la alerta indicando que puede reenviar E8 desde la ficha
- **AND** el `AUDIT_LOG` de la actualización del IBAN refleja el fallo de E8

#### Scenario: El gestor reintenta el envío de E8 desde la ficha

- **GIVEN** una RESERVA en `post_evento` con `CLIENTE.iban_devolucion` ya guardado y una
  `COMUNICACION` E8 en `estado = 'fallido'`
- **WHEN** el gestor reintenta el envío de E8 desde la ficha
- **THEN** el motor de `comunicaciones` reintenta el envío al `CLIENTE.email`
- **AND** actualiza el resultado del reintento en la `COMUNICACION` E8

#### Scenario: En test/CI E8 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** un registro de IBAN válido dispara E8
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E8 y su registro en `COMUNICACION` quedan verificables para las aserciones

### Requirement: El registro de IBAN se rechaza sin fianza cobrada o fuera de post_evento

El sistema SHALL (DEBE) **rechazar** el registro de IBAN cuando `RESERVA.fianza_eur = 0` **o
`fianza_eur IS NULL`** (no hay fianza que devolver) o cuando `RESERVA.estado ≠ 'post_evento'`. El
backend NO DEBE confiar en que la UI oculte el campo: DEBE **validar la precondición** en el servidor
y devolver un error de conflicto de estado / sin fianza cuando no se cumple, **sin** actualizar
`CLIENTE.iban_devolucion` ni enviar E8. La UI DEBE, de forma complementaria, condicionar la
**visibilidad/habilitación** del campo IBAN a `RESERVA.fianza_eur > 0`. (Fuente: `US-035 §Reglas de
negocio`, `FA-04`, `§Reglas de Validación`.)

#### Scenario: Sin fianza (fianza_eur = 0) el backend rechaza el registro (FA-04)

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_eur = 0` (o `IS NULL`)
- **WHEN** se intenta registrar un IBAN sobre esa RESERVA
- **THEN** el sistema rechaza la acción (no hay fianza que devolver)
- **AND** `CLIENTE.iban_devolucion` no se actualiza y no se envía E8

#### Scenario: La UI oculta o deshabilita el campo IBAN cuando no hay fianza

- **GIVEN** una RESERVA en `post_evento` con `fianza_eur = 0` (o `IS NULL`)
- **WHEN** el gestor accede a la ficha de post-evento
- **THEN** el campo IBAN no es visible o está deshabilitado

#### Scenario: Registro fuera de post_evento se rechaza como conflicto de estado

- **GIVEN** una RESERVA cuyo `estado ≠ 'post_evento'` (p. ej. `reserva_confirmada`)
- **WHEN** se intenta registrar un IBAN sobre esa RESERVA
- **THEN** el sistema rechaza la acción como conflicto de estado
- **AND** `CLIENTE.iban_devolucion` no se actualiza y no se envía E8

### Requirement: Cada corrección del IBAN reenvía E8 como excepción auditada a la idempotencia

El sistema SHALL (DEBE) disparar E8 en **cada** registro/corrección de un IBAN válido. El reenvío de
E8 tras una corrección del IBAN (FA-02) es una **acción intencionada del gestor** y por tanto una
**excepción explícita y auditada** a la idempotencia `(reserva_id, codigo_email)` del motor de US-045
(que evita duplicados por **disparos automáticos** del mismo trigger, no por reenvíos manuales): el
sistema DEBE crear una **nueva** `COMUNICACION` con `codigo_email = 'E8'`, `estado = 'enviado'` y
`fecha_envio` por cada envío (o, alternativamente, con un contador de reenvíos; la decisión concreta
se fija en el gate, `design.md §D-3`). El reenvío en corrección NO DEBE bloquearse por la idempotencia.
(Fuente: `US-035 §Reglas de negocio` sobreescritura + reenvío, `FA-02`; `comunicaciones` Requirement
"Reenvío de E4 crea una nueva comunicación", "Idempotencia de un email por reserva y código".)

#### Scenario: Corregir el IBAN reenvía E8 con el valor actualizado como referencia (FA-02)

- **GIVEN** una RESERVA en `post_evento` con `fianza_eur > 0` y una `COMUNICACION` E8 previa por un
  IBAN erróneo ya registrado
- **WHEN** el gestor corrige el IBAN a `ES9121000418450200051332` y guarda
- **THEN** `CLIENTE.iban_devolucion` se sobreescribe con el IBAN corregido
- **AND** se crea una nueva `COMUNICACION` `codigo_email = 'E8'`, `estado = 'enviado'` enviada al
  cliente con el IBAN actualizado como referencia
- **AND** el reenvío no queda bloqueado por la idempotencia `(reserva_id, codigo_email)` de US-045
