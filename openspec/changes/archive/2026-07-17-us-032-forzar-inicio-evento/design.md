# Design — us-032-forzar-inicio-evento

## Context

US-032 (UC-23 **FA-01**, actor **Gestor**) es el **flujo alternativo manual** del inicio de
evento: cuando el cron de US-031 (archivado) NO transiciona una RESERVA en `reserva_confirmada`
el día `T-0` porque **alguna precondición está incumplida**, el gestor puede **forzar**
`RESERVA.estado: reserva_confirmada → evento_en_curso` asumiendo el riesgo, con trazabilidad
completa en `AUDIT_LOG`. La infraestructura y las mutaciones de dominio que necesita ya existen
y **se reutilizan sin redefinir**:

- **US-031** (archivada) añadió a `maquina-estados.ts` la **guarda de origen declarativa**
  `MAPA_INICIO_EVENTO` / `resolverInicioEvento(estado, subEstado)` (única arista
  `reserva_confirmada → evento_en_curso`) y la **guarda pura de las tres precondiciones**
  `preconditionesEventoCumplidas(precondiciones)` que devuelve `{ cumple, faltantes }`. US-032
  reutiliza **ambas tal cual**: la única diferencia con US-031 es que **fuerza la transición
  aunque `cumple === false`** y persiste `faltantes` en el audit log. NO añade tabla ni arista
  nueva a la máquina de estados (el destino es el mismo `evento_en_curso`).
- **US-034** (archivada) aportó el **patrón de acción manual del Gestor sobre UNA reserva**: un
  controlador `POST /reservas/{id}/finalizar-evento` con `RolesGuard` + `@Roles('gestor')`, un
  `FinalizarEventoUseCase` que carga la RESERVA bajo RLS, aplica la guarda de origen previa (409),
  abre una unidad de trabajo con `SELECT … FOR UPDATE` + UPDATE condicional (0 filas → conflicto)
  y audita con origen **Usuario** (`usuario_id` poblado). US-032 replica ese esqueleto: endpoint,
  controlador, use-case y unidad de trabajo Prisma.
- **`maquina-estados.ts`** ya modela las guardas de PRECONDICIÓN sobre el estado actual del
  agregado como funciones puras (`esEstadoConBloqueoBlandoExtensible`,
  `esEstadoValidoParaRegistrarFirmaCondiciones`, `esEstadoValidoParaEditarPresupuesto`). US-032
  añade una del mismo tipo: `esDiaDelEvento(fechaEvento, hoy)` (guarda de fecha).
- `AuditLogPort` compartido con `usuarioId` poblado (acción de Usuario). El detalle de la reserva
  (`GET /reservas/{id}` → `ReservaDetalle`) **ya expone** `estado`, `fechaEvento`,
  `preEventoStatus`, `liquidacionStatus`, `fianzaStatus` y `condPartFirmadas` (verificado en
  `apps/api/src/reservas/interface/reserva-detalle.dto.ts`).

Este documento fija las decisiones no triviales. La **decisión de alcance que requiere
aprobación en el gate humano** es **D-1** (verbo/ruta del endpoint y códigos de estado).

## D-1. Endpoint de la acción del gestor y códigos de estado — DECISIÓN DE ALCANCE (gate)

**Contexto**: es una acción manual sobre una RESERVA concreta, autenticada con **JWT de usuario**
(rol gestor), bajo RLS del tenant. NO es un barrido de Sistema → **no** usa `X-Cron-Token` ni
vive bajo `/cron`. Debe encajar en la convención de acciones de transición manual ya existente
(US-014/US-021/US-019/US-034).

**Decisión propuesta (a aprobar en el gate)** — el `contract-engineer` materializa verbo/ruta/DTO
exactos tras el gate:

- **Endpoint (preferido)**: `POST /reservas/{id}/forzar-inicio-evento`, **gemelo estricto** de
  `POST /reservas/{id}/finalizar-evento` (US-034). Verbo de dominio explícito, coherente con las
  acciones de transición manual existentes; deja hueco natural para exponer
  `forzadoPorGestor: true` y `precondicionesIncumplidas: string[]` en la respuesta. Se descarta un
  `PATCH /reservas/{id}` genérico (oculta la semántica del forzado y la evidencia de auditoría).
- **Request**: body vacío `{}` (o ausente). El `{id}` de la ruta identifica la RESERVA; el
  `tenant_id` y el `usuario_id` derivan SIEMPRE del JWT (`@CurrentUser`), NUNCA del path/body.
- **Respuesta 200** (forzado OK): `allOf(Reserva)` con la RESERVA re-leída post-commit (ya en
  `evento_en_curso`) + `forzadoPorGestor: boolean` (siempre `true`) + `precondicionesIncumplidas:
  string[]` (la lista `faltantes` en el momento del forzado; `[]` si por un caso borde estaban las
  tres cumplidas). Misma forma que la respuesta de US-034 (`allOf(Reserva) + {…}`).
