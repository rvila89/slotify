# Spec Delta — Capability `consultas`

> **Workstream B (feature, slice vertical)** — Nueva transición **manual** de la máquina de
> estados de la RESERVA: el gestor descarta una `pre_reserva`, llevándola al estado terminal
> `reserva_cancelada`, liberando su `FECHA_BLOQUEADA` y promoviendo/reordenando la cola de esa
> fecha, todo en una única transacción atómica. Es el **espejo, en la fase `pre_reserva`**, de
> "Marcar como descartada por cliente" (US-013, que descarta una `consulta` a `2z`). Reutiliza
> la guarda de origen declarativa (patrón `ORIGENES_TRANSICION_CONFIRMAR_SENAL`), la función
> canónica `liberarFecha()` (capability `bloqueo-fecha`) y la mecánica de promoción de cola de
> US-018; NO reimplementa el bloqueo ni la cola.
>
> El descarte se expone por el endpoint **REUTILIZADO** de US-013 (D-2 CERRADA = reutilizar, NO
> endpoint dedicado): el mismo `POST /reservas/{id}/descartar` **despacha por el estado actual de
> la RESERVA** —`consulta` (+sub-estados) → comportamiento US-013 (→ `2z`); `pre_reserva` → esta
> nueva transición (→ `reserva_cancelada`); otros → 422/409. El despacho por fase vive en un
> use-case orquestador (no en `if/else` de negocio en el controller). El contrato **MODIFICA** la
> operación `descartar` existente para cubrir la semántica de `pre_reserva`, sin romper US-013.
>
> Fuente: workstream B del change; `maquina-estados.ts`
> (`ORIGENES_TRANSICION_CONFIRMAR_SENAL`, `MAPA_EXPIRACION_TTL`
> `{pre_reserva}→{reserva_cancelada}`, `MAPA_PROMOCION_COLA`);
> `descartar-consulta-por-cliente.use-case.ts`, `descartar-consulta-uow.prisma.adapter.ts`,
> `descartar-consulta.controller.ts` (`@Post(':id/descartar')`, `@Roles('gestor')`,
> `DescartarConsultaRequestDto { motivo? }`); `confirmar-pago-senal.controller.ts`; `CLAUDE.md
> §Regla crítica`, `§Multi-tenancy`, `§Máquina de estados`.

## ADDED Requirements

### Requirement: Descarte manual de una pre-reserva a estado terminal por el Gestor

El sistema SHALL (DEBE) permitir a un Gestor autenticado **descartar manualmente** una RESERVA
en `estado = 'pre_reserva'`, transicionándola al estado **terminal** `reserva_cancelada`
(`sub_estado = NULL`, `ttl_expiracion = NULL`) en una **única transacción atómica** bajo el
contexto RLS del `tenant_id` del JWT. La transición es **mono-origen**: el ÚNICO origen legal es
`pre_reserva` (sub_estado `NULL`), validado por la guarda declarativa
`ORIGENES_TRANSICION_DESCARTAR_PRERESERVA = [{ estado: 'pre_reserva', subEstado: null }]` en
`maquina-estados.ts` (modelada como estructura de datos, NO condicionales dispersos; mismo
patrón que `ORIGENES_TRANSICION_CONFIRMAR_SENAL` de US-021). El destino `reserva_cancelada`
reutiliza el mismo terminal que la expiración de TTL de la pre-reserva (`MAPA_EXPIRACION_TTL`),
pero disparado **deliberadamente** por el Gestor. Cualquier otro estado que NO sea `pre_reserva`
ni `consulta` (`reserva_confirmada` y posteriores) NO es origen legal para el descarte de
pre-reserva y se rechaza **sin efectos** con **422**; una RESERVA ya terminal
(`reserva_cancelada`/`reserva_completada`, inmutables) o una carrera perdida bajo el lock se
rechaza con **409**. Esta transición se expone por el endpoint **REUTILIZADO**
`POST /reservas/{id}/descartar` (D-2, el mismo de US-013), que **despacha por el estado actual de
la RESERVA**: `consulta` (+sub-estados `2a|2b|2c|2d|2v`) → comportamiento US-013 (→ `2z`);
`pre_reserva` → esta transición (→ `reserva_cancelada`). El despacho por fase vive en un
**use-case orquestador** (no en condicionales de negocio dispersos en el controller): el
controller HTTP elige el caso de uso según `reserva.estado` y mapea los errores de dominio a HTTP.
El `tenant_id` y el `usuario_id` derivan SIEMPRE del JWT, nunca del path ni del body. (Fuente:
workstream B; `ORIGENES_TRANSICION_CONFIRMAR_SENAL`; US-013 descarte manual
(`descartar-consulta.controller.ts`); `CLAUDE.md §Máquina de estados`.)

