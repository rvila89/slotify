# Change: us-019-promocion-manual-cola

## Why

US-018 (mergeada) cerró la promoción **automática** FIFO: cuando `liberarFecha()`
libera una fecha con cola, el seam `PromocionColaPort` promueve **siempre la primera**
consulta (`posicion_cola = 1`) sin intervención humana. Pero el Gestor **no puede
intervenir en excepciones de negocio**: hoy no tiene forma de promover a bloqueante a
**una consulta concreta de la cola que no sea la primera** (p. ej. un lead con mayor
madurez comercial o urgencia) sin esperar al FIFO automático ni manipular la BD a mano.
Es el dolor **D2** (control del Gestor sobre sus leads activos) y **D4** (gestión del
conflicto de fechas): el Gestor ve la cola (US-017) pero no puede actuar sobre ella.
(`US-019 §Historia`, `§Contexto de Negocio`; `use-cases.md` UC-12 flujo alternativo
manual FA; `er-diagram.md §5.3`.)

- **El actor es el Gestor** (acción deliberada, no automatización): US-019 aporta una
  **acción de escritura** disparada desde la vista de cola de US-017. Su efecto observable
  es que la consulta elegida por el Gestor pasa a bloquear la fecha, la bloqueante actual
  se expira forzosamente y el resto de la cola se reordena. (`US-019 §Historia`,
  `§Supuestos`; US-017 `cola-espera` frontend.)
- **La infraestructura de cola y promoción YA EXISTE** y se reutiliza sin reinventarla:
  US-004/US-000 modelan la cola (`posicion_cola`, `consulta_bloqueante_id` auto-ref en
  `RESERVA`); US-040 (`bloquearFecha()`) y US-041 (`liberarFecha()`) son las primitivas
  atómicas de bloqueo; US-018 dejó la operación de dominio pura de promoción
  (`promocion-cola.ts` / `planificarPromocionCola`), la transición declarativa
  `{consulta,2d} → {consulta,2b}` en `maquina-estados.ts`, y **la guarda de coordinación
  "ya promovida"** explícitamente diseñada para US-019 (US-018 §D-3/§D-6, requisito
  *"Concurrencia — coordinación con la promoción manual del Gestor (US-019, RC-3)"*).
  US-019 **consume ese contrato de guarda**, no lo redefine. (`US-018` archivado;
  `promocion-cola.ts`; `maquina-estados.ts`; `bloquear-fecha.service.ts`;
  `liberar-fecha.service.ts`.)

## What Changes

- **Nuevo endpoint de escritura para promoción manual**: el Gestor selecciona una RESERVA
  concreta de la cola (`sub_estado = '2d'`, cualquier `posicion_cola`, no solo la primera)
  y la promueve a bloqueante. La superficie HTTP concreta (método/path/DTO/códigos de
  error) la fija el **`contract-engineer`** en el step de contrato; el contrato reserva hoy
  `POST /reservas/{id}/promover` (tag `Cola`) descrito como el encadenamiento automático
  UC-12, cuya semántica (el `{id}` es la **primera** de la cola, disparo automático) **no
  cubre** la promoción manual de una consulta arbitraria. Se decidirá si se **madura ese
  placeholder** (con el `{id}` = la RESERVA en `2d` a promover + confirmación explícita) o
  se añade un path dedicado. Esta decisión de contrato queda **fuera del alcance del SDD** y
  se cierra en el step de contrato. (`US-019 §Historia`, `§Happy Path`; `docs/api-spec.yml`
  L706-720.)
