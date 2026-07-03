# Change: us-010-resultado-visita-reserva-inmediata

## Why

US-010 cubre la **transición de salida de una consulta con visita programada (`2.v`)
directamente a `pre_reserva`** cuando el Gestor registra que la visita se ha realizado y
el **cliente quiere reservar en el acto**, disponiendo de todos los datos necesarios. Es
la **historia hermana** de US-009 (recién archivada): donde US-009 registra el resultado
"cliente interesado" (`2v → 2b`, TTL de consulta fresco, email E7), US-010 registra el
resultado "reserva inmediata" (`2v → pre_reserva`, TTL de pre-reserva de 7 días, **sin
email propio**). El tercer desenlace —"descarte" (US-011, `2v → 2z`)— queda fuera de
alcance.

La transición marca `visita_realizada = true`, pasa la RESERVA a `estado = 'pre_reserva'`
con `sub_estado = NULL` (pre_reserva no tiene sub-estado de consulta), fija
`ttl_expiracion = now + TENANT_SETTINGS.ttl_prereserva_dias` (default **7 días**),
actualiza la fila de `FECHA_BLOQUEADA` al **mismo** TTL de 7 días (`tipo_bloqueo`
permanece `'blando'`), **vacía atómicamente la cola A16** (las consultas en `2.d` que
bloquea pasan a `2.y`) y registra `AUDIT_LOG`. Todo en una **única transacción**. Resuelve
**D2** (conversión directa visible en el pipeline), **D3** (transición clara sin el paso
intermedio `2.b`), **D6** (facilita cierre inmediato y arranque de facturación) y **D13**
(cola liberada atómicamente). (Fuente: `US-010 §Historia`, `§Contexto de Negocio`,
`§Happy Path`, `§Reglas de negocio`; UC-08 FA-08; UC-14 flujo básico + A16.)

**Diferencias clave respecto de US-009** (mismo cimiento, distinto destino y reglas):
1. **Destino `pre_reserva`, no `2b`**: cambia el `estado` (a `pre_reserva`) y deja
   `sub_estado = NULL`. US-009 solo mutaba el sub_estado dentro de `estado='consulta'`.
2. **TTL de pre-reserva (7 días)**: `now + TENANT_SETTINGS.ttl_prereserva_dias`, **no**
   `ttl_consulta_dias`. Leído del setting, nunca hardcodeado.
