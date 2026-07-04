# Change: us-026-cierre-automatico-ficha-operativa

## Why

Un evento que llega a T-0 con la `FICHA_OPERATIVA` **sin cerrar** (`pre_evento_status ≠
cerrado`) deja al equipo operando el día del evento sobre datos en estado inconsistente y
abre la puerta a un sub-estado incoherente (dolores **D10**/**D11**). US-025 dio al gestor
el cierre **manual** de la ficha (`pre_evento_status: en_curso → cerrado`, `ficha_cerrada =
true`, `fecha_cierre = now()`), pero **nadie garantiza el cierre si el gestor no actúa**:
la ficha puede quedarse en `pendiente` o `en_curso` indefinidamente hasta el propio día del
evento. **US-026 (UC-20, FA-01, actor Sistema)** es el mecanismo automático que, en el día
T-1d anterior a `fecha_evento`, **fuerza el cierre** de toda ficha aún abierta de una
RESERVA `reserva_confirmada`, con los datos disponibles en ese momento. (`US-026 §Historia`,
`§Contexto de Negocio`; `use-cases.md` UC-20 FA-01; automatización **A10**.)

- US-026 se apoya en el **patrón obligatorio "estado en fila + barrido periódico"**
  (`CLAUDE.md §Jobs asíncronos`; `architecture.md §2.5`; skill `async-jobs`): un cron
  scheduler invoca un **endpoint interno protegido** (`X-Cron-Token`) idempotente que barre
  las RESERVA elegibles y cierra sus fichas en el pase. El campo "en fila" es
  `RESERVA.fecha_evento` (comparado con `mañana`) + `pre_evento_status`. PROHIBIDO
  Lambda/EventBridge ni timers exactos. Mismo estilo que **US-012** (barrido de expiración
  por TTL, ya archivado): endpoint protegido idempotente con resumen del barrido.
- El actor es el **Sistema**, no un usuario: US-026 no aporta pantalla propia. El único
  efecto observable en UI es que, tras el barrido, la ficha aparece cerrada en la vista de
  ficha operativa de US-025 (`ficha_cerrada = true`); no hay flujo de navegador nuevo.
  (`US-026 §Email relacionado`: ninguno de E1–E8 activo.)
- El cierre automático **reutiliza la misma mutación de cierre de US-025** (mismo triplete
  `ficha_cerrada`/`fecha_cierre`/`pre_evento_status = cerrado` + `AUDIT_LOG accion =
  'transicion'`), pero **forzado por Sistema** y **sin bloqueo por campos vacíos** (la
  ficha puede estar parcialmente rellenada o vacía). Deja cubierta la precondición
  `pre_evento_status = cerrado` de la transición a `evento_en_curso` (US-031). (`US-025
  §pre_evento_status = cerrado como precondición…`; UC-20.)

## What Changes

- **Extiende la capability existente `ficha-operativa`** (NO crea una nueva): añade el
  **flujo de cierre automático en T-1d** como efecto de la automatización **A10**, modelado
  sobre `RESERVA` + `FICHA_OPERATIVA` y la máquina de estados declarativa. (`US-026 §Reglas
  de negocio`; `CLAUDE.md §Máquina de estados`.)
- **Endpoint interno protegido de barrido de fichas**, autenticado **service-to-service**
  con la cabecera `X-Cron-Token` (nunca JWT de usuario; `CRON_TOKEN` ya en
  `env.validation.ts`). Idempotente: re-ejecutarlo no cierra fichas ya cerradas ni duplica
  `AUDIT_LOG`. Devuelve un **resumen** del barrido (candidatas, fichas cerradas, fallos
  aislados). **Reutiliza el endpoint genérico `POST /cron/barrido?tarea=fichas`** ya
  declarado en el contrato: la enum `tarea` incluye `fichas` y su comentario ya nombra
  US-026 como dueña de ese barrido. (`docs/api-spec.yml` `/cron/barrido`, enum
  `tarea: […, fichas, …]`; skill `async-jobs`.)
- **Cron scheduler** (`@nestjs/schedule`) que invoca el endpoint **una vez al día**
  (T-1d/T-0, p. ej. 23:59 o 00:01) con el token. El scheduler no ejecuta lógica de negocio:
  solo dispara el endpoint (invocable manualmente y testeable por HTTP).
- **Selección de candidatas** (filtro estricto, comparación de **fecha de calendario**, no
  de instante): `RESERVA.estado = 'reserva_confirmada'` **AND** `RESERVA.pre_evento_status
  != 'cerrado'` **AND** `date(RESERVA.fecha_evento) = date(mañana)` (día T-1d = hoy →
  `fecha_evento = hoy + 1 día`). Excluye por construcción las fichas ya cerradas y las
  reservas en cualquier otro estado (`pre_reserva`, `reserva_cancelada`,
  `reserva_completada`, `consulta`, `evento_en_curso`, `post_evento`).
- **Acción por candidata**, en una **transacción atómica** bajo el contexto RLS del tenant:
  `FICHA_OPERATIVA.ficha_cerrada = true`, `FICHA_OPERATIVA.fecha_cierre = now()`,
  `RESERVA.pre_evento_status: {pendiente|en_curso} → cerrado`, y un registro en `AUDIT_LOG`
  con `accion = 'transicion'`, `entidad = 'RESERVA'`, origen **Sistema** (`usuario_id`
  nulo/no-usuario, causa `A10` en `datosNuevos`), siguiendo la convención de auditoría de
  Sistema del barrido de US-012.
- **Cierre forzado con datos disponibles**: el cierre **NO** depende del contenido de la
  ficha; una ficha vacía (`pre_evento_status = pendiente`, sin campos) se cierra igualmente.
  Se garantiza el avance de estado. Coincide con "el cierre no está bloqueado por campos
  vacíos" de US-025, pero aquí **sin aviso informativo** (proceso de Sistema, no interactivo).
- **Idempotencia**: una ficha ya cerrada (`pre_evento_status = cerrado`) **no** es candidata
  (el filtro la excluye); N ejecuciones del barrido sobre la misma reserva = **1 solo
  cierre** y **1 sola** entrada en `AUDIT_LOG`. Cubre el caso "gestor cerró manualmente antes
  de T-1d" (US-025): el mecanismo no actúa. (`US-026 §FA idempotencia`.)
- **Procesa todas las elegibles en el mismo pase** con **fallo aislado por RESERVA**: el
  fallo de un cierre (excepción/conflicto) no aborta ni revierte los demás; el resumen
  registra el fallo aislado. Mismo aislamiento que el lote de US-012.
- **Filtro estricto por estado**: cero efectos secundarios sobre RESERVA que no estén en
  `reserva_confirmada`, aunque su `fecha_evento = mañana`. (`US-026 §Reserva en estado
  distinto de reserva_confirmada`.)

## Impact

- Specs afectadas: **se extiende `ficha-operativa`** con `ADDED Requirements` para el cierre
  automático en T-1d. NO se crea capability nueva; NO se modifican `confirmacion`,
  `consultas`, `bloqueo-fecha`, `foundation`, `calendario` ni `app-shell`. (`spec-delta` en
  `specs/ficha-operativa/spec.md`.)
- Datos: **ninguna entidad ni migración de esquema nueva**. Usa `RESERVA`
  (`estado`, `pre_evento_status`, `fecha_evento`), `FICHA_OPERATIVA` (`ficha_cerrada`,
  `fecha_cierre`, relación 1:1 con RESERVA) y `AUDIT_LOG` — todo provisionado por US-021
  (FICHA_OPERATIVA creada vacía al confirmar) y US-025 (campos de cierre + transición).
- Contrato OpenAPI: **SÍ toca**, pero **reutiliza** el endpoint genérico de cron ya
  presente: `POST /cron/barrido?tarea=fichas` (seguridad `cronToken` / `X-Cron-Token`,
  respuesta `BarridoResponse`). NO se define un endpoint nuevo dedicado (a diferencia de
  US-012, que añadió `POST /cron/barrido-expiracion`): la enum `tarea` de `/cron/barrido` ya
  reserva `fichas` para esta US. El `contract-engineer` decidirá tras el gate si (a) basta
  con la variante `tarea=fichas` del endpoint genérico, o (b) conviene un endpoint dedicado
  `POST /cron/barrido-fichas` con su propio `BarridoFichasResponse` por simetría con US-012.
  Decisión de contrato marcada como **punto de gate** (ver `design.md §D-2`).
- Infra transversal: reutiliza `@nestjs/schedule` (activado en US-012) para el `@Cron`
  diario; consume `CRON_TOKEN` (ya declarado). Documentar el barrido de fichas en
  `architecture.md §2.5` junto al de expiración de US-012.
- Multi-tenancy/RLS: el barrido es un proceso de **Sistema**; opera **cross-tenant** (una
  pasada evalúa candidatas de todos los tenants) pero **cada** cierre se ejecuta bajo el
  **contexto RLS del tenant** de la RESERVA (`SET LOCAL app.tenant_id`), como en US-012.
  Ver `design.md §D-5`.
- Concurrencia: zona **menos crítica** que US-012 (no toca `FECHA_BLOQUEADA` ni cola), pero
  aún **TDD primero** en la idempotencia y el filtro. Tests de doble ejecución del cron
  (idempotencia), cierre manual (US-025) vs cierre automático concurrentes, y filtro
  estricto por estado/fecha. No hay `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`; sí una
  transacción por RESERVA con re-evaluación del filtro dentro (idempotencia). Ver
  `design.md §D-4`, `§D-6`.
- Trazabilidad: **US-026**, **UC-20 (FA-01)**, dolores **D10**/**D11**; automatización
  **A10**; reutiliza US-021 (FICHA_OPERATIVA creada), US-025 (mutación de cierre +
  precondición `cerrado`) y el patrón de cron de US-012. Deja cubierta la precondición de
  **US-031** (transición a `evento_en_curso`).
- **Fuera de alcance (out-of-scope explícito)**:
  - El **"resumen al cliente"** mencionado en A10 (email de recordatorio/resumen al cliente
    en T-1d): 📐 **lista negra** (recordatorios automáticos extendidos), sin código E en el
    MVP. US-026 **NO** envía ningún email (ni E1–E8 ni resumen al cliente). (`US-026 §Notas
    de alcance`, `§Email relacionado`.)
  - La **transición a `evento_en_curso`** en T-0 y la comprobación conjunta de las tres
    precondiciones (`pre_evento_status = cerrado` + `liquidacion_status = cobrada` +
    `fianza_status = cobrada`) → **US-031** (US-026 solo produce `pre_evento_status =
    cerrado`).
  - La **UI del dashboard de notificaciones** (US-044): US-026 no genera alerta interna al
    cliente ni superficie de notificaciones; su único rastro es `AUDIT_LOG`.
  - El **cierre manual** por el gestor antes de T-1d ya existe (US-025) y **prevalece**:
    US-026 no re-actúa sobre fichas ya cerradas.
