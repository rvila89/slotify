# Change: us-031-inicio-automatico-evento

## Why

Una RESERVA que llega al **día de su `fecha_evento`** con toda la preparación financiera y
operativa completada (`pre_evento_status = cerrado`, `liquidacion_status = cobrada`,
`fianza_status = cobrada`) debe **arrancar automáticamente** su ejecución: transicionar
`reserva_confirmada → evento_en_curso` a las 00:00 del día del evento, sin que el gestor
tenga que actuar. Hoy esa transición se haría manualmente o **se olvidaría**, dejando el
evento en `reserva_confirmada` con la vista móvil de ejecución sin activar (dolores **D9**
—sin automatizaciones—, **D10** —garantía de ficha cerrada—, **D2** —el estado del evento
pasa a ser visible en el pipeline en tiempo real—). **US-031 (UC-23 flujo básico, actor
Sistema)** es el mecanismo automático que, el día `T-0`, evalúa las tres precondiciones y
transiciona la RESERVA cuando (y solo cuando) las tres son ciertas simultáneamente.
(Fuente: `US-031 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`; `use-cases.md`
UC-23; `CLAUDE.md §Máquina de estados`.)

- US-031 se apoya en el **patrón obligatorio "estado en fila + barrido periódico"**
  (`CLAUDE.md §Jobs asíncronos`; `architecture.md §2.5`; skill `async-jobs`): un cron
  scheduler invoca un **endpoint interno protegido** (`X-Cron-Token`) idempotente que barre
  las RESERVA elegibles y transiciona las que cumplen las tres precondiciones. El campo "en
  fila" es `RESERVA.estado` + `RESERVA.fecha_evento` (comparada con **hoy**) + los tres
  `*_status`. **PROHIBIDO** Lambda/EventBridge ni timers exactos. Mismo estilo que **US-012**
  (barrido de expiración por TTL) y **US-026** (barrido de cierre de fichas en T-1d), ya
  archivados: endpoint protegido idempotente que devuelve un resumen del barrido, con fallo
  aislado por RESERVA y contexto RLS por tenant.
- El actor es el **Sistema**, no un usuario: US-031 **no aporta pantalla ni endpoint de
  usuario nuevos**. El único efecto observable en UI es que, tras el barrido, la RESERVA
  aparece en `evento_en_curso` en el pipeline/calendario (color heredado, US-039/US-049) y
  se activa la vista móvil "evento en curso" con el checklist de documentación pendiente
  (DNI anverso, DNI reverso, cláusula de responsabilidad). **La vista móvil y su checklist
  son la superficie de US-033/US-034** (documentación del evento); US-031 solo **deja la
  RESERVA en el estado que las habilita**, no construye esa UI. (Ver §Impact, out-of-scope.)
- La transición reutiliza la **máquina de estados declarativa** del agregado RESERVA
  (`apps/api/src/reservas/domain/maquina-estados.ts`), añadiendo la guarda de origen
  `reserva_confirmada → evento_en_curso` como **estructura de datos** (misma forma que
  `resolverExpiracionTtl`/`resolverPromocionCola`), y la **convención de auditoría de
  Sistema** de US-012/US-026 (`accion = 'transicion'`, `entidad = 'RESERVA'`, `usuario_id`
  no poblado, causa en `datos_nuevos`). Deja cubiertas por US-025/US-026 (`pre_evento_status
  = cerrado`), US-029 (`liquidacion_status = cobrada`) y US-030 (`fianza_status = cobrada`)
  las tres precondiciones que consume. (`US-031 §Dependencias`.)

## What Changes

