# Design — us-010-resultado-visita-reserva-inmediata

> Decisiones técnicas para la **transición de salida de "visita programada" (`2.v`)
> directamente a `pre_reserva`** por resultado de visita "reserva inmediata" (US-010 /
> UC-08 FA-08 / UC-14). Todo se apoya en código real ya en `master`; se prioriza **DRY +
> hexagonal** y la garantía de **atomicidad** de la mutación de RESERVA + `FECHA_BLOQUEADA`
> + **vaciado de cola A16** + `AUDIT_LOG` en el motor PostgreSQL. Este documento es el
> corazón del **Gate de revisión humana SDD**: las decisiones quedan abiertas a tu OK antes
> de tocar contrato/TDD/código. En especial **D-4** (validación de datos obligatorios),
> **D-5** (vaciado de cola A16), **D-6** (superficie de API) y **D-7** (migración)
> requieren tu confirmación.

Rutas reales citadas (todas en `apps/api/src/`, ya en `master`):
- `reservas/domain/maquina-estados.ts` — máquina declarativa
  (`ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO` de US-009,
  `ORIGENES_TRANSICION_ACTIVAR_PRERESERVA` / `esOrigenValidoParaActivarPrereserva` de
  UC-14; enum `EstadoReserva` incluye `pre_reserva`)
- `reservas/application/registrar-resultado-visita.use-case.ts` — use-case polimórfico de
  US-009; el tipo `ResultadoVisita = 'interesado' | 'reserva_inmediata' | 'descarte'` ya
  anticipa este flujo (hoy `reserva_inmediata` → 422)
- `presupuestos/infrastructure/activar-prereserva-uow.prisma.adapter.ts` — UoW de UC-14:
  transición a `pre_reserva` (`estado='pre_reserva'`, `subEstado=null`) + bloqueo
  insert-o-update + **vaciado de cola A16** (`ColaPrereservaPrismaRepository.vaciar`,
  `2.d → 2.y`) + AUDIT_LOG, todo en `$transaction` con `fijarTenant` (RLS) y `SELECT … FOR
  UPDATE` sobre la fila bloqueante
- `presupuestos/application/generar-presupuesto.use-case.ts` — validación de datos
  obligatorios UC-14 (`CampoFiscalFaltante`: `dniNif`, `direccion`, `codigoPostal`,
  `poblacion`, `provincia`, `fechaEvento`, `duracionHoras`, `numAdultosNinosMayores4`,
  `tipoEvento`)
- `reservas/infrastructure/tenant-settings.prisma.adapter.ts` — `obtener()` (lee
  `ttlPrereservaDias`)
- `reservas/application/obtener-reserva.query.ts` — read-model `GET /reservas/{id}` (US-005)
- `prisma/schema.prisma` — enum `EstadoReserva.pre_reserva`, `subEstado`
  (`SubEstadoConsulta?`, nullable), `visitaRealizada` (BOOLEAN),
  `TenantSettings.ttlPrereservaDias` (INT), campos de cola (`posicionCola`,
  `consultaBloqueanteId`), sub-estados `s2y`/`s2d`, Cliente (`dniNif`/`direccion`/
  `codigoPostal`/`poblacion`/`provincia`)
- `docs/api-spec.yml` — `PATCH /reservas/{id}/visita`, `ResultadoVisitaRequest`, enum
  `ResultadoVisita = [interesado, reserva_inmediata, descarta]`

**Simetría con US-009 (transición hermana) y con UC-14 (destino compartido)**: US-009 y
US-010 son dos de las tres **salidas** de `2.v`. US-009 devuelve la consulta a `2.b` (TTL
de consulta, E7); US-010 la lleva directamente a `pre_reserva`. El **destino** de US-010 es
idéntico al de UC-14 (`estado='pre_reserva'`, `sub_estado=NULL`, TTL de 7 días, bloqueo a 7
días, vaciado de cola A16), con la diferencia de que UC-14 **crea el presupuesto y dispara
E2** (área Pre-reserva y Presupuestos) mientras que US-010 **solo ejecuta la transición y
el bloqueo** (sin presupuesto, sin email). Por eso US-010 reutiliza el **motor atómico y el
patrón de vaciado de cola de UC-14**, pero **no** su generación de presupuesto ni su email.

---

## D-1. Guarda de origen mono-estado — extender la máquina declarativa

