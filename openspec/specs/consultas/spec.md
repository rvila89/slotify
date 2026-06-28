# consultas Specification

## Purpose
TBD - created by archiving change us-003-alta-consulta-exploratoria. Update Purpose after archive.
## Requirements
### Requirement: Alta de consulta exploratoria sin fecha crea una RESERVA en 2.a

El sistema SHALL (DEBE) permitir a un gestor autenticado dar de alta un lead **sin
fecha de evento** creando **una única entidad RESERVA** con `estado = 'consulta'`,
`sub_estado = '2a'` y `ttl_expiracion = NULL`, asociada a un CLIENTE del mismo
`tenant_id`. El sistema NO DEBE crear ninguna fila en `FECHA_BLOQUEADA` para el
sub-estado `2.a` (la consulta es una fase de la RESERVA, no una entidad aparte). La
RESERVA, el CLIENTE, la COMUNICACION (E1) y el registro de AUDIT_LOG se crean en una
**única transacción** bajo el contexto RLS del tenant. (Fuente: `US-003 §Happy
Path`, `§Reglas de Validación`; UC-03; `er-diagram.md §3.6`.)

#### Scenario: Alta sin fecha y sin comentarios crea la RESERVA en 2.a

- **GIVEN** un gestor autenticado en su tenant que abre el formulario "Nueva consulta"
- **WHEN** introduce nombre, apellidos, email, teléfono y `canal_entrada` válidos,
  sin fecha de evento y sin comentarios, y confirma el alta
- **THEN** el sistema crea una RESERVA con `estado = 'consulta'`,
  `sub_estado = '2a'` y `ttl_expiracion = NULL`
- **AND** no genera ninguna entrada en `FECHA_BLOQUEADA`
- **AND** la RESERVA queda vinculada a un CLIENTE del mismo `tenant_id`

#### Scenario: La consulta exploratoria no calcula tarifa

- **GIVEN** un alta sin fecha de evento aunque incluya nº de invitados y horas
- **WHEN** el sistema crea la RESERVA en `2.a`
- **THEN** almacena los valores opcionales (invitados, horas, tipo de evento)
- **AND** no calcula ni asigna importe de tarifa (sin fecha no hay temporada, UC-16)

### Requirement: Respuesta inicial automática E1 según el campo comentarios

El sistema SHALL (DEBE) registrar una fila en `COMUNICACION` con
`codigo_email = 'E1'` para toda alta de consulta. Si el alta **no** incluye
`comentarios`, el sistema DEBE crear la COMUNICACION con `estado = 'enviado'` y
disparar el envío al email del cliente **sin intervención adicional** del gestor. Si
el alta **incluye** `comentarios`, el sistema DEBE crear la COMUNICACION con
`estado = 'borrador'`, **sin enviarla**, y la UI DEBE alertar al gestor de que tiene
un borrador pendiente de revisar y confirmar. El **transporte real** del email se
realiza a través de un **puerto de email** del dominio cuyo adaptador de transporte
queda diferido a US-045. (Fuente: `US-003 §Happy Path` 2.º escenario, `§FA Lead con
comentarios`, `§Email relacionado`.)

#### Scenario: Alta sin comentarios auto-envía E1

- **GIVEN** un alta de consulta válida sin el campo `comentarios`
- **WHEN** el sistema procesa el alta
- **THEN** crea una COMUNICACION con `codigo_email = 'E1'` y `estado = 'enviado'`
- **AND** dispara el envío del email al cliente sin acción adicional del gestor

#### Scenario: Alta con comentarios deja E1 en borrador

- **GIVEN** un alta de consulta válida con el campo `comentarios` relleno
- **WHEN** el gestor confirma el alta
- **THEN** crea una COMUNICACION con `codigo_email = 'E1'` y `estado = 'borrador'`
- **AND** no envía el email al cliente
- **AND** la UI alerta al gestor de un borrador E1 pendiente de revisar

