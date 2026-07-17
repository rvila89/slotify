# Change: us-032-forzar-inicio-evento

## Why

Una RESERVA que llega al **día de su `fecha_evento`** en `reserva_confirmada` con **alguna
precondición incumplida** (`pre_evento_status ≠ cerrado` O `liquidacion_status ≠ cobrada` O
`fianza_status ≠ cobrada`) **NO** es transicionada por el cron de inicio automático (US-031,
archivado): permanece en `reserva_confirmada` y el barrido emite una **alerta crítica**
enumerando las precondiciones que faltan. Hoy, ante un impago de última hora o una ficha aún
sin cerrar el día del evento, el gestor **no tiene ninguna vía** de arrancar la ejecución: el
evento físico ocurre igualmente pero el sistema queda "clavado" en `reserva_confirmada`, sin la
vista móvil de ejecución ni el checklist de documentación activos (dolor **D2** — visibilidad y
control del pipeline el día del evento). **US-032 (UC-23 FA-01, actor Gestor)** es el **flujo
alternativo manual** que permite al gestor **forzar** la transición `reserva_confirmada →
evento_en_curso` **aunque las precondiciones no se cumplan**, registrando en `AUDIT_LOG` la
decisión de sobrescritura con `forzado_por_gestor = true` y la **lista de precondiciones
incumplidas** en el momento del forzado, como evidencia de auditoría ante disputas posteriores.
(Fuente: `US-032 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`; `use-cases.md`
UC-23 FA-01; `CLAUDE.md §Máquina de estados`.)

- US-032 es el **contrapunto manual de US-031** sobre la **misma guarda de origen**
  (`reserva_confirmada → evento_en_curso`). La diferencia semántica es una sola: **US-031
  transiciona SOLO si las tres precondiciones se cumplen** (`preconditionesEventoCumplidas().cumple
  === true`); **US-032 fuerza la transición aunque `cumple === false`**, capturando las
  `faltantes` en el audit log. **Reutiliza sin redefinir** las funciones puras ya presentes en
  `apps/api/src/reservas/domain/maquina-estados.ts`: `resolverInicioEvento(estado, subEstado)`
  (guarda de origen) y `preconditionesEventoCumplidas(precondiciones)` (que devuelve `{cumple,
  faltantes}`). No añade tabla ni transición nueva a la máquina de estados: el destino es el
  mismo `evento_en_curso`.
- El **análogo estructural** de esta acción es **US-034 (finalizar evento, archivada)**: una
  acción manual del Gestor sobre UNA reserva concreta con transición de estado, autenticada con
  **JWT de usuario** (rol gestor) bajo RLS del tenant, atomicidad por fila con `SELECT … FOR
  UPDATE` y guarda de origen re-evaluada bajo el lock. US-032 replica ese patrón de endpoint,
  controlador y unidad de trabajo (`POST /reservas/{id}/finalizar-evento` → `POST
  /reservas/{id}/forzar-inicio-evento`).
- La coordinación **cron (US-031) ↔ gestor (US-032)** ya quedó blindada en US-031: la guarda de
  origen se re-evalúa **dentro** de la transacción bajo el `SELECT … FOR UPDATE` de la fila
  RESERVA, de modo que si el cron llegó primero, el forzado del gestor observa `estado ≠
  reserva_confirmada`, la UPDATE afecta **0 filas** y termina como **no-op idempotente** con un
  mensaje "El evento ya está en curso". US-032 aterriza sobre esa misma guarda sin locks
  distribuidos.

## What Changes

- **Extiende la capability existente `consultas`** (NO crea una nueva): `consultas` es dueña del
  ciclo de vida y las transiciones del agregado RESERVA (así lo declara la spec viva). Se añade
  el **forzado manual del inicio de evento por el Gestor** como acción de usuario sobre una
  RESERVA concreta. No se crea capability nueva ni se toca `pipeline`, `ficha-operativa`,
  `facturacion`, `foundation`, `calendario`, `confirmacion` ni `app-shell`. (`spec-delta` en
  `specs/consultas/spec.md`, solo secciones `ADDED`.)