3. **Validación de datos obligatorios UC-14 (nueva)**: la transición requiere RESERVA
   completa (`fecha_evento`, `duracion_horas`, `tipo_evento`, `num_adultos_ninos_mayores4`)
   y datos fiscales del CLIENTE (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`,
   `provincia`). Faltantes → transición bloqueada devolviendo los campos, RESERVA intacta
   en `2.v`. US-009 no tenía esta validación.
4. **Vaciado de cola A16 (nuevo)**: las consultas en `2.d` con `consulta_bloqueante_id` =
   esta reserva pasan a `2.y` (`posicion_cola = NULL`, `consulta_bloqueante_id = NULL`) en
   la misma transacción; válido con 0 filas. US-009 no vaciaba cola.
5. **Sin email propio**: US-010 **no** dispara ningún email (E2 se delega a UC-14 al
   generar el presupuesto formal). **No** toca la capability `comunicaciones`. US-009 sí
   disparaba E7.

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Máquina de estados declarativa** (`maquina-estados.ts`): la guarda `2v → pre_reserva`
  se modela extendiendo el patrón declarativo (§D-1). La transición
  `{2a,2b,2c,2v} → pre_reserva` de UC-14 (`esOrigenValidoParaActivarPrereserva`,
  `ORIGENES_TRANSICION_ACTIVAR_PRERESERVA`) ya cubre `2v` como origen válido; US-010 usa
  una **guarda mono-estado** `{2v}` específica del resultado de visita "reserva inmediata".
- **UoW de transición con `SELECT … FOR UPDATE` + retry-on-conflict** (patrón de
  `activar-prereserva-uow.prisma.adapter.ts`, US-014): mismo motor atómico; se reutiliza
  para la mutación de RESERVA + `FECHA_BLOQUEADA` (UPDATE) + vaciado de cola A16 +
  `AUDIT_LOG` en una sola transacción.
- **Bloqueo atómico de fecha (US-040/041)** + `resolverPlanBloqueo` / la primitiva de
  bloqueo fase `pre_reserva` (`now + ttl_prereserva_dias`, `UNIQUE(tenant_id, fecha)`): la
  fila ya existe (creada en `2.v` por US-008) → **UPDATE** puro del `ttl_expiracion`.
  Regla dura: PostgreSQL + Prisma, **nunca Redis/Redlock**.
- **Validación de datos obligatorios UC-14** (`CampoFiscalFaltante` de
  `generar-presupuesto.use-case.ts`): mismo conjunto de campos y misma semántica de
  "enumerar faltantes"; se reutiliza el patrón.
- **Vaciado de cola A16** (`ColaPrereservaPrismaRepository.vaciar` del UoW de US-014):
  mismo mecanismo `2.d → 2.y` de US-007 (`2.c`) y de UC-14; se reutiliza tal cual.
- **`TENANT_SETTINGS.ttl_prereserva_dias`** (default 7, ya en el schema): TTL leído del
  setting, nunca hardcodeado.
- **AUDIT_LOG (US-003+)**: `accion='transicion'` en la misma transacción, para la RESERVA
  principal y para cada consulta vaciada de la cola.

El endpoint también existe ya: US-009 dejó el endpoint **polimórfico**
`PATCH /reservas/{id}/visita` (`ResultadoVisitaRequest` con enum `ResultadoVisita =
[interesado, reserva_inmediata, descarta]`). US-010 solo **habilita** el valor
`reserva_inmediata` (hoy el servidor lo rechaza con 422). (Fuente: ver `design.md` para
firmas previstas, rutas reales y decisiones de reuso.)

## What Changes

> Slice vertical (backend + evolución del contrato para habilitar `reserva_inmediata` +
> porción de frontend "ficha de reserva" con la acción "Cliente quiere reservar ahora").
> Sujeto al **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Nueva acción de transición sobre una RESERVA existente en `2.v`**: el Gestor registra
  el resultado "reserva inmediata". El servidor **valida el sub_estado de origen** (solo
  `2v`, guarda mono-estado; **excluye** todos los demás, incluidos los terminales),
  **valida los datos obligatorios UC-14**, muta la RESERVA a `estado = 'pre_reserva'`,
  `sub_estado = NULL`, fija `visita_realizada = true` y `ttl_expiracion = now +
  TENANT_SETTINGS.ttl_prereserva_dias`. (Fuente: `US-010 §Happy Path`, `§Reglas de
  Validación`; UC-08 FA-08; UC-14.)
- **Validación de datos obligatorios (UC-14 FA-01)**: antes de mutar, el servidor exige
  RESERVA (`fecha_evento`, `duracion_horas`, `tipo_evento`, `num_adultos_ninos_mayores4`)
  y CLIENTE (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`) completos.
  Si falta alguno → **bloqueo de la transición** devolviendo la lista de campos
  faltantes; la RESERVA **permanece en `2.v` sin ningún cambio**. Reutiliza el patrón
  `CampoFiscalFaltante` de UC-14. (Fuente: `US-010 §FA Datos obligatorios incompletos`,
  `§Reglas de Validación`.)
- **Bloqueo `FECHA_BLOQUEADA` — UPDATE del TTL a 7 días (fase `pre_reserva`)**: la fila
  activa de `FECHA_BLOQUEADA` con `reserva_id` = esta RESERVA (que existe desde `2.v`)
  actualiza su `ttl_expiracion` al **mismo valor** que la RESERVA (`now +
  ttl_prereserva_dias`); `tipo_bloqueo` permanece `'blando'`. No se crea ni elimina fila
  (viene de `2.v`, no hay rama de INSERT). (Fuente: `US-010 §Happy Path`, `§Reglas de
  negocio`; UC-14 fase pre_reserva; `er-diagram.md §3.6`.)
