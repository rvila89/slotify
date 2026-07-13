# Spec Delta — Capability `presupuestos`

> Edición inline de los datos fiscales del CLIENTE, prerrequisito de la validación
> síncrona de US-014 (`§FA-01`, `§Reglas de Validación`; UC-14). Complementa el
> requirement "Validación síncrona de completitud de datos y datos fiscales antes
> del cálculo" ya vivo en esta capability, dándole al gestor el medio para
> **resolver** `DATOS_FISCALES_INCOMPLETOS` sin salir del flujo de presupuesto.
> Incidencia #5 del plan `en-el-paso-de-zippy-dragon.md` (Parte B).

## ADDED Requirements

### Requirement: Completar los datos fiscales del CLIENTE de una RESERVA

El sistema SHALL (DEBE) exponer una operación dedicada para **actualizar los datos
fiscales del CLIENTE** asociado a una RESERVA `{id}`, de modo que el gestor pueda
resolver la validación `DATOS_FISCALES_INCOMPLETOS` (US-014 §FA-01) sin abandonar el
flujo de presupuesto. La operación DEBE actualizar **únicamente** los campos fiscales
del CLIENTE: `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`
(todos opcionales/`nullable` en el modelo). La operación NO PUEDE modificar ningún
campo de la RESERVA (`fecha_evento`, `duracion_horas`, `num_adultos_ninos_mayores4`,
`tipo_evento`), ni el estado/sub_estado/`ttl_expiracion` de la RESERVA, ni la
`FECHA_BLOQUEADA`: esos campos tienen sus propios flujos (p. ej. la fecha se fija con
el flujo de bloqueo atómico dedicado). El `tenant_id` DEBE derivar SIEMPRE del JWT
(nunca del body); el CLIENTE se resuelve **a través de** la RESERVA `{id}` bajo el
contexto RLS del tenant. La operación es una acción del Gestor (rol `gestor`).
(Fuente: `US-014 §FA-01`, `§Reglas de Validación`, `§Reglas de negocio` datos
fiscales del CLIENTE; UC-14; plan `en-el-paso-de-zippy-dragon.md` #5; patrón
`PATCH /reservas/{id}/iban-devolucion` de US-035; `CLAUDE.md §Multi-tenancy`,
`§Regla crítica: bloqueo atómico de fecha`.)

#### Scenario: Completar datos fiscales faltantes desbloquea la generación de presupuesto

- **GIVEN** una RESERVA en `sub_estado = '2b'` cuyo CLIENTE tiene `dni_nif` nulo (y
  el resto de datos fiscales presentes)
- **WHEN** el gestor guarda el `dni_nif` que faltaba mediante la operación de datos
  fiscales del CLIENTE
- **THEN** el CLIENTE queda con `dni_nif` persistido y el resto de sus datos fiscales
  intactos
- **AND** una posterior generación/confirmación de presupuesto ya **no** falla por
  `DATOS_FISCALES_INCOMPLETOS` respecto a ese campo

#### Scenario: La operación solo toca campos fiscales del CLIENTE, nunca la RESERVA

- **GIVEN** una RESERVA en `sub_estado = '2b'` con `fecha_evento`, `duracion_horas`,
  `num_adultos_ninos_mayores4` y `tipo_evento` ya fijados, y una `FECHA_BLOQUEADA`
  activa para esa fecha
- **WHEN** el gestor actualiza los datos fiscales del CLIENTE (`direccion`,
  `codigo_postal`, `poblacion`, `provincia`, `dni_nif`)
- **THEN** solo cambian esos campos del CLIENTE
- **AND** la RESERVA conserva su `estado`/`sub_estado`/`ttl_expiracion` y sus campos
  de evento, y la `FECHA_BLOQUEADA` no se modifica

#### Scenario: El tenant se toma del JWT, no del body (aislamiento multi-tenant)

- **GIVEN** un gestor autenticado del tenant A y una RESERVA que pertenece al
  tenant B
- **WHEN** intenta actualizar los datos fiscales del CLIENTE de esa RESERVA
- **THEN** el sistema no encuentra la RESERVA bajo el contexto RLS del tenant A
  (RESERVA de otro tenant → no visible) y rechaza la operación como recurso
  inexistente
- **AND** ningún dato del CLIENTE del tenant B es leído ni modificado

#### Scenario: Actualización parcial no borra los campos fiscales ya presentes

- **GIVEN** un CLIENTE con `dni_nif`, `poblacion` y `provincia` ya informados y
  `direccion`/`codigo_postal` nulos
- **WHEN** el gestor envía únicamente `direccion` y `codigo_postal` para completarlos
- **THEN** se persisten `direccion` y `codigo_postal`
- **AND** `dni_nif`, `poblacion` y `provincia` conservan sus valores previos (la
  operación no los sobrescribe con nulos por omisión)

#### Scenario: Actor sin rol Gestor no puede editar datos fiscales

- **GIVEN** un usuario autenticado sin rol `gestor`
- **WHEN** intenta actualizar los datos fiscales del CLIENTE de una RESERVA
- **THEN** el sistema rechaza la operación por autorización insuficiente
- **AND** no modifica ningún dato del CLIENTE