- **Endpoint de acción del gestor** `POST /reservas/{id}/forzar-inicio-evento`, autenticado con
  **JWT de usuario** (rol gestor; NUNCA `X-Cron-Token`, no es un barrido de Sistema), bajo el
  contexto RLS del tenant del gestor. Simetría estricta con `POST /reservas/{id}/finalizar-evento`
  (US-034). Códigos (design.md §D-1):
  - **200** — forzado OK: la RESERVA transiciona a `evento_en_curso`; respuesta con la RESERVA
    resultante + `forzadoPorGestor: true` + `precondicionesIncumplidas: string[]`.
  - **409** (`conflicto_estado`) — la RESERVA ya NO está en `reserva_confirmada` (p. ej. el cron
    de US-031 llegó primero → ya está en `evento_en_curso`): mensaje "El evento ya está en curso
    (iniciado automáticamente o por otro usuario). No es necesaria ninguna acción." Idempotencia.
  - **422** (`fecha_evento_no_es_hoy`) — la RESERVA está en `reserva_confirmada` pero
    `date(fecha_evento) ≠ date(hoy)`: el forzado SOLO es válido el día del evento.
  - **404** — RESERVA inexistente o de otro tenant (bajo RLS).
- **Guarda de fecha (`fecha_evento = TODAY`)**: el forzado SOLO el día del evento. Es una guarda
  de PRECONDICIÓN sobre el estado actual del agregado (no una transición nueva), modelada como
  **función de dominio pura** en `maquina-estados.ts` (`esDiaDelEvento(fechaEvento, hoy)`),
  coherente con la comparación **por fecha de calendario** que fijó US-031 (una sola definición
  de "hoy" en la zona horaria de negocio del servidor/tenant; NO depende de strings formateados;
  blinda el off-by-one de TZ conocido). Se re-evalúa en la aplicación antes de abrir la
  transacción → 422 sin efectos.
- **Transición forzada atómica** bajo el contexto RLS del tenant: `SELECT … FOR UPDATE` de la
  fila RESERVA + re-evaluación de la **guarda de origen** (`resolverInicioEvento`) bajo el lock;
  UPDATE condicional `WHERE estado = 'reserva_confirmada'`; **0 filas → no-op idempotente → 409**
  (coordinación cron↔gestor y doble sesión del gestor). NO Redis/Redlock/locks distribuidos (hook
  `no-distributed-lock`; misma serialización que US-031/US-034 sobre la fila RESERVA).
- **Cálculo de las precondiciones incumplidas** vía la función pura reutilizada
  `preconditionesEventoCumplidas(precondiciones)`: la lista `faltantes` (leída de la fila bajo el
  lock: `pre_evento_status`, `liquidacion_status`, `fianza_status`) se persiste en el audit log.
  El forzado se ejecuta **con independencia** de `cumple` (a diferencia de US-031, que exige
  `cumple === true`).
- **AUDIT_LOG (evidencia de auditoría OBLIGATORIA)**: `accion = 'transicion'`, `entidad =
  'RESERVA'`, origen **Usuario** (con el `usuario_id` del gestor, a diferencia del origen Sistema
  de US-031), `datos_anteriores = {estado: reserva_confirmada}`, `datos_nuevos = {estado:
  evento_en_curso, forzado_por_gestor: true, precondiciones_incumplidas: [lista]}`. La lista sale
  de `preconditionesEventoCumplidas().faltantes`. Si en el momento del forzado las tres
  precondiciones estuvieran cumplidas (caso borde: se cumplieron entre la carga y el forzado),
  `precondiciones_incumplidas` es `[]` y `forzado_por_gestor` sigue siendo `true`.
- **Los sub-procesos incumplidos NO se resuelven**: `pre_evento_status`, `liquidacion_status` y
  `fianza_status` conservan su valor tras el forzado (quedan pendientes para gestión posterior).
  El forzado solo muta `RESERVA.estado`.
- **Frontend (acción del gestor en la ficha)**: la ficha de la reserva muestra la **lista de
  precondiciones incumplidas** (derivada en cliente de los `*_status` que **ya expone** `GET
  /reservas/{id}` — `ReservaDetalle`) y un botón **"Forzar inicio del evento"** visible SOLO si
  `estado = 'reserva_confirmada'` **AND** `fecha_evento = hoy`, con **doble confirmación**
  obligatoria (guardarraíl no eludible por URL/shortcut). **NO se necesita endpoint GET nuevo**:
  el detalle actual ya expone `estado`, `fechaEvento`, `preEventoStatus`, `liquidacionStatus`,
  `fianzaStatus` y `condPartFirmadas` (verificado en `reserva-detalle.dto.ts`). Mobile-first
  (390/768/1280).

## Impact