- **Extiende la capability existente `consultas`** (NO crea una nueva): `consultas` es dueña
  del ciclo de vida y las transiciones del agregado RESERVA (así lo declara la spec viva de
  `pipeline`: "`consultas` sigue siendo dueña del ciclo de vida y las transiciones del
  agregado RESERVA"). Se añade la **transición automática a `evento_en_curso` en T-0** como
  efecto del barrido periódico (automatización de inicio de evento). No se crea capability
  nueva ni se toca `pipeline` (lectura pura), `ficha-operativa`, `facturacion`, `foundation`,
  `calendario`, `confirmacion` ni `app-shell`. (`spec-delta` en `specs/consultas/spec.md`.)
- **Barrido interno protegido de inicio de eventos**, autenticado **service-to-service** con
  la cabecera `X-Cron-Token` (nunca JWT de usuario; `CRON_TOKEN` ya en `env.validation.ts` y
  `CronTokenGuard` reutilizable de US-012/US-026). Idempotente: re-ejecutarlo no re-transiciona
  reservas ya en `evento_en_curso` ni duplica `AUDIT_LOG`. Devuelve un **resumen** del barrido
  (candidatas evaluadas, eventos iniciados, precondiciones incumplidas/alertadas, fallos
  aislados). **Reutiliza el endpoint genérico `POST /cron/barrido`** ya declarado en el
  contrato: la enum `tarea` **ya incluye `eventos`** y su comentario **ya nombra US-031** como
  dueña de ese barrido (`docs/api-spec.yml`, `/cron/barrido`: `tarea: [expiracion, cola,
  fichas, eventos, archivado, recordatorios, all]`; comentario `[DECISIÓN granularidad]`).
- **Cron scheduler** (`@nestjs/schedule`) que invoca el endpoint **una vez al día** a las
  **00:00 del día del evento** (T-0) con el token. El scheduler no ejecuta lógica de negocio:
  solo dispara el endpoint (invocable manualmente y testeable por HTTP).
- **Selección de candidatas** (filtro estricto, comparación por **fecha de calendario**, no
  por instante): `RESERVA.estado = 'reserva_confirmada'` **AND** `date(RESERVA.fecha_evento) =
  date(hoy)` (día T-0 = hoy). El filtro por estado garantiza la **idempotencia** (una RESERVA
  ya en `evento_en_curso` no es candidata) y evita falsos positivos sobre otros estados.
- **Evaluación de las tres precondiciones en una única lectura de la fila**, dentro de la
  transacción de cada RESERVA: `pre_evento_status = 'cerrado'` **AND** `liquidacion_status =
  'cobrada'` **AND** `fianza_status = 'cobrada'`. Modelada como **guarda declarativa** en la
  máquina de estados (no `if` dispersos).
- **Acción por candidata con las tres precondiciones cumplidas**, en una **transacción
  atómica** bajo el contexto RLS del tenant: re-evaluar la guarda bajo `SELECT … FOR UPDATE`
  de la fila RESERVA, transicionar `RESERVA.estado: reserva_confirmada → evento_en_curso`, y
  registrar en `AUDIT_LOG` una entrada con `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores = {estado: reserva_confirmada}`, `datos_nuevos = {estado:
  evento_en_curso}`, origen **Sistema** (causa de la automatización en `datos_nuevos`).
- **Precondiciones incumplidas → NO transiciona + alerta crítica al gestor**: si alguna de
  las tres precondiciones no se cumple el día del evento, el barrido **no** transiciona la
  RESERVA (permanece `reserva_confirmada`) y genera una **alerta crítica** al gestor
  enumerando las precondiciones incumplidas ("El evento de hoy [código] tiene precondiciones
  incumplidas: [lista]. Puedes forzar el inicio manualmente."). El **forzado manual** es
  US-032 (fuera de alcance). El resumen del barrido contabiliza estas candidatas como
  precondiciones incumplidas.
- **A29 (efecto colateral, no bloqueante)**: si `RESERVA.cond_part_firmadas = false` el día
  del evento, se genera una **alerta NO bloqueante** al gestor ("Las condiciones particulares
  de esta reserva no están firmadas. El cliente puede firmarlas presencialmente."). A29 **no
  impide** la transición: si las tres precondiciones se cumplen, la RESERVA transiciona a
  `evento_en_curso` **igualmente**. A29 se evalúa con independencia del resultado de la
  transición.
- **Idempotencia**: una RESERVA ya en `evento_en_curso` (transicionada por un pase anterior o
  por el gestor vía US-032) **no** es candidata (el filtro `estado = 'reserva_confirmada'` la
  excluye); N ejecuciones del barrido sobre la misma RESERVA = **1 sola** transición y **1
  sola** entrada en `AUDIT_LOG`. La guarda de origen se re-evalúa **dentro** de la transacción
  bajo el lock, de modo que un reintento o un pase concurrente re-lea el `estado` ya
  actualizado.
- **Concurrencia cron vs gestor (US-032)**: si el cron y el gestor intentan transicionar la
  misma RESERVA a la vez, **exactamente una** UPDATE gana (la segunda observa `estado ≠
  reserva_confirmada` y afecta **0 filas** bajo el lock) → **no-op sin error** y **una sola**
  entrada de transición en `AUDIT_LOG`. La serialización la da PostgreSQL sobre la fila
  RESERVA (`SELECT … FOR UPDATE`), sin locks distribuidos (hook `no-distributed-lock`).
- **Procesa todas las elegibles en el mismo pase** con **fallo aislado por RESERVA**: el fallo
  de una transición (excepción/conflicto/guarda) no aborta ni revierte las demás; el resumen
  registra el fallo aislado. Mismo aislamiento que el lote de US-012/US-026.

## Impact

- Specs afectadas: **se extiende `consultas`** con `ADDED Requirements` para la transición
  automática a `evento_en_curso` en T-0 (barrido periódico protegido, guarda de las tres
  precondiciones, idempotencia, concurrencia cron↔gestor, A29, alerta por precondiciones
  incumplidas, auditoría de Sistema). NO se crea capability nueva; NO se modifican `pipeline`,
  `ficha-operativa`, `facturacion`, `foundation`, `calendario`, `confirmacion` ni `app-shell`.
  (`spec-delta` en `specs/consultas/spec.md`.)
- Datos: **ninguna entidad ni migración de esquema nueva**. Usa `RESERVA` (`estado`,
  `pre_evento_status`, `liquidacion_status`, `fianza_status`, `fecha_evento`,
  `cond_part_firmadas`) y `AUDIT_LOG` — todo provisionado por US-021 (RESERVA confirmada +
  FICHA_OPERATIVA), US-025/US-026 (`pre_evento_status`), US-029 (`liquidacion_status`) y
  US-030 (`fianza_status`, `cond_part_firmadas`). El estado `evento_en_curso` ya existe en el
  enum de estados de la RESERVA (`maquina-estados.ts`, `EstadoReserva`; enum Prisma; contrato
  `EstadoReserva`).
- Contrato OpenAPI: **reutiliza** el endpoint genérico de cron ya presente `POST
  /cron/barrido` — la enum `tarea` **ya reserva `eventos`** y su comentario `[DECISIÓN
  granularidad]` **ya nombra US-031** como dueña de ese barrido. **Decisión de gate D-2**: el
  `contract-engineer` decidirá tras el gate entre (A) reutilizar `POST /cron/barrido?tarea=
  eventos` ampliando `BarridoResponse` con un subobjeto `eventos: { candidatas,
  eventosIniciados, precondicionesIncumplidas, fallos }` (simetría con `BarridoResponse.fichas`
  de US-026, preferida), o (B) endpoint dedicado `POST /cron/barrido-eventos` con
  `BarridoEventosResponse` (simetría con `POST /cron/barrido-expiracion` de US-012). Auth
  `X-Cron-Token` (no JWT) e idempotencia son innegociables en ambas. **No hay endpoint ni SDK
  de usuario nuevos**: la vista móvil "evento en curso" consume el estado ya expuesto por
  `GET /reservas` (US-049) y no requiere nada de este change.
- Infra transversal: reutiliza `@nestjs/schedule` (activado en US-012) para el `@Cron` diario
  a las 00:00; consume `CRON_TOKEN` (ya declarado) y `CronTokenGuard` (US-012/US-026).
  Documentar el barrido de inicio de eventos en `architecture.md §2.5` junto a los de
  expiración (US-012) y cierre de fichas (US-026).
- Multi-tenancy/RLS: el barrido es un proceso de **Sistema**; opera **cross-tenant** (una
  pasada evalúa candidatas de todos los tenants) pero **cada** transición se ejecuta bajo el
  **contexto RLS del tenant** de la RESERVA (`SET LOCAL app.tenant_id`), como en US-012/US-026.
  El `tenant_id` proviene de la fila candidata, nunca de input externo.
- Concurrencia: **TDD primero** en (a) la idempotencia (doble pase del cron), (b) la
  coordinación cron vs gestor (US-032) sobre la misma RESERVA (exactamente una UPDATE gana,
  0 filas la segunda), y (c) el aislamiento de fallos por RESERVA. La serialización la da
  PostgreSQL sobre la fila RESERVA (`SELECT … FOR UPDATE`); no hay `FECHA_BLOQUEADA` ni cola
  implicados (zona menos crítica que US-012). Se vigila el flaky conocido de US-004 (`40P01`)
  al leer la suite global, ajeno a este change.
- Trazabilidad: **US-031**, **UC-23** (flujo básico), dolores **D9**/**D10**/**D2**;
  automatización de inicio de evento + **A29** (efecto colateral); reutiliza US-021 (RESERVA
  confirmada), US-025/US-026 (`pre_evento_status = cerrado`), US-029 (`liquidacion_status =
  cobrada`), US-030 (`fianza_status = cobrada`) y el patrón de cron de US-012/US-026.
- **Fuera de alcance (out-of-scope explícito)**:
  - El **forzado manual** de la transición por el gestor cuando hay precondiciones incumplidas
    (FA-01 de UC-23) → **US-032**. US-031 solo alerta; no ofrece endpoint de forzado.
  - La **construcción de la vista móvil "evento en curso"** y el **checklist de documentación
    del evento** (DNI anverso/reverso, cláusula de responsabilidad) → **US-033/US-034**. US-031
    solo deja la RESERVA en `evento_en_curso`, estado que habilita esa UI.
  - El **briefing operativo PDF al equipo** el día del evento (UC-23 paso 5) → 📐 **diseñado
    pero NO implementado en MVP TFM** (§9.3 último párrafo). US-031 **NO** genera ni envía
    briefing. Sin código E en esta acción.
  - **A9 (recordatorio de briefing al equipo en T-3d)** → 📐 **lista negra** (recordatorios
    automáticos extendidos). No implementado.
  - La **superficie de notificaciones/alertas del gestor** (dashboard de notificaciones,
    US-044): US-031 **produce** las alertas (A29 no bloqueante y la crítica por precondiciones
    incumplidas) pero su **materialización/entrega** (canal, persistencia, UI) sigue la
    convención ya establecida para alertas de Sistema; este change no construye una superficie
    de notificaciones nueva. El rastro auditable de la transición es `AUDIT_LOG`.