- **Mecánica de promoción manual (dominio + aplicación + adaptador)**: dado un `reservaId`
  de una consulta en `2.d`, dentro de **una única transacción** serializada por
  `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de la fecha:
  1. **Expiración forzosa de la bloqueante actual** si sigue viva (`sub_estado` `2.b`/`2.c`/
     `2.v` con TTL vigente **o** ya vencido pero aún no barrida): `sub_estado → '2.x'`,
     `ttl_expiracion → NULL`. Reutiliza la semántica de expiración de US-012 (`2.x`
     terminal, "consulta expirada por TTL"), aplicada aquí de forma **deliberada** por el
     Gestor. (`US-019 §Reglas de negocio`, `§Happy Path`, `§FA-02`.)
  2. **Promoción de la RESERVA elegida** (no necesariamente `posicion_cola = 1`):
     `sub_estado → '2.b'`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`,
     `ttl_expiracion → now() + tenant_settings.ttl_consulta_dias` (default 3, **derivado del
     setting, nunca hardcodeado**). Usa la transición declarativa `{consulta,2d} →
     {consulta,2b}` de `maquina-estados.ts` (US-018). (`US-019 §Reglas de negocio`.)
  3. **Re-bloqueo atómico de la fecha** reutilizando `bloquearFecha()` (US-040):
     `FECHA_BLOQUEADA.reserva_id → <promovida>`, `tipo_bloqueo = 'blando'`,
     `ttl_expiracion = now() + ttl_consulta_dias`. Garantía `UNIQUE(tenant_id, fecha)` +
     `SELECT … FOR UPDATE` vía Prisma `$queryRaw`; **NUNCA Redis/locks distribuidos** (hook
     `no-distributed-lock`). (`US-019 §Reglas de negocio`; `CLAUDE.md §Regla crítica`.)
  4. **Reordenación de la cola eliminando el hueco de la posición promovida**: cada RESERVA
     en `2.d` restante con `posicion_cola > posicion_de_la_promovida` **decrementa en 1** y
     re-apunta `consulta_bloqueante_id` a la nueva bloqueante (la promovida). Las que están
     por debajo del hueco (si la promovida no era la primera) conservan su posición. Se
     preserva la unicidad `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE
     posicion_cola IS NOT NULL` (US-004): las posiciones quedan contiguas empezando en 1.
     (`US-019 §Happy Path`, `§FA-01`, `§FA-03`; `er-diagram.md §Índices de cola`.)
- **Diferencia clave con US-018 (por eso NO se reutiliza tal cual)**: la promoción
  automática (a) parte de una fecha **ya liberada** (la `FECHA_BLOQUEADA` no existe cuando
  el seam se dispara) y (b) promueve **siempre la primera** (`posicion_cola = 1`). La
  manual (a) parte de una fecha **aún bloqueada por una bloqueante viva** que hay que
  **expirar primero**, y (b) promueve **una posición arbitraria** elegida por el Gestor,
  con una reordenación de "cerrar el hueco" distinta al decremento uniforme del FIFO.
  US-019 **reutiliza la operación pura de reordenación/plan de US-018 donde encaje** y
  **añade** la lógica de expiración forzosa + selección arbitraria. (Detalle en
  `design.md §D-2`, `§D-3`.)
- **Coordinación anti-doble-promoción con US-018 (punto crítico)**: la promoción manual y
  la automática comparten la **guarda "ya promovida"** de US-018 (§D-3/§D-6, FIFO estricto
  + "gana quien toma el lock primero"), evaluada bajo `SELECT … FOR UPDATE` **sobre la fila
  de `FECHA_BLOQUEADA`** dentro de la transacción. La primera ruta que adquiere el lock
  completa su operación; la segunda, al obtener el lock, detecta que el estado ya cambió
  (la bloqueante ya no es la esperada / la consulta seleccionada ya no está en `2.d`) y
  **aborta sin inconsistencia**. Cuando la que falla es la acción del Gestor, el sistema le
  devuelve el mensaje "La cola ya fue actualizada automáticamente, por favor recarga la
  vista". (`US-019 §Concurrencia / Race Conditions`; US-018 requisito RC-3, §D-6;
  `design.md §D-4`.)
- **Guardas de validación** (rechazo sin efectos): solo se promueve una RESERVA con
  `sub_estado = '2.d'` (cualquier otro → rechazo "La consulta seleccionada ya no está en
  cola", FA-05); debe existir `FECHA_BLOQUEADA` activa para la fecha (si no, error de
  inconsistencia de datos); el Gestor **debe confirmar explícitamente** la acción
  destructiva (la confirmación es UI + el endpoint solo actúa sobre una petición explícita).
  (`US-019 §Reglas de Validación`, `§FA-04`, `§FA-05`.)
- **AUDIT_LOG por cada RESERVA modificada** (`accion = 'transicion'`, `entidad = 'RESERVA'`,
  con el `usuario_id` del Gestor): la bloqueante expirada forzosamente
  (`datos_anteriores.sub_estado ∈ {2b,2c,2v}`, `datos_nuevos.sub_estado = '2x'`), la
  promovida (`datos_anteriores.sub_estado = '2d'`, `datos_nuevos = {sub_estado: '2b', origen:
  'promocion_manual'}`) y cada RESERVA reordenada. El `origen: 'promocion_manual'` distingue
  esta acción de la automática de US-018 (`origen: 'promocion_automatica'`). (`US-019 §Happy
  Path`, `§Reglas de negocio`.)
