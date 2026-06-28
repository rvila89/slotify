# Change: us-004-alta-consulta-con-fecha

## Why

US-004 cierra el flujo de alta de leads con su caso **crítico anti-doble-reserva
(D4)**: dar de alta un lead **con `fecha_evento` concreta**. A diferencia de US-003
(alta exploratoria sin fecha → siempre `2.a`), aquí el sub-estado de la RESERVA
depende del **estado de disponibilidad de la fecha** para el tenant y, si la fecha
está libre, el sistema **bloquea atómicamente** la fecha durante
`TENANT_SETTINGS.ttl_consulta_dias` (3 por defecto). Resuelve **D4** (riesgo de
doble reserva, crítico), **D1/D2** (fuente única de verdad y pipeline), **D9**
(automatización E1) y **D13** (leads en fechas bloqueadas gestionados sin promesas
verbales). (Fuente: `US-004 §Historia`, `§Contexto de Negocio`, UC-03; A1, A14.)

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Alta de US-003** (`POST /reservas`): `AltaConsultaUseCase` +
  `UnidadDeTrabajoPrismaAdapter` (transacción única con `fijarTenant` RLS),
  find-or-create de CLIENTE, COMUNICACION E1 (enviado/borrador), AUDIT_LOG
  (`accion='crear'`, `entidad='RESERVA'`), máquina de estados declarativa mínima
  (`maquina-estados.ts`). El DTO `CreateReservaRequestDto` ya declara `fechaEvento?`
  como opcional reservado para esta US.
- **Bloqueo atómico de US-040** (`bloquearFecha()`): `resolverPlanBloqueo()` (función
  pura, mapa fase→`{tipo,ttl,modo}`; `2.b → {insert, blando, now()+ttl_consulta_dias}`)
  + `FechaBloqueadaPrismaAdapter` (transacción con `SELECT … FOR UPDATE` + INSERT,
  traducción `P2002 → FechaYaBloqueadaError`) + `UNIQUE(tenant_id, fecha)`.
- **Motor de tarifa de US-016** (`CalculadoraTarifaService.calcular()`): para la
  tarifa estimada de E1 cuando hay fecha + invitados + horas.
- **Schema Prisma (US-000)**: `Reserva.posicion_cola`, `consulta_bloqueante_id`
  (+ self-relation `ColaEspera` e `@@index([tenantId, consultaBloqueanteId,
  posicionCola])`), `ttl_expiracion`; `FechaBloqueada.tipo_bloqueo`;
  `TenantSettings.ttl_consulta_dias`. Todo presente: **sin migración de columnas**.

(Fuente: ver `design.md` para firmas y rutas reales.)

## What Changes

> Slice vertical (backend + contrato + frontend "Nueva consulta" con selector de
> fecha). Sujeto al **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Alta con fecha sobre el MISMO `POST /reservas`** (sin endpoint nuevo): cuando
  el body trae `fecha_evento`, el caso de uso **ramifica** el sub-estado según el
  estado de la fecha para el tenant. El flujo **sin** `fecha_evento` (US-003 → `2.a`)
  queda **intacto** (regresión cero). (Fuente: `US-004 §Reglas de negocio`.)
- **Fecha libre → `2.b` + bloqueo blando**: crea la RESERVA en `sub_estado='2b'`,
  `ttl_expiracion = now()+ttl_consulta_dias`, e **inserta** `FECHA_BLOQUEADA` con
  `tipo_bloqueo='blando'` y el mismo `ttl_expiracion`, **en la misma transacción**
  que la RESERVA. (Fuente: `US-004 §Happy Path`.)
- **Fecha bloqueada por consulta en `2.b` → cola `2.d`**: crea la RESERVA en
  `sub_estado='2d'`, `posicion_cola = MAX(posición de esa fecha)+1`,
  `consulta_bloqueante_id` = id de la bloqueante; **NO** inserta `FECHA_BLOQUEADA`.
  (Fuente: `US-004 §FA entrada en cola`, A14.)
- **Fecha bloqueada por `2.c`/`2.v`/`pre_reserva`/`reserva_confirmada`/posteriores →
  `2.a`**: crea la RESERVA exploratoria (sin bloqueo, sin cola) + aviso UI. (Fuente:
  `US-004 §FA va a 2.a`.)