- **Códigos de estado (decisión explícita del gate)**:
  - **409 (`conflicto_estado`)** ⇔ `estado ≠ reserva_confirmada`. Cubre: el cron de US-031 llegó
    primero y la RESERVA **ya está en `evento_en_curso`** (idempotencia, mensaje "El evento ya
    está en curso (iniciado automáticamente o por otro usuario). No es necesaria ninguna acción.");
    y cualquier otro estado (`consulta`/`pre_reserva`/`post_evento`/`reserva_completada`/
    `reserva_cancelada`). Es un **conflicto de estado** (el recurso está en un estado que impide la
    acción), igual que el 409 de US-034. **RESUELTO: `estado ≠ reserva_confirmada → 409`.**
  - **422 (`fecha_evento_no_es_hoy`)** ⇔ `estado = reserva_confirmada` **pero** `date(fecha_evento)
    ≠ date(hoy)`. Es una **precondición de negocio no satisfecha** (el forzado solo el día del
    evento): el estado de la reserva sí permitiría la acción, pero la regla temporal la veta. Se
    separa del 409 porque es una causa distinta (fecha, no estado) y merece un mensaje propio.
    **RESUELTO: `fecha_evento ≠ hoy` (con estado `reserva_confirmada`) → 422.** Nota UX: el botón
    de la UI solo aparece con `fecha_evento = hoy`, así que el 422 es una **defensa de servidor**
    (guardarraíl no eludible por URL/shortcut), no un flujo esperado por el botón.
  - **404** ⇔ RESERVA inexistente o de otro tenant (invisible bajo RLS). Igual que US-034.
- **Orden de evaluación (importa para el código correcto)**: (1) cargar RESERVA bajo RLS → `null`
  ⇒ **404**; (2) guarda de origen `resolverInicioEvento(estado, subEstado)` → `null` (estado ≠
  `reserva_confirmada`) ⇒ **409**; (3) guarda de fecha `esDiaDelEvento(fechaEvento, hoy)` → `false`
  ⇒ **422**; (4) transacción con `SELECT … FOR UPDATE` + UPDATE condicional → **0 filas** (carrera
  perdida bajo el lock) ⇒ **409** (el estado ya no es `reserva_confirmada`).

## D-2. Guarda de fecha `fecha_evento = TODAY` — dominio puro, fecha de calendario del servidor

- **Dónde vive**: en el **dominio puro** (`maquina-estados.ts`), como función
  `esDiaDelEvento(fechaEvento: Date, hoy: Date): boolean` que compara por **fecha de calendario**
  (año-mes-día), NO por instante. Es una **guarda de PRECONDICIÓN** sobre el estado actual del
  agregado (como `esEstadoValidoParaEditarPresupuesto`), no una transición: NO se añade arista a la
  máquina de estados. Mantenerla en dominio permite testearla con la matriz {ayer, hoy, mañana} sin
  infra y evita `if` de fecha dispersos en el use-case.
- **Zona horaria**: coherente con US-031, que compara por **fecha de calendario del evento** con
  una **única definición de "hoy"** en la zona horaria de negocio del servidor/tenant, calculada en
  el backend (NO depende de ningún string formateado; blinda el off-by-one de TZ conocido en
  presentación —`formatearFechaHora`, deuda técnica ajena a este change). El `hoy` se calcula UNA
  vez en el use-case y se pasa a la función pura; la comparación es determinista y re-evaluable.
- **Momento de evaluación**: se evalúa en la aplicación **antes de abrir la transacción** (tras la
  guarda de origen), para rechazar con **422 sin efectos** un forzado fuera del día del evento. No
  necesita re-evaluarse bajo el lock: `fecha_evento` no cambia por concurrencia en esta acción.

## D-3. Atomicidad / concurrencia — `SELECT … FOR UPDATE` + UPDATE condicional, sin locks distribuidos

Única zona crítica: la coordinación **cron (US-031) ↔ gestor (US-032)** y la **doble sesión/doble
click** del gestor, ambas sobre la misma RESERVA en `reserva_confirmada`. **TDD primero.**

- **Mecanismo**: bajo el `SELECT … FOR UPDATE` de la fila RESERVA (dentro de la transacción, con
  `SET LOCAL app.tenant_id`), se **re-evalúa la guarda de origen** (`resolverInicioEvento`) y se
  hace un **UPDATE condicional** `… SET estado='evento_en_curso' WHERE id=? AND
  estado='reserva_confirmada'`. La `filasAfectadas` decide el resultado:
  - **1 fila** ⇒ el forzado ganó: transición + `AUDIT_LOG`.
  - **0 filas** ⇒ otro actor (el cron de US-031, u otra sesión del gestor) transicionó primero
    bajo el lock ⇒ **no-op idempotente**, sin `AUDIT_LOG`, y se traduce a **409** con el mensaje "El
    evento ya está en curso…". Es exactamente la garantía RC-2 que US-031 ya blindó ("la 2.ª UPDATE
    afecta 0 filas y termina no-op sin error, 1 sola auditoría").
- **Sin locks distribuidos**: la serialización la da PostgreSQL sobre la fila RESERVA (hook
  `no-distributed-lock`; prohibido Redis/Redlock). NO se toca `FECHA_BLOQUEADA` ni la cola (zona
  menos crítica que US-012). Mismo patrón que la unidad de trabajo de US-034
  (`UnidadDeTrabajoFinalizacionPrismaAdapter`).
- **Idempotencia observable**: N forzados sobre la misma RESERVA = **1 sola** transición y **1
  sola** entrada de transición en `AUDIT_LOG`; los intentos posteriores devuelven 409 sin efectos.

## D-4. AUDIT_LOG — evidencia de auditoría OBLIGATORIA (origen Usuario, forzado_por_gestor)

- La transición forzada se audita en `AUDIT_LOG` con `accion = 'transicion'`, `entidad =
  'RESERVA'`, **origen Usuario** (`usuario_id` del gestor poblado — a diferencia de US-031, cuyo
  barrido es de Sistema con `usuario_id` no poblado), `datos_anteriores = {estado:
  reserva_confirmada}` y `datos_nuevos = {estado: evento_en_curso, forzado_por_gestor: true,
  precondiciones_incumplidas: [lista]}`.
- **`precondiciones_incumplidas`** es la lista `faltantes` que devuelve
  `preconditionesEventoCumplidas({ preEventoStatus, liquidacionStatus, fianzaStatus })` **leída de
  la fila bajo el lock** (mismos tres `*_status` que US-031). Es la evidencia central del override.
- **Caso borde** (las tres cumplidas al forzar): si entre la carga y el forzado las precondiciones
  pasaran a cumplirse, `precondiciones_incumplidas = []` y **`forzado_por_gestor` sigue siendo
  `true`** (fue una acción de override explícita del gestor). El audit log distingue así un inicio
  forzado de un inicio automático de US-031 (que nunca lleva `forzado_por_gestor`).
- La escritura del `AUDIT_LOG` es **parte de la misma transacción** que la UPDATE (all-or-nothing):
  si la UPDATE afecta 0 filas, NO se escribe auditoría. El `AuditLogPort` es el compartido, tx-bound
  (misma UoW que US-034).

## D-5. Los sub-procesos incumplidos NO se resuelven

- El forzado muta **exclusivamente** `RESERVA.estado`. `pre_evento_status`, `liquidacion_status` y
  `fianza_status` **conservan su valor** tras el forzado (siguen pendientes para gestión posterior).
  No hay side-effects sobre `FICHA_OPERATIVA`, cobros, `FECHA_BLOQUEADA` ni cola. Se blinda con un
  test que verifica que los tres `*_status` quedan intactos tras el forzado.

## D-6. Frontend — lista de precondiciones incumplidas + botón con doble confirmación

- **Sin endpoint GET nuevo (verificado)**: la ficha ya consume `GET /reservas/{id}`
  (`ReservaDetalle`), que **ya expone** `estado`, `fechaEvento`, `preEventoStatus`,
  `liquidacionStatus`, `fianzaStatus` y `condPartFirmadas` (ver `reserva-detalle.dto.ts`). La
  **lista de precondiciones incumplidas** se **deriva en cliente** con una función espejo de la
  guarda de dominio (`pre_evento_status ≠ 'cerrado'` / `liquidacion_status ≠ 'cobrada'` /
  `fianza_status ≠ 'cobrada'`), sin datos nuevos del backend. El backend es la **fuente de verdad**
  (recalcula `faltantes` bajo el lock para el audit log); la derivación en cliente es solo
  presentación.
- **Visibilidad del botón "Forzar inicio del evento"**: SOLO si `estado = 'reserva_confirmada'`
  **AND** `fechaEvento = hoy` (guarda de cliente `puedeForzarInicioEvento(estado, fechaEvento,
  hoy)`). Fuera del día del evento o en otro estado, el botón NO se renderiza (edge case "intento
  de forzar fuera del día del evento": el botón no aparece).
- **Doble confirmación obligatoria (guardarraíl)**: un diálogo de **dos pasos** que enumera las
  precondiciones incumplidas y exige confirmación explícita en el segundo paso antes de disparar el
  `POST`. La cancelación en cualquier paso es un **no-op sin efectos** (no hay transición, no hay
  audit log). El guardarraíl **no es eludible por URL/shortcut**: la protección real es el 422/409
  del servidor (D-1) — la UI es la primera línea, el backend la definitiva.
- **Manejo de respuestas**: 200 → refresca la ficha (RESERVA en `evento_en_curso`, vista de
  ejecución habilitada por US-033/US-034); 409 → mensaje "El evento ya está en curso…" + refresco
  del estado (idempotencia observable en UI); 422 → mensaje "El forzado solo está disponible el día
  del evento" (defensa; no debería alcanzarse desde el botón). El cliente HTTP se **regenera** del
  contrato (nunca se edita a mano). Mobile-first (390/768/1280), objetivos táctiles ≥48px, como
  el diálogo de US-034.

## D-7. Hexagonal: dominio puro + caso de uso + adaptadores

- **Dominio** (`reservas/domain`): se **reutiliza** `resolverInicioEvento` y
  `preconditionesEventoCumplidas` (US-031); se **añade** la guarda de fecha pura
  `esDiaDelEvento(fechaEvento, hoy)`. Nada de `@nestjs`/Prisma (hook `no-infra-in-domain`).
- **Aplicación**: un caso de uso `ForzarInicioEventoUseCase` que (0) carga la RESERVA bajo RLS del
  tenant del JWT (`null` → 404); (1) guarda de origen previa (`resolverInicioEvento`) → conflicto
  ⇒ 409; (2) guarda de fecha (`esDiaDelEvento`) → no es hoy ⇒ 422; (3) transacción
  (`UnidadDeTrabajoForzarInicioPort`): `SELECT … FOR UPDATE`, calcula `faltantes` con
  `preconditionesEventoCumplidas`, UPDATE condicional `WHERE estado='reserva_confirmada'` (0 filas
  ⇒ 409), `AUDIT_LOG` origen Usuario con `forzado_por_gestor: true` +
  `precondiciones_incumplidas`; (4) re-lee la RESERVA post-commit y devuelve
  `{ reserva, forzadoPorGestor: true, precondicionesIncumplidas }`. Espejo de
  `FinalizarEventoUseCase`.
- **Infraestructura / interface**: `ForzarInicioEventoController` (`POST
  /reservas/:id/forzar-inicio-evento`, `RolesGuard` + `@Roles('gestor')`, tenant/usuario del JWT,
  mapeo de errores a 404/409/422); DTOs `@nestjs/swagger`; adaptador Prisma de la UoW
  (`$transaction` + `SET LOCAL app.tenant_id` + `SELECT … FOR UPDATE` sobre RESERVA + UPDATE
  condicional + AUDIT_LOG tx-bound); reuso de `AuditLogPort` y del adaptador de lectura de la
  RESERVA. Cableado en `ReservasModule` por tokens Symbol, gemelo del de finalizar-evento.

## Riesgos / Trade-offs

- **Elección 409 vs 422** (D-1): se separan por causa (estado vs fecha). Riesgo de confusión con
  clientes que esperan un único código; se mitiga con `code` explícito
  (`conflicto_estado`/`fecha_evento_no_es_hoy`) y documentación en el contrato.
- **Definición de "hoy" y TZ** (D-2): el cálculo debe ser consistente con la zona horaria de
  negocio para no habilitar/vetar el forzado un día antes/después. Se reutiliza la definición de
  US-031 y se testea; no se toca la deuda de `formatearFechaHora` (presentación).
- **Coordinación cron↔gestor** (D-3): ya blindada por US-031 (RC-2). US-032 hereda la garantía sin
  cambios en US-031, apoyándose en el UPDATE condicional bajo el lock (0 filas → 409).
- **Override sin resolver sub-procesos** (D-5): decisión de negocio deliberada (riesgo asumido por
  el gestor); la evidencia queda en `AUDIT_LOG` (`forzado_por_gestor` + `precondiciones_incumplidas`).
- **Doble confirmación solo en UI** (D-6): la UI es la primera línea; el backend es la defensa
  definitiva (no confía en la doble confirmación del cliente; valida estado y fecha en servidor).

## Pendiente / fuera de alcance

- **Resolución de los sub-procesos incumplidos** (`pre_evento_status`/`liquidacion_status`/
  `fianza_status`): US-032 no los toca (D-5).
- **Vista móvil "evento en curso" + checklist de documentación** → **US-033/US-034**. US-032 solo
  deja la RESERVA en `evento_en_curso`.
- **Briefing operativo PDF al equipo** (UC-23 paso 5) → 📐 diseñado, no implementado en MVP.
- **UI del dashboard de notificaciones** → **US-044** (la alerta crítica la produce US-031; US-032
  deja rastro del forzado en `AUDIT_LOG`).
- **Arreglo del off-by-one de TZ** en `formatearFechaHora` → change aparte (D-2 solo se blinda de
  no depender de fechas formateadas).