- **Email al cliente promovido — fuera de alcance en MVP**: el email "¡La fecha está
  disponible!" (UC-12 paso 8) está `📐 Solo diseñado`, igual que en US-018 (§D-5). Se aplica
  el **mismo patrón**: alerta interna al Gestor (o simplemente la traza de AUDIT_LOG), SIN
  email al cliente ni acoplamiento al puerto de comunicaciones (US-045). Superficie de
  notificaciones diferida a US-044. (`US-019 §Email relacionado`, `§Notas de alcance`.)

## Impact

- Specs afectadas: **se extiende `consultas`** con `ADDED Requirements` para la promoción
  **manual** de cola. NO se crea capability nueva (la mecánica de cola, sub-estados,
  bloqueo blando y promoción ya viven en `consultas`, extendida por US-004/US-012/US-018).
  NO se modifican `bloqueo-fecha` (se **reutiliza** `bloquearFecha()`), `calendario`,
  `foundation`, `calculo-tarifa` ni `app-shell`. (`spec-delta` en `specs/consultas/spec.md`.)
- Datos: **ninguna entidad ni migración de esquema nueva**. Usa `RESERVA` (`posicion_cola`,
  `consulta_bloqueante_id`, `sub_estado`, `ttl_expiracion`), `FECHA_BLOQUEADA` y `AUDIT_LOG`,
  todo provisionado; el índice UNIQUE parcial de cola (`reserva_cola_posicion_key`, US-004)
  ya existe y se respeta en la reordenación.
- Contrato OpenAPI: **hay superficie HTTP de usuario** (a diferencia de US-018). El
  `contract-engineer` decide en el step de contrato si madura el placeholder
  `POST /reservas/{id}/promover` (hoy descrito como automático) o añade un path dedicado a
  la promoción manual, con el DTO (reserva a promover, confirmación) y los códigos de error
  (409 "cola ya actualizada"; 4xx "consulta ya no en cola" / "sin bloqueo para la fecha").
  Se regenera el SDK del frontend desde el contrato.
- Código: nuevo caso de uso de aplicación (`PromoverManualEnColaService` o equivalente) +
  operación/plan de dominio puro que **extiende** el de US-018 con expiración forzosa +
  selección arbitraria + reordenación por cierre de hueco + adaptador Prisma + endpoint
  NestJS (controller). Reutiliza `bloquearFecha()` (US-040), la transición declarativa y la
  guarda "ya promovida" (US-018). Frontend: acción "Promover a bloqueante" + diálogo de
  confirmación en la vista de cola de US-017 (`features/cola-espera`), consumiendo el SDK.
- Multi-tenancy/RLS: la promoción se ejecuta bajo el **contexto RLS del tenant** del Gestor
  autenticado (`SET LOCAL app.tenant_id` desde el JWT, mismo patrón que US-041/US-018); el
  `tenant_id` y el `usuario_id` del Gestor viajan en el JWT, nunca de input externo.
- Concurrencia: **zona crítica — TDD primero** (skill `concurrency-locking`). Escenarios de
  carrera: (RC-A) promoción manual vs barrido automático US-018 sobre la misma fecha;
  (RC-B) dos Gestores promoviendo consultas distintas de la misma cola. Ambos resueltos por
  la guarda "ya promovida" + `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`. Tests reales de
  Postgres con workers simultáneos, no mocks.
- Frontend: **hay pantalla** (a diferencia de US-018). Se añade la acción de promoción + el
  diálogo de confirmación a la vista de cola de US-017; **E2E con Playwright MCP aplica**
  (verificar los 3 viewports 390/768/1280, regla dura de responsive). El cliente HTTP se
  **genera** desde el contrato, nunca se edita a mano.
- Deuda técnica considerada (no se arregla aquí): (a) off-by-one de TZ en
  `formatearFechaHora` — el nuevo `ttl_expiracion` se calcula/compara como **instante
  `timestamptz`**, nunca fecha formateada; (b) el test de concurrencia de US-004 es flaky
  (deadlock `40P01`) — ajeno; solo se vigila al leer la suite global.
- Trazabilidad: **US-019**, **UC-12** (flujo alternativo manual, FA del UC), dolores
  **D2**/**D4**; reutiliza US-040 (`bloquearFecha()`), US-041 (`liberarFecha()`), US-012
  (semántica de expiración `2.x`), US-018 (plan de promoción + guarda de coordinación),
  US-017 (vista de cola que expone la acción).
- Fuera de alcance: el **email al cliente** de promoción ("¡La fecha está disponible!",
  UC-12 paso 8, `📐 Solo diseñado`); la **superficie de notificaciones/dashboard** (US-044);
  cualquier cambio en la promoción **automática** de US-018 (solo se consume su guarda).