- **Vaciado atómico de la cola A16**: en la **misma transacción**, todas las RESERVA con
  `consulta_bloqueante_id` = esta reserva y `sub_estado = '2d'` pasan a `sub_estado =
  '2y'`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`. Opera aunque haya **0
  filas** (operación vacía = válida). Cada consulta vaciada se registra en `AUDIT_LOG`.
  Mismo mecanismo A16 de US-007 (`2.c`) y UC-14. (Fuente: `US-010 §Happy Path con cola
  activa`, `§FA Cola vacía`, `§Reglas de Validación`.)
- **AUDIT_LOG de la transición**: `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.sub_estado = '2v'`, `datos_nuevos.estado = 'pre_reserva'`,
  `datos_nuevos.sub_estado = NULL`, `datos_nuevos.visita_realizada = true`, en la misma
  transacción; más un `AUDIT_LOG accion='transicion'` por cada consulta descartada de la
  cola. (Fuente: `US-010 §Happy Path`.)
- **Atomicidad de la transición**: mutar RESERVA (`estado`, `sub_estado`,
  `visita_realizada`, `ttl_expiracion`) + UPDATE del `ttl_expiracion` de
  `FECHA_BLOQUEADA` + vaciado de cola A16 + `AUDIT_LOG` ocurren **all-or-nothing** en una
  única transacción de BD bajo el contexto RLS del tenant. Un fallo parcial revierte todo
  (rollback): **nunca** `pre_reserva` sin `FECHA_BLOQUEADA` actualizada, ni cola
  parcialmente vaciada. (Fuente: `US-010 §Reglas de negocio`, `§Concurrencia`.)
- **Guarda de origen mono-estado**: si la petición llega sobre una RESERVA que **no** está
  en `2.v` → rechazo con error de validación (la RESERVA no se modifica); sobre un terminal
  (`2.x`/`2.y`/`2.z`, `reserva_cancelada`/`reserva_completada`) o estado ya avanzado
  (`pre_reserva`, `reserva_confirmada`, …) → rechazo (inmutables/no aplicable). (Fuente:
  `US-010 §FA RESERVA no en 2.v`, `§Reglas de Validación`.)
- **Sin email propio**: US-010 **no** dispara ningún email. E2 (presupuesto adjunto) se
  dispara desde UC-14 al generar el presupuesto formal en el área "Pre-reserva y
  Presupuestos". **No** se toca la capability `comunicaciones`. (Fuente: `US-010 §Contexto
  de Negocio — Email relacionado: ninguno propio`, `§Notas de alcance`.)
- **Concurrencia D4 y del vaciado de cola**: el `SELECT … FOR UPDATE` sobre la fila
  bloqueante de `FECHA_BLOQUEADA` + el `UNIQUE(tenant_id, fecha)` serializan un intento
  concurrente de insertar bloqueo para la misma fecha (nuevo lead) — una gana, la otra
  recibe violación de unicidad (no hay doble bloqueo). El `FOR UPDATE` sobre la cola
  serializa el vaciado frente a mutaciones concurrentes de `posicion_cola` de esa misma
  cola. Cubierto con **tests de concurrencia reales** en TDD-RED (skill
  `concurrency-locking`). (Fuente: `US-010 §Concurrencia / Race Conditions`.)
- **Porción de frontend "ficha de reserva"**: acción "Registrar resultado de visita" →
  opción "Cliente quiere reservar ahora" (visible solo en `2.v`); si faltan datos
  obligatorios, el formulario permite completarlos en el mismo paso (UC-14 FA-01);
  confirmación y feedback (nuevo estado `pre_reserva`, TTL de 7 días, cola vaciada).
  Responsive mobile-first (390/768/1280).

## Impact

- Specs: **modifica la capability `consultas`** (añade los requisitos de la transición
  `2v → pre_reserva`: guarda de origen mono-estado, validación de datos obligatorios
  UC-14, `estado='pre_reserva'`/`sub_estado=NULL`, `visita_realizada=true`, TTL de 7 días
  `now + ttl_prereserva_dias`, UPDATE del TTL de `FECHA_BLOQUEADA`, vaciado atómico de cola
  A16, atomicidad, concurrencia D4 y de cola, auditoría `accion='transicion'` de la RESERVA
  y de las consultas vaciadas). **Reutiliza sin modificar** la capability `bloqueo-fecha`
  (la fase `pre_reserva` `now + ttl_prereserva_dias` / UPDATE ya está descrita por UC-14) —
  **no se crea delta de `bloqueo-fecha`**. **NO toca la capability `comunicaciones`** (US-010
  no tiene email propio).
- Contrato OpenAPI (`docs/api-spec.yml`): **evolución mínima**. El endpoint polimórfico
  `PATCH /reservas/{id}/visita` (`ResultadoVisitaRequest`, enum `ResultadoVisita` con
  `reserva_inmediata` ya declarado) existe desde US-009; US-010 **habilita** el valor
  `reserva_inmediata` (hoy rechazado con 422), documenta su respuesta 200
  (`estado='pre_reserva'`, `subEstado=null`, `visitaRealizada=true`, `ttlExpiracion` a 7
  días) y añade el 422 de **datos obligatorios incompletos** con los campos faltantes. El
  `contract-engineer` (post-gate) afina el detalle; **no se toca `docs/api-spec.yml` en
  este change de spec**. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**` (guarda
  declarativa `2v → pre_reserva`, use-case de la transición reutilizando la UoW estilo
  `activar-prereserva`, validación de datos obligatorios UC-14, UPDATE de `FECHA_BLOQUEADA`
  a 7 días, vaciado de cola A16, AUDIT_LOG; habilitar `reserva_inmediata` en
  `registrar-resultado-visita.use-case.ts`), `apps/web/src/features/reservas/**` (acción
  "Cliente quiere reservar ahora" + formulario de datos obligatorios + confirmación +
  feedback). Read-model `GET /reservas/{id}` ya existe (US-005).
