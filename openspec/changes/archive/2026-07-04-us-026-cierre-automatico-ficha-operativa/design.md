# Design — us-026-cierre-automatico-ficha-operativa

## Context

US-026 (UC-20 FA-01, actor **Sistema**) es el **flujo invocante** que cierra el patrón
"estado en fila + barrido periódico" para el **cierre automático de la ficha operativa en
T-1d** (automatización **A10**). La infraestructura y las mutaciones de dominio ya existen y
**se reutilizan sin redefinir**:

- **US-021** creó la `FICHA_OPERATIVA` **vacía** al confirmar la reserva (1:1 con RESERVA,
  `FICHA_OPERATIVA.reserva_id @unique`).
- **US-025** definió la **mutación de cierre** (`ficha_cerrada = true`, `fecha_cierre =
  now()`, `RESERVA.pre_evento_status: en_curso → cerrado`, `AUDIT_LOG accion =
  'transicion'`) y la máquina de estados de `pre_evento_status` (`pendiente → en_curso →
  cerrado`), además de la regla "cierre no bloqueado por campos vacíos" y la precondición
  `cerrado` para US-031. US-026 **reutiliza esa mutación** pero forzada por Sistema.
- **US-012** (ya archivado) aportó el **patrón de cron de barrido**: `@Cron`
  (`@nestjs/schedule`) → endpoint interno protegido `X-Cron-Token` (`CronTokenGuard`) →
  caso de uso de barrido con **fallo aislado por RESERVA** y **contexto RLS por tenant**
  (`SET LOCAL app.tenant_id`), más la **convención de auditoría de Sistema** (`usuario_id`
  no poblado por un usuario). US-026 replica esta forma para el barrido de fichas.
- `CRON_TOKEN` ya declarado en `apps/api/src/config/env.validation.ts`; `@nestjs/schedule`
  ya activado por US-012.
- `AuditLogPort` compartido (`apps/api/src/shared/audit/audit-log.port.ts`): `usuarioId` es
  **opcional**, de modo que una acción de Sistema puede omitirlo (así lo hace US-012).

Este documento fija las decisiones no triviales. **Una** es **decisión de alcance de
contrato que requiere aprobación en el gate humano**: D-2 (reutilizar el endpoint genérico
`/cron/barrido?tarea=fichas` vs. endpoint dedicado `/cron/barrido-fichas`).

## D-1. Patrón obligatorio "estado en fila + barrido periódico" (regla dura)

- El trabajo pendiente es **estado en la BBDD** (`RESERVA.fecha_evento` +
  `pre_evento_status` + `estado`), nunca un timer en memoria. PROHIBIDO Lambda/EventBridge
  ni timers exactos (skill `async-jobs`; `CLAUDE.md §Jobs asíncronos`; `architecture.md
  §2.5`).
- Un `@Cron` diario (`@nestjs/schedule`) invoca el **endpoint interno protegido** con la
  cabecera `X-Cron-Token`. Frecuencia **una vez al día** (US-026 §Supuestos: 23:59 de T-1d
  o 00:01 de T-0); no se depende de precisión de timer. El scheduler no ejecuta lógica de
  negocio: solo dispara el endpoint (invocable manualmente/por scheduler externo y testeable
  por HTTP).
- El barrido es **idempotente** (D-4): re-ejecutarlo no cierra fichas ya cerradas ni duplica
  auditorías.

## D-2. Superficie del barrido en el contrato — DECISIÓN DE ALCANCE (gate)

**Contexto**: el contrato ya declara `POST /cron/barrido` con un parámetro `tarea` cuyo enum
incluye `fichas`, y su comentario nombra explícitamente **US-026** como dueña de ese
barrido (`docs/api-spec.yml`, `/cron/barrido`: `tarea: [expiracion, cola, fichas, eventos,
archivado, recordatorios, all]`). US-012, en cambio, añadió un endpoint **dedicado**
`POST /cron/barrido-expiracion` con su propio `BarridoExpiracionResponse`.

**Decisión propuesta (a aprobar en el gate)** — dos opciones válidas; el `contract-engineer`
la materializa tras el gate:

- **Opción A (preferida): reutilizar el endpoint genérico** `POST /cron/barrido?tarea=fichas`
  con auth `cronToken` (`X-Cron-Token`) y respuesta `BarridoResponse` existente. Ventaja:
  el contrato **ya lo prevé** para US-026; menos superficie nueva. Inconveniente: el resumen
  `BarridoResponse` (`reservasExpiradas`, `fechasLiberadas`, `consultasPromovidas`,
  `recordatoriosEnviados`) no tiene un campo específico de "fichas cerradas"; habría que
  ampliarlo (p. ej. `fichasCerradas`) o mapear el recuento.