- Specs afectadas: **se extiende `consultas`** con `ADDED Requirements` para el forzado manual del
  inicio de evento (endpoint del gestor, guarda de fecha `fecha_evento = hoy`, forzado
  incondicional respecto a precondiciones, no-resolución de sub-procesos, auditoría origen Usuario
  con `forzado_por_gestor`, idempotencia/concurrencia cron↔gestor, doble confirmación en UI). NO
  se crea capability nueva; NO se modifican `pipeline`, `ficha-operativa`, `facturacion`,
  `foundation`, `calendario`, `confirmacion` ni `app-shell`. (`spec-delta` en
  `specs/consultas/spec.md`, solo `ADDED`.)
- Datos: **ninguna entidad ni migración de esquema nueva**. Usa `RESERVA` (`estado`,
  `pre_evento_status`, `liquidacion_status`, `fianza_status`, `fecha_evento`) y `AUDIT_LOG` — todo
  provisionado por US-021 (RESERVA confirmada), US-025/US-026 (`pre_evento_status`), US-029
  (`liquidacion_status`), US-030 (`fianza_status`). El estado `evento_en_curso` ya existe en el
  enum (`maquina-estados.ts`, Prisma, contrato `EstadoReserva`). El dominio ya expone
  `resolverInicioEvento` y `preconditionesEventoCumplidas` (US-031): US-032 solo AÑADE
  `esDiaDelEvento` (guarda de fecha pura).
- Contrato OpenAPI: **añade** `POST /reservas/{id}/forzar-inicio-evento` (seguridad JWT rol
  gestor; 200 con la RESERVA + `forzadoPorGestor` + `precondicionesIncumplidas`; 409
  `conflicto_estado`; 422 `fecha_evento_no_es_hoy`; 404), calcado de `POST
  /reservas/{id}/finalizar-evento` de US-034. `evento_en_curso` ya está en el enum del contrato.
  Se **regenera el SDK** del frontend (nunca editado a mano). El detalle de la reserva (`GET
  /reservas/{id}`) NO cambia: ya expone los `*_status` y `fecha_evento` que la UI necesita.
- Multi-tenancy/RLS: acción de **Usuario**; el `tenant_id` y `usuario_id` derivan SIEMPRE del JWT
  (`@CurrentUser`), NUNCA del path/body. La transición se ejecuta bajo `SET LOCAL app.tenant_id`
  del tenant del gestor; una RESERVA de otro tenant es invisible bajo RLS → 404. Mismo patrón que
  US-034.
- Concurrencia: **TDD primero** en (a) coordinación cron (US-031) ↔ gestor sobre la misma RESERVA
  (exactamente una UPDATE gana; la del gestor observa 0 filas si el cron llegó primero → 409
  no-op), y (b) doble sesión/doble click del gestor. La serialización la da PostgreSQL sobre la
  fila RESERVA (`SELECT … FOR UPDATE`); no hay `FECHA_BLOQUEADA` ni cola implicados. Se vigila el
  flaky conocido de US-004 (`40P01`) al leer la suite global, ajeno a este change.
- Trazabilidad: **US-032**, **UC-23 FA-01**, dolor **D2**; reutiliza US-031 (guarda de origen +
  guarda de precondiciones + coordinación cron↔gestor), US-034 (patrón de acción manual del
  gestor: endpoint, controlador, UoW, doble confirmación en UI), US-021/US-025/US-026/US-029/US-030
  (precondiciones que se muestran incumplidas). No dispara ningún email (E1–E8): acción manual sin
  correo (`US-032 §Email relacionado: ninguno`).
- **Fuera de alcance (out-of-scope explícito)**:
  - La **resolución de los sub-procesos incumplidos** (`pre_evento_status`, `liquidacion_status`,
    `fianza_status`): US-032 NO los toca; siguen pendientes para gestión posterior.
  - La **vista móvil "evento en curso"** y el **checklist de documentación del evento** →
    **US-033/US-034**. US-032 solo deja la RESERVA en `evento_en_curso`, estado que las habilita.
  - El **briefing operativo PDF al equipo** (UC-23 paso 5) → 📐 diseñado pero NO implementado en
    MVP TFM. US-032 NO genera ni envía briefing. Sin código E en esta acción.
  - La **superficie de notificaciones/alertas del gestor** (US-044): la alerta crítica que motiva
    el forzado la produce US-031; US-032 consume su información (precondiciones incumplidas
    derivadas del detalle de la reserva) pero no construye una superficie de notificaciones. El
    rastro auditable del forzado es `AUDIT_LOG`.
  - La **finalización del evento** (`evento_en_curso → post_evento`) → **US-034** (ya archivada).