### Requirement: Creación idempotente de CLIENTE por tenant y email

El sistema SHALL (DEBE) reutilizar el CLIENTE existente del tenant cuando ya hay uno
con el mismo `email` dentro de `tenant_id`, y crear uno nuevo en caso contrario, de
modo que dos altas con el mismo email en el mismo tenant no dupliquen el CLIENTE. La
resolución del CLIENTE DEBE ocurrir dentro de la misma transacción del alta y bajo
el contexto RLS del tenant. (Fuente: `US-003 §Supuestos`; `er-diagram.md §3.4`.)

#### Scenario: Segunda alta con el mismo email reutiliza el CLIENTE

- **GIVEN** un tenant que ya tiene un CLIENTE con un email dado
- **WHEN** el gestor da de alta otra consulta con ese mismo email
- **THEN** el sistema reutiliza el CLIENTE existente en lugar de crear uno nuevo
- **AND** la nueva RESERVA queda vinculada a ese CLIENTE

### Requirement: Auditoría del alta de consulta en AUDIT_LOG

El sistema SHALL (DEBE) registrar en `AUDIT_LOG`, tras un alta exitosa, una entrada
con `accion = 'crear'`, `entidad = 'RESERVA'`, el `usuario_id` del gestor activo y
los datos de la nueva RESERVA en `datos_nuevos`, a través del puerto de auditoría
compartido. El valor de `entidad` se persiste como `'RESERVA'` (UPPER_SNAKE),
consistente con la convención del módulo `reservas`. (Fuente: `US-003 §Happy Path`
3.er escenario; `er-diagram.md §3.17`; precedente
`reservas/domain/liberar-fecha.service.ts`.)

#### Scenario: Alta exitosa escribe un registro de auditoría

- **GIVEN** un alta de consulta que se completa con éxito
- **WHEN** el sistema finaliza la operación
- **THEN** escribe una entrada en `AUDIT_LOG` con `accion = 'crear'` y
  `entidad = 'RESERVA'`
- **AND** incluye el `usuario_id` del gestor activo y los datos de la RESERVA en
  `datos_nuevos`

### Requirement: Validación de campos y rechazo sin efectos colaterales

El sistema SHALL (DEBE) validar el alta en **cliente y servidor**: `nombre` y
`apellidos` no vacíos (máx. 100), `email` con formato RFC 5322 básico, `telefono` no
vacío y `canal_entrada` dentro del ENUM `{web|email|whatsapp|instagram|telefono}`.
Ante cualquier campo obligatorio incompleto, email inválido o `canal_entrada` fuera
del ENUM, el sistema NO DEBE crear ningún registro (RESERVA, CLIENTE ni
COMUNICACION) y DEBE devolver errores de validación sobre los campos afectados. El
reintento con los mismos datos inválidos es idempotente (sigue sin crear nada).
(Fuente: `US-003 §FA-03`, `§FA Email inválido`, `§FA canal_entrada fuera del ENUM`,
`§Reglas de Validación`.)

#### Scenario: Campos obligatorios incompletos no crean nada

- **GIVEN** un alta con algún campo obligatorio vacío (nombre, apellidos, email,
  teléfono o canal_entrada)
- **WHEN** el gestor intenta confirmar el alta
- **THEN** el sistema no crea ninguna RESERVA, CLIENTE ni COMUNICACION
- **AND** devuelve errores de validación sobre los campos incompletos

#### Scenario: Email con formato inválido se rechaza

- **GIVEN** un alta con un email sin formato válido (sin '@' o sin dominio)
- **WHEN** el gestor intenta confirmar el alta
- **THEN** el sistema rechaza la solicitud con un error en el campo email
- **AND** no crea ningún registro

#### Scenario: canal_entrada fuera del ENUM se rechaza en servidor

- **GIVEN** una petición con un `canal_entrada` no contemplado en el ENUM
- **WHEN** el servidor valida la solicitud
- **THEN** retorna un error de validación
- **AND** no crea ningún registro