- **Migración**: **no**. Todo existe en `master` (`schema.prisma`): enum
  `EstadoReserva.pre_reserva`, `subEstado` nullable (`SubEstadoConsulta?`),
  `TenantSettings.ttlPrereservaDias`, campos de cola (`posicionCola`,
  `consultaBloqueanteId`), sub-estados `s2y`/`s2d`, campos fiscales del CLIENTE (`dniNif`,
  `direccion`, `codigoPostal`, `poblacion`, `provincia`), `visitaRealizada`. A confirmar en
  `design.md §D-7`.
- Trazabilidad: **US-010**, **UC-08 FA-08** (reserva inmediata), **UC-14** (validación de
  datos obligatorios + A16 + TTL de pre_reserva); entidades RESERVA, FECHA_BLOQUEADA,
  CLIENTE, AUDIT_LOG, TENANT_SETTINGS; automatización **A16** (vaciado de cola); **A2/E2**
  se delegan a UC-14 (fuera de alcance).
- Dependencias (todas en `master`): US-001 (sesión activa), US-008 (existe RESERVA en `2.v`
  con `visita_programada_fecha` y fila activa en `FECHA_BLOQUEADA`), US-040/US-041 (bloqueo
  atómico/liberación), US-014 (patrón de UoW de activación de pre_reserva + validación de
  datos obligatorios + vaciado de cola A16), US-007 (mecánica A16 de vaciado de cola),
  US-009 (endpoint polimórfico `PATCH /reservas/{id}/visita` + `registrar-resultado-visita`
  use-case con el enum `reserva_inmediata` reservado).

## Lo que NO entra (anti-scope)

- **Otros resultados de visita**: "cliente interesado" (US-009, `2v → 2b`, ya archivada) y
  "descarte" (US-011, `2v → 2z`). US-010 cubre **exclusivamente** el resultado "reserva
  inmediata" (`2v → pre_reserva`).
- **Generación del presupuesto PDF, envío de E2 y el flujo completo de UC-14**: son
  responsabilidad del área "Pre-reserva y Presupuestos". US-010 cubre exclusivamente la
  **transición de estado + bloqueo + vaciado de cola**; no genera presupuesto ni PDF ni
  dispara email. (Fuente: `US-010 §Notas de alcance`.)
- **La capability `comunicaciones`**: US-010 no tiene email propio; no se añade ni modifica
  ningún requisito de comunicaciones.
- **Reprogramación de visita**: si la visita no se celebró, se reutiliza el flujo de US-008
  desde `2.v`; US-010 no lo implementa.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-4**: alcance exacto de la validación de datos obligatorios UC-14 (¿bloqueo estricto
  con lista de faltantes, reutilizando `CampoFiscalFaltante`?) y su código HTTP (422 con
  `camposFaltantes`).
- **D-5**: mecánica del vaciado de cola A16 (reutilizar `ColaPrereservaPrismaRepository`
  del UoW de US-014 vs repositorio propio de esta transición) y auditoría por consulta
  vaciada.
- **D-6**: superficie de API — habilitar `reserva_inmediata` en el endpoint polimórfico
  `PATCH /reservas/{id}/visita` (lo afina el `contract-engineer` post-gate).
- **D-7**: confirmar que no hace falta migración (enum `pre_reserva`, `sub_estado`
  nullable, `ttl_prereserva_dias`, campos de cola, `2y`/`2d`, campos fiscales de CLIENTE ya
  en `master`).