**Decisión**: añadir a `maquina-estados.ts`, **como dato** (tabla declarativa, no
condicionales dispersos), la guarda de origen mono-estado de la transición "reserva
inmediata": `ORIGENES_TRANSICION_RESULTADO_VISITA_RESERVA_INMEDIATA = [{ estado:
'consulta', subEstado: '2v' }]`, con su predicado
`esOrigenValidoParaResultadoVisitaReservaInmediata(estado, subEstado)`. Mismo patrón exacto
que `ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO` de US-009 (guarda MONO-estado `{2v}`).

- **Mono-estado, no multi-estado**: aunque `ORIGENES_TRANSICION_ACTIVAR_PRERESERVA` (UC-14)
  admite `{2a,2b,2c,2v}` como orígenes de la activación de pre_reserva por confirmación de
  presupuesto, US-010 es un **resultado de visita** y por tanto **solo** parte de `2v`
  (una consulta sin visita programada no puede "registrar el resultado de una visita").
  Todo origen distinto de `2v` —`2a/2b/2c/2d`, los terminales `2x/2y/2z`, el propio destino
  `pre_reserva`, y `reserva_confirmada`/`reserva_cancelada`/`reserva_completada`— se rechaza
  **antes** de entrar en la transacción, con error de validación y sin efectos.
- El destino `pre_reserva` (con `sub_estado=NULL`) ya está en el enum de Prisma; **sin
  migración de enum** (D-7).

---

## D-2. Transición a `pre_reserva` — `estado='pre_reserva'`, `sub_estado=NULL`, TTL de 7 días

**Decisión**: la RESERVA muta a `estado = 'pre_reserva'`, `sub_estado = NULL` (pre_reserva
no tiene sub-estado de consulta), `visita_realizada = true` y `ttl_expiracion = now +
TENANT_SETTINGS.ttl_prereserva_dias`. Es el **mismo destino** que la activación de
pre_reserva de UC-14 (`ReservaPrereservaPrismaRepository.transicionarAPrereserva` ya escribe
`estado:'pre_reserva', subEstado:null, ttlExpiracion`), pero disparado por el resultado de
visita, no por la confirmación de presupuesto.

- **TTL de pre-reserva, no de consulta**: el TTL se lee de `ttl_prereserva_dias` (default
  **7**), **no** de `ttl_consulta_dias` (US-009). Se lee del setting, **nunca hardcodeado**.
  El use-case debe pedir `ttl_prereserva_dias` al puerto de settings (extendiendo el puerto
  de settings del use-case de resultado de visita, que hoy expone `ttlConsultaDias` y ya
  declara `ttlPrereservaDias?` como opcional).
- **TTL fresco desde `now`**: `now + ttl_prereserva_dias`, independiente del `ttl_expiracion`
  previo (día post-visita de `2.v`, fijado por US-008) y de `visita_programada_fecha`
  (informativa). Una **sola** fuente de verdad del cálculo del TTL, escrita idéntica en
  RESERVA y en `FECHA_BLOQUEADA`.

---

## D-3. Bloqueo `FECHA_BLOQUEADA` — UPDATE del TTL a 7 días (fase `pre_reserva`), nunca INSERT/DELETE

**Decisión**: como la RESERVA proviene de `2.v`, la fila de `FECHA_BLOQUEADA` con
`reserva_id` = esta reserva **siempre existe** (fue creada/actualizada por US-008): la
operación es un **UPDATE** puro del `ttl_expiracion` de esa fila, al **mismo valor** que
`RESERVA.ttl_expiracion` (`now + ttl_prereserva_dias`, 7 días), sin crear ni eliminar filas.
`tipo_bloqueo` **permanece** `'blando'` (US-010 no promociona a firme; eso es UC-15/señal).

- **Una sola fuente de verdad del TTL**: el `ttl_expiracion` se calcula **una vez** y se
  escribe **idéntico** en RESERVA y en `FECHA_BLOQUEADA` dentro de la misma transacción.
- **No hay rama de INSERT** en esta transición (al venir de `2.v` la fila ya existe), a
  diferencia de UC-14 que sí contempla INSERT desde origen `2.a`. La UoW usa `SELECT … FOR
  UPDATE` sobre la fila `(tenant_id, fecha)` como punto de serialización.
- **Concurrencia D4**: si otra transacción concurrente intentara **insertar** un bloqueo
  para la misma `(tenant_id, fecha)` (nuevo lead solicitando la misma fecha), el
  `UNIQUE(tenant_id, fecha)` garantiza que solo una fila existe: la insertadora recibe
  violación de unicidad (`P2002`) — no hay doble bloqueo. (Fuente: `US-010 §Concurrencia`;
  `CLAUDE.md §Regla crítica`.)

---

## D-4. Validación de datos obligatorios UC-14 — bloqueo estricto con lista de faltantes — PENDIENTE de Gate

**Contexto (nuevo respecto de US-009)**: la transición a `pre_reserva` requiere datos
completos estilo UC-14: en RESERVA (`fecha_evento`, `duracion_horas`, `tipo_evento`,
`num_adultos_ninos_mayores4`) y datos fiscales del CLIENTE (`dni_nif`, `direccion`,
`codigo_postal`, `poblacion`, `provincia`). Es la misma validación que UC-14 FA-01.

**Recomendación**: **reutilizar el patrón `CampoFiscalFaltante`** de
`generar-presupuesto.use-case.ts` (mismo conjunto de 9 campos, misma semántica de "enumerar
faltantes"). Antes de abrir la transacción de mutación (o al inicio de ella, tras la guarda
de origen), el use-case lee RESERVA + CLIENTE y computa la lista de campos faltantes; si es
no vacía → **bloquea la transición** devolviendo un error de validación con
`camposFaltantes`, **sin mutar nada** (la RESERVA permanece en `2.v`). El frontend usa esa
lista para permitir completar los datos en el mismo paso (UC-14 FA-01) antes de reintentar.

- **Código HTTP**: **422** (misma familia que la guarda de origen), con un cuerpo que
  incluye la lista `camposFaltantes` (coherente con el `ErrorResponse` del contrato). El
  `contract-engineer` afina el shape exacto post-gate.
- **Orden de validaciones**: (1) 404 existencia; (2) 422 guarda de origen `{2v}`; (3) 422
  datos obligatorios incompletos (con `camposFaltantes`). Todas **antes** de cualquier
  mutación; un rechazo revierte sin efectos.
- **Decisión: PENDIENTE de Gate.** Alternativa descartada: permitir la transición con datos
  incompletos y validarlos en UC-14 — rechazada porque la US exige explícitamente bloquear
  aquí (`§FA Datos obligatorios incompletos`).

---

## D-5. Vaciado atómico de la cola A16 — reutilizar el patrón de UC-14 — PENDIENTE de Gate

**Contexto (nuevo respecto de US-009)**: si la RESERVA en `2.v` es `consulta_bloqueante` de
N consultas en `2.d`, al pasar a `pre_reserva` la fecha queda comprometida y la cola debe
vaciarse: todas las RESERVA con `consulta_bloqueante_id` = esta reserva y `sub_estado='2d'`
pasan a `sub_estado='2y'`, `posicion_cola=NULL`, `consulta_bloqueante_id=NULL`, en la misma
transacción. Es exactamente la mecánica A16 de US-007 (`2.c`) y de UC-14.

**Recomendación**: **reutilizar el patrón `ColaPrereservaPrismaRepository.vaciar`** del UoW
de US-014 (`activar-prereserva-uow.prisma.adapter.ts`): lee los ids en cola (`findMany` por
`consultaBloqueanteId` + `subEstado=s2d`) **antes** del UPDATE masivo, aplica el
`updateMany` DENTRO de la misma transacción y devuelve los ids descartados; el use-case
escribe un `AUDIT_LOG accion='transicion'` por cada consulta vaciada.

- **Operación vacía válida**: si no hay consultas en `2.d` (0 filas), el vaciado **no** es
  error; la transición procede normalmente. (Fuente: `US-010 §FA Cola vacía`.)
- **Concurrencia del vaciado**: el `SELECT … FOR UPDATE` sobre la fila bloqueante serializa
  el vaciado frente a mutaciones concurrentes de `posicion_cola` de esa misma cola (p. ej.
  una promoción manual US-019 o el barrido). Una de las dos transacciones espera o falla
  controladamente; el estado final es consistente (ninguna RESERVA en `2.d` con
  `consulta_bloqueante_id` apuntando a una RESERVA ya en `pre_reserva`). (Fuente: `US-010
  §Concurrencia / Race Conditions`.)
- **Sin emails a la cola**: los emails automáticos de vaciado de cola (A16) están **solo
  diseñados** en MVP (coherente con US-007 y UC-14); la **mecánica** del vaciado sí se
  implementa, los emails de cola no. US-010 no dispara ningún email.
- **Decisión: PENDIENTE de Gate.** Alternativa: repositorio de cola propio de esta
  transición (mismo SQL). Recomendado reutilizar el de UC-14 para mantener DRY; el
  `backend-developer` decide la ubicación física del adaptador post-gate.

---

## D-6. Superficie de API — habilitar `reserva_inmediata` en el endpoint polimórfico — PENDIENTE de Gate

**Contexto**: US-009 ya dejó el endpoint **polimórfico** `PATCH /reservas/{id}/visita`
(`ResultadoVisitaRequest` con `resultado: ResultadoVisita`, enum `[interesado,
reserva_inmediata, descarta]`). Hoy el servidor **rechaza con 422** cualquier valor distinto
de `interesado`. El use-case `registrar-resultado-visita.use-case.ts` ya declara
`ResultadoVisita = 'interesado' | 'reserva_inmediata' | 'descarte'`.

**Decisión (recomendada)**: **habilitar el valor `reserva_inmediata`** en el mismo endpoint
polimórfico (levantar la guarda actual que lo rechaza), coherente con el diseño que dejó
US-009 explícitamente para US-010. El resultado `reserva_inmediata` produce:
`estado='pre_reserva'`, `subEstado=null`, `visitaRealizada=true`, `ttlExpiracion` a 7 días
(`now + ttl_prereserva_dias`), cola vaciada.

**Contrato previsto (input para la fase de contrato — NO se toca `docs/api-spec.yml` aquí)**:
```
PATCH /reservas/{id}/visita
Body:    { "resultado": "reserva_inmediata" }
200:     RESERVA con estado='pre_reserva', subEstado=null, visitaRealizada=true,
         ttlExpiracion (now + ttl_prereserva_dias, 7 días)