- **Opción B: endpoint dedicado** `POST /cron/barrido-fichas` con `CronTokenGuard` y un
  `BarridoFichasResponse` propio (`candidatas`, `fichasCerradas`, `fallos`), por **simetría
  con US-012**. Ventaja: resumen tipado específico, tests por HTTP aislados, coherencia con
  el precedente. Inconveniente: añade superficie y diverge de la enum `tarea` ya prevista.

**Recomendación del autor**: Opción A ampliando `BarridoResponse` con `fichasCerradas` (o
un objeto `fichas: { candidatas, cerradas, fallos }`), por respetar la decisión de
granularidad ya tomada en el contrato (comentario `[DECISIÓN granularidad]`). En cualquier
caso, la **auth `X-Cron-Token`** y la **idempotencia** son innegociables.

> **Punto de gate #1**: aprobar la superficie del barrido: (A) `POST
> /cron/barrido?tarea=fichas` (ampliando el resumen con las fichas cerradas), o (B) endpoint
> dedicado `POST /cron/barrido-fichas`. La auth service-to-service (`X-Cron-Token`, no JWT)
> y la respuesta con resumen son comunes a ambas.

## D-3. Transición de cierre como estructura de datos declarativa

La transición de `pre_evento_status` se modela como **tabla de datos** (skill `state-machine`,
NO `if` dispersos), consistente con la máquina de estados de US-025:

```
Cierre automático A10 (origen candidato → destino):
  pre_evento_status: pendiente → cerrado
  pre_evento_status: en_curso  → cerrado
  pre_evento_status: cerrado   → (no candidato: idempotente, no-op)