- **Concurrencia D4**: dos altas simultáneas misma `(tenant,fecha)` libre → una gana
  `2.b` (+`FECHA_BLOQUEADA`), la otra recibe la violación `UNIQUE(tenant_id,fecha)`
  y **se recrea como `2.d`** (re-derivación del sub-estado en el reintento). Cubierto
  con **tests de concurrencia reales** en TDD-RED. (Fuente: `US-004 §Concurrencia`.)
- **Validación `fecha_evento > hoy` (estrictamente futura)** en cliente y servidor,
  reutilizando `validarFechaFutura` (US-040): selector bloquea pasado **y hoy**;
  servidor rechaza el bypass (pasado o hoy) con 400 sin crear nada. **Divergencia
  intencional aprobada en el Gate 1** respecto a la ficha (que decía `≥ hoy`), para
  unificar la regla de fecha con bloqueo y tarifa. (Fuente: `US-004 §FA-01`,
  `§Validación`; `design.md §D-1`.)
- **E1 con tarifa estimada**: si hay fecha + nº invitados + horas, E1 incluye la
  tarifa de UC-16; si faltan, E1 sale con el **dossier general sin precio**. La regla
  enviado/borrador (según `comentarios`) de US-003 se mantiene. (Fuente:
  `US-004 §Email relacionado`, `§FA solo fecha`.)
- **Frontend "Nueva consulta"**: añadir selector de fecha (bloquea < hoy) y los
  avisos de resultado (bloqueada→cola, no disponible→exploratoria, borrador E1).

## Impact

- Specs: **modifica la capability `consultas`** (añade requisitos de alta con
  fecha 2.b/2.d/2.a, bloqueo blando en 2.b, cola, D4, tarifa en E1; ajusta E1 para
  la tarifa estimada). **Reutiliza sin modificar** `bloqueo-fecha` (US-040) y
  `calculo-tarifa` (US-016).
- Contrato OpenAPI (`docs/api-spec.yml`): `POST /reservas` ya admite `fechaEvento?`;
  el `contract-engineer` (post-gate) ampliará el `ReservaResponse` para exponer
  `subEstado ∈ {2a,2b,2d}`, `ttlExpiracion`, `posicionCola`, `fechaDisponible`/aviso,
  y el bloque de tarifa estimada. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**`
  (ramificación de sub-estado, bloqueo en la UoW, cola, puerto a tarifa),
  `apps/web/src/**` (selector de fecha + avisos).
- **Migración**: **no** para columnas (todas existen). **Recomendada** (aditiva): un
  índice **UNIQUE parcial** `(tenant_id, consulta_bloqueante_id, posicion_cola)
  WHERE posicion_cola IS NOT NULL` como defensa-en-profundidad de la unicidad de la
  cola (ver `design.md §5, §8`).
- Trazabilidad: **US-004**, **UC-03**; entidades RESERVA, CLIENTE, FECHA_BLOQUEADA,
  COMUNICACION, AUDIT_LOG, TENANT_SETTINGS, TARIFA, TEMPORADA_CALENDARIO;
  automatizaciones **A1**, **A14**; email **E1**.
- Dependencias: US-001 (sesión), US-003 (alta/RESERVA), US-040 (bloqueo), US-016
  (tarifa) — todas en `master`.

## Lo que NO entra (anti-scope)

- **Gestión posterior de la cola (UC-11/12/13)**: promoción, reordenación, vaciado,
  notificación al promovido. Aquí solo la **entrada** a la cola (`2.d` + posición +
  bloqueante) al crear el lead (A14). (Fuente: `US-004 §Notas de alcance`.)
- **Emails automáticos de posición de cola al cliente**: 📐 solo diseñado en MVP; el
  gestor ve la posición en la UI (UC-11), el cliente no recibe email. (Fuente:
  `US-004 §Notas de alcance`.)
- **Detección de recurrencia / cliente recurrente**: 📐 fuera de MVP. (Fuente:
  `US-004 §Notas de alcance`.)
- **Infra real de envío de email (US-045)**: E1 se persiste y el envío usa el
  **stub** de `EnviarEmailPort` de US-003.
- **Liberación / expiración del bloqueo (US-041)**: ya existe; no se toca aquí.

## Decisiones de alcance pendientes de aprobación humana

Las 8 decisiones de diseño (reutilización del alta; integración del bloqueo;
función de sub-estado; integración de la tarifa; `posicion_cola` atómica;
concurrencia D4; `ttl_consulta_dias`; migración) están **razonadas con
recomendación** en `design.md`. Quedan **abiertas hasta el OK del Gate SDD**.