#### Scenario: El Gestor descarta una pre-reserva y la deja en reserva_cancelada

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` del tenant del Gestor
- **WHEN** el Gestor confirma el descarte de la pre-reserva
- **THEN** la RESERVA queda en `estado = 'reserva_cancelada'`, `sub_estado = NULL` y
  `ttl_expiracion = NULL`
- **AND** todo ocurre en una única transacción bajo el contexto RLS del `tenant_id` del JWT

#### Scenario: Descartar desde un estado que no es pre_reserva se rechaza sin efectos

- **GIVEN** una RESERVA en `estado = 'consulta'` (cualquier sub_estado) o en
  `reserva_confirmada`/posteriores
- **WHEN** se intenta descartarla como pre-reserva
- **THEN** el sistema rechaza la operación con **422** (origen inválido) sin mutar ninguna
  entidad

#### Scenario: Descartar una reserva ya terminal se rechaza como conflicto

- **GIVEN** una RESERVA ya en `reserva_cancelada` (por una petición previa o una carrera
  perdida bajo el lock)
- **WHEN** llega un segundo descarte de la misma RESERVA
- **THEN** el sistema responde **409** (transición no permitida) sin efectos adicionales

### Requirement: El descarte de la pre-reserva libera la fecha y promueve la cola en la misma transacción

El sistema SHALL (DEBE), al descartar una pre-reserva, ejecutar dentro de la **misma
transacción atómica** (`SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA` y RESERVA; sin locks
distribuidos): (1) **re-evaluar** la guarda de origen bajo el lock (para detectar el doble clic
o la carrera → 409); (2) transicionar la RESERVA a `reserva_cancelada`; (3) **liberar la
`FECHA_BLOQUEADA`** de esa fecha invocando **exclusivamente** la función canónica
`liberarFecha()` (regla dura: nunca por otra vía); y (4) **promover/reordenar la cola** de esa
fecha —si existe cola activa (`sub_estado = '2d'` apuntando a la reserva liberada)— con la
**misma mecánica** de promoción de US-018 usada por el descarte de consulta (US-013) y por la
liberación (US-041), garantizando **exactamente-una-vez** la promoción. La operación es
**all-or-nothing**: cualquier fallo revierte por completo (no queda fecha liberada sin la RESERVA
cancelada, ni cola promovida a medias). (Fuente: workstream B;
`descartar-consulta-uow.prisma.adapter.ts`; capability `bloqueo-fecha`
`R-LIBERACION-DESCARTE-PRERESERVA`; US-018 promoción; `CLAUDE.md §Regla crítica`,
`§Jobs asíncronos`.)

#### Scenario: Descartar una pre-reserva con cola libera la fecha y promueve al primero

- **GIVEN** una RESERVA en `pre_reserva` con su `FECHA_BLOQUEADA` firme y una cola activa
  (`RESERVA` en `2.d`) sobre esa fecha
- **WHEN** el Gestor descarta la pre-reserva
- **THEN** en la misma transacción se transiciona a `reserva_cancelada`, se invoca
  `liberarFecha()` para esa fecha y se promueve el primero de la cola exactamente una vez
- **AND** el resultado es all-or-nothing (no hay estado intermedio observable)

#### Scenario: Descartar una pre-reserva sin cola libera la fecha sin promover

- **GIVEN** una RESERVA en `pre_reserva` con su `FECHA_BLOQUEADA` firme y sin ninguna `RESERVA`
  en `2.d` que apunte a esa fecha
- **WHEN** el Gestor descarta la pre-reserva
- **THEN** se transiciona a `reserva_cancelada` y se libera la fecha vía `liberarFecha()` sin
  disparar ninguna promoción

#### Scenario: Un fallo durante el descarte revierte todo

- **GIVEN** una RESERVA en `pre_reserva` en proceso de descarte
- **WHEN** una escritura de la transacción (liberación de fecha o promoción de cola) falla
- **THEN** la RESERVA conserva `estado = 'pre_reserva'` y su `FECHA_BLOQUEADA` intacta
- **AND** no queda ninguna mutación parcial persistida

### Requirement: Confirmación con motivo opcional auditado en el descarte de pre-reserva

El sistema SHALL (DEBE) aceptar un **motivo OPCIONAL** al descartar la pre-reserva
(`{ motivo?: string }` en el body del endpoint **REUTILIZADO** `POST /reservas/{id}/descartar`,
el mismo de US-013 — D-2). La operación DEBE registrar en la misma transacción un `AUDIT_LOG` con
`accion = 'transicion'`, `entidad = 'RESERVA'`, el par origen→destino (`pre_reserva` →
`reserva_cancelada`) y, si viaja, el `motivo` en `datos_nuevos`. La **ausencia** de motivo
(`undefined`) NO bloquea la transición. El endpoint es `@Roles('gestor')`; el `tenant_id` y el
`usuario_id` (origen Gestor del AUDIT_LOG) derivan del JWT. El frontend ofrece el descarte con un
componente `AccionDescartarPreReserva` de tratamiento **secundario/destructivo** (botón outline,
**NO verde**, patrón `AccionDescartar` de US-013), **visible solo en `pre_reserva`**, y un diálogo
de confirmación con el motivo opcional (RHF + Zod); dicho componente **invoca el MISMO endpoint
`descartar`** que ya cubre el SDK regenerado (no una operación separada). La guarda
`puedeDescartarPreReserva({ estado })` vive en `lib/` (guardrail: no en `components/`). (Fuente:
workstream B; `descartar-consulta-por-cliente.use-case.ts` motivo opcional; `AccionDescartar.tsx`;
`CLAUDE.md §Estructura del frontend`; `er-diagram.md §AUDIT_LOG`.)

#### Scenario: Descartar con motivo lo audita en AUDIT_LOG

- **GIVEN** una RESERVA en `pre_reserva` y un `motivo` informado en el body
- **WHEN** el Gestor confirma el descarte
- **THEN** se registra un `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`, el par
  `pre_reserva → reserva_cancelada` y el `motivo` en `datos_nuevos`

#### Scenario: Descartar sin motivo transiciona igualmente

- **GIVEN** una RESERVA en `pre_reserva` y un body sin `motivo`
- **WHEN** el Gestor confirma el descarte
- **THEN** la transición a `reserva_cancelada` se completa y el `AUDIT_LOG` registra la
  transición sin motivo

#### Scenario: La acción de descarte de pre-reserva se presenta como secundaria/destructiva

- **GIVEN** la sección "Acciones" de una RESERVA en `pre_reserva`
- **WHEN** se renderiza la acción "Descartar pre-reserva"
- **THEN** usa el tratamiento secundario/destructivo (botón outline, NO verde) y su
  visibilidad/habilitación la decide `puedeDescartarPreReserva({ estado })`