422:     - guarda de origen (RESERVA no en 2v) o terminal (inmutable)
         - datos obligatorios incompletos (cuerpo con camposFaltantes, §D-4)
404:     RESERVA inexistente para el tenant
401/403: sin sesión / rol insuficiente
```

> El `contract-engineer` (post-gate) decide si mantiene el nombre `reserva_inmediata` o lo
> alinea con el enum del contrato (`ResultadoVisita` usa `reserva_inmediata` y `descarta`;
> el use-case usa `descarte` — a reconciliar en la fase de contrato), documenta la respuesta
> 200 de `pre_reserva` y el 422 de `camposFaltantes`. Aquí solo se fija la intención: **se
> habilita `reserva_inmediata`** en el endpoint existente y produce `pre_reserva + TTL 7d +
> cola vaciada`. **Decisión de forma exacta: PENDIENTE de Gate / contract-engineer.**

---

## D-7. Migración Prisma — confirmar NINGUNA — PENDIENTE de Gate (verificación)

Verificado contra `prisma/schema.prisma` de `master`: todo lo necesario existe.
- `EstadoReserva` enum incluye `pre_reserva`.
- `Reserva.subEstado` es `SubEstadoConsulta?` (**nullable**) → admite `NULL` en pre_reserva.
- `Reserva.visitaRealizada` (BOOLEAN, default false).
- `Reserva.ttlExpiracion` (TIMESTAMP nullable).
- `TenantSettings.ttlPrereservaDias` (INT, `@map("ttl_prereserva_dias")`).
- Campos de cola: `Reserva.posicionCola` (INT?), `Reserva.consultaBloqueanteId` (String?),
  relación `ColaEspera`; índice UNIQUE PARCIAL `reserva_cola_posicion_key`.
- `SubEstadoConsulta` incluye `s2d` y `s2y`.
- Campos fiscales del CLIENTE: `dniNif`, `direccion`, `codigoPostal`, `poblacion`,
  `provincia` (todos String? en `Cliente`).
- `AuditLog.accion='transicion'` ya usado por US-005/007/008/009 y UC-14.

**Recomendación: sin migración.** **Verificación pendiente** de confirmación humana en el
Gate. (No hay que sembrar plantilla de email porque US-010 no dispara ningún email.)

---

## Resumen de decisiones para el Gate

| # | Decisión | Resolución propuesta | ¿Migración? |
|---|----------|----------------------|-------------|
| D-1 | Guarda de origen | Tabla declarativa **mono-estado** `{2v} → pre_reserva`; todo lo demás inválido; terminales/`pre_reserva` inmutables | No |
| D-2 | Transición a `pre_reserva` | `estado='pre_reserva'`, `sub_estado=NULL`, `visita_realizada=true`, `ttl=now + ttl_prereserva_dias` (7d, del setting) | No |
| D-3 | Bloqueo `FECHA_BLOQUEADA` | **UPDATE** del `ttl_expiracion` de la fila existente a `now + ttl_prereserva_dias`; `tipo_bloqueo` permanece `blando`; sin INSERT/DELETE; D4 por `UNIQUE(tenant,fecha)` | No |
| D-4 | Validación de datos obligatorios | Reutilizar `CampoFiscalFaltante` (UC-14); si faltan → **422 con `camposFaltantes`**, RESERVA intacta en `2.v` — **PENDIENTE de Gate** | No |
| D-5 | Vaciado de cola A16 | Reutilizar patrón `ColaPrereservaPrismaRepository.vaciar` (UC-14); `2.d → 2.y` en la misma tx; válido con 0 filas; AUDIT_LOG por consulta vaciada — **PENDIENTE de Gate** | No |
| D-6 | Superficie de API | **Habilitar `reserva_inmediata`** en el endpoint polimórfico `PATCH /reservas/{id}/visita` — **PENDIENTE de Gate / contract-engineer** | No |
| D-7 | Migración | Ninguna (enum `pre_reserva`, `sub_estado` nullable, `ttl_prereserva_dias`, cola, `2y`/`2d`, campos fiscales de CLIENTE ya en `master`) — **verificar en impl** | No (a confirmar) |