```

- El **filtro de candidatas** ya excluye `cerrado`; la guarda declarativa se re-evalúa
  dentro de la transacción de cada RESERVA (base de la idempotencia y de la concurrencia
  cierre-manual vs cierre-automático, D-6).
- La mutación acompañante (`ficha_cerrada = true`, `fecha_cierre = now()`) es la **misma**
  que la del cierre manual de US-025; US-026 la reutiliza sin redefinirla, cambiando solo el
  **origen** (Sistema) y quitando el **aviso informativo** interactivo (no aplica a un
  proceso batch).

## D-4. Selección de candidatas e idempotencia

- **Selección** = `estado = 'reserva_confirmada'` **AND** `pre_evento_status != 'cerrado'`
  **AND** `date(fecha_evento) = date(hoy) + 1 día`. Las fichas ya cerradas quedan fuera por
  construcción → 2.ª ejecución no las re-cierra. El filtro por estado es **estricto**: solo
  `reserva_confirmada`.
- **Comparación por fecha de calendario** (no por instante ni `ttl_expiracion`): la
  semántica de A10 es "T-1d anterior al `fecha_evento`", una fecha de calendario. El "día de
  mañana" se calcula sobre la zona horaria de negocio del tenant/aplicación de forma
  **consistente en toda la query** (una sola definición de "hoy"/"mañana" por pase), evitando
  el off-by-one de TZ conocido en presentación (`formatearFechaHora`, deuda técnica en
  memoria, **ajena a este change**): la lógica de selección **no** depende de ningún string
  formateado, sino de `date(fecha_evento)` comparado con el límite calculado en el backend.
  Se añade un test que fija esta invariante (D-7 en tasks).
- **Re-evaluación bajo transacción**: tras abrir la transacción de la RESERVA, se re-lee
  `pre_evento_status`; si ya es `cerrado` (otro pase o un cierre manual concurrente), la
  transacción no muta nada. Esto da idempotencia sin locks distribuidos.

## D-5. Multi-tenancy / RLS en un proceso de Sistema

- El barrido es **cross-tenant** (una sola pasada evalúa candidatas de todos los tenants),
  pero **cada** cierre se ejecuta bajo el **contexto RLS del tenant** de la RESERVA
  (`SET LOCAL app.tenant_id` vía `set_config`, mismo patrón que el adaptador de barrido de
  US-012). El `tenant_id` proviene de la fila candidata, nunca de input externo.
- La lectura inicial de candidatas cross-tenant usa el rol técnico del proceso de Sistema
  (como US-012); las escrituras siempre reponen el `tenant_id` correcto. Se documenta en
  `architecture.md §2.5` que es un punto legítimo cross-tenant y que las mutaciones respetan
  RLS por tenant.

## D-6. Concurrencia — zona menos crítica que US-012, pero TDD primero en idempotencia

A diferencia de US-012, US-026 **NO** toca `FECHA_BLOQUEADA`, cola ni bloqueo atómico de
fecha: no hay `UNIQUE(tenant_id, fecha)` ni promoción implicados. La zona crítica se reduce a
la idempotencia y a la coordinación con el cierre manual de US-025:

- **C-1 (doble ejecución del cron)**: dos pases concurrentes sobre la misma RESERVA →
  exactamente un cierre. La transacción por RESERVA re-evalúa `pre_evento_status` dentro de
  la transacción; el segundo lo encuentra ya `cerrado` y no muta nada. Sin locks
  distribuidos (hook `no-distributed-lock`); la serialización la da el motor de PostgreSQL
  sobre la fila de RESERVA/FICHA_OPERATIVA.
- **C-2 (cierre manual US-025 vs cierre automático concurrentes)**: si el gestor cierra
  manualmente mientras corre el barrido, **exactamente uno** aplica la transición
  `→ cerrado`; el otro re-evalúa y no re-cierra. Nunca queda un estado intermedio ni doble
  auditoría de cierre. Se apoya en el lock de fila de PostgreSQL sobre la RESERVA.
- Tests de concurrencia **reales** en la medida en que la infraestructura de tests lo
  permita (skill `concurrency-locking`); como mínimo, tests deterministas de la
  idempotencia (2.ª ejecución no muta) y del aislamiento de fallos. El test de US-004 flaky
  (`40P01`) es ajeno; solo se vigila al leer la suite global.

## D-7. Hexagonal: dominio puro + caso de uso de aplicación + adaptadores

- **Dominio**: la guarda/mapa de cierre A10 (`resolverCierreAutomatico(preEventoStatus)` o
  reuso de la transición de cierre de US-025) en la máquina de estados de la ficha/reserva.
  Nada de `@nestjs` ni Prisma (hook `no-infra-in-domain`).
- **Aplicación**: un caso de uso `CerrarFichasVencidasService` (o
  `BarridoCierreFichasUseCase`) que (1) lista candidatas (puerto de lectura), (2) por cada
  una abre una transacción, re-evalúa la guarda, aplica la mutación de cierre (reutilizando
  la de US-025) y audita como Sistema, y (3) agrega el resumen con **fallo aislado por
  RESERVA**. Mismo aislamiento de lote que US-012.
- **Infraestructura**: adaptador Prisma para listar candidatas cross-tenant y para la UoW de
  cierre (`$transaction` + `SET LOCAL app.tenant_id`); reuso del `CronTokenGuard` y del
  controller de cron (según la opción de contrato D-2); provider del `@Cron` diario.
  Registrar en el módulo correspondiente (`ficha-operativa`/`reservas` o un módulo `cron`
  compartido si ya existe para US-012).
- **AUDIT_LOG**: la transición se audita con `accion = 'transicion'`, `entidad = 'RESERVA'`,
  origen Sistema (`usuarioId` no poblado), causa `A10` en `datosNuevos`, vía el
  `AuditLogPort` compartido; no se duplica auditoría.

## D-8. Sin email y sin resumen al cliente (out-of-scope)

US-026 **NO** envía ningún email: ninguno de E1–E8 está activo en esta acción y el
**"resumen al cliente"** de A10 es 📐 **lista negra** (recordatorios automáticos extendidos),
fuera del MVP (sin código E). El único rastro del cierre es `AUDIT_LOG`. No hay alerta
interna ni superficie de notificaciones (US-044). (`US-026 §Email relacionado`, `§Notas de
alcance`.)

## Riesgos / Trade-offs

- **Definición de "mañana" y TZ** (D-4): el cálculo del día objetivo debe ser consistente
  con la zona horaria de negocio para no cerrar un día antes/después. Se fija una sola
  definición por pase y se testea; no se toca la deuda de `formatearFechaHora` (presentación).
- **Cross-tenant read + RLS write** (D-5): punto cross-tenant legítimo; se documenta y se
  testea que las escrituras nunca cruzan tenant.
- **Barrido secuencial** (fallo aislado) vs paralelo: se mantiene secuencial por simplicidad
  y aislamiento; el volumen de eventos con `fecha_evento = mañana` por día es acotado.
- **Contrato reutilizado vs dedicado** (D-2): decisión de gate; ambas opciones son
  funcionalmente equivalentes en cuanto a auth e idempotencia.

## Pendiente / fuera de alcance

- **Transición a `evento_en_curso`** en T-0 y comprobación conjunta de las tres
  precondiciones → **US-031** (US-026 solo produce `pre_evento_status = cerrado`).
- **Resumen/recordatorio al cliente** de A10 (email en T-1d) → 📐 lista negra, sin código E
  en MVP.
- **UI del dashboard de notificaciones** → US-044 (US-026 solo deja rastro en `AUDIT_LOG`).
- **Arreglo del off-by-one de TZ** en `formatearFechaHora` → change aparte (D-4 solo se
  blinda de no depender de fechas formateadas).
- **E2E de navegador**: US-026 no introduce UI propia (actor Sistema) → step-N+3 marcado
  N/A justificado (ver tasks.md).
