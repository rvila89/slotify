# Design — 2026-07-09-us-034-finalizar-evento

## Context

US-034 (UC-25, actor **Gestor**) es la **acción manual** que cierra la ejecución del evento:
transiciona `RESERVA.estado: evento_en_curso → post_evento` y, condicionalmente, dispara el
email **E5** (solicitud de IBAN + agradecimiento + NPS). Es la contraparte manual del inicio
automático de US-031. La infraestructura y las mutaciones de dominio que necesita ya existen y
**se reutilizan sin redefinir**:

- **US-031** (archivada) deja la RESERVA en `evento_en_curso` en T-0 (precondición de estado de
  US-034). Añadió la guarda de origen declarativa `reserva_confirmada → evento_en_curso` en
  `maquina-estados.ts`; US-034 añade la análoga `evento_en_curso → post_evento`.
- **US-045** (archivada) aportó el **motor de email reutilizable** (capability `comunicaciones`):
  dado un trigger E1–E8, selecciona plantilla, sustituye variables de `RESERVA`/`CLIENTE`,
  envía por el **puerto de dominio de envío** (adaptador Resend en infra, modo fake en test/CI) y
  **registra** en `COMUNICACION` + `AUDIT_LOG`. US-034 **invoca** ese motor con el trigger E5;
  no lo reimplementa. `E5` ya pertenece al catálogo E1–E8.
- **`maquina-estados.ts`** (dominio de `reservas`) modela las transiciones del agregado RESERVA
  como **tablas declarativas** (`resolverInicioEvento`, `resolverExpiracionTtl`, guardas de
  origen `esOrigenValidoPara…`). `post_evento` ya está en `EstadoReserva`. US-034 añade la guarda
  de origen `evento_en_curso → post_evento`.
- `AuditLogPort` compartido con `usuarioId` (aquí **poblado**: es una acción de Usuario, no de
  Sistema). RLS por tenant vía el JWT del gestor.

Este documento fija las decisiones no triviales. La **decisión de alcance que requiere
aprobación en el gate humano** es **D-3** (verbo/ruta del endpoint de la acción del gestor).

## D-1. Asunción de dependencia: US-031 sí, US-032 no (precondición de estado)

- La US declara la dependencia como **"US-031 o US-032"** para que la RESERVA esté en
  `evento_en_curso`. **US-031 (inicio automático en T-0) está ARCHIVADA** y provee esa
  precondición automáticamente. **US-032 (override / forzado manual del inicio) NO está
  implementada todavía**.
- **Decisión**: US-034 depende **exclusivamente de que `RESERVA.estado = evento_en_curso`**, sin
  importar **cómo** llegó a ese estado (cron de US-031 hoy; forzado manual de US-032 el día que
  aterrice). La guarda de origen `evento_en_curso → post_evento` es agnóstica del productor del
  estado. **US-034 no requiere US-032 para funcionar**; cuando US-032 aterrice, alimentará el
  mismo estado de origen sin cambios en US-034. Se blinda con un test que fija que la única
  precondición de la acción es el estado de origen.

## D-2. Transición y envío de E5 como operaciones SEPARADAS (regla dura de la US)

Es el trade-off central. La US exige que **el fallo de E5 no revierta la transición**.

- **Decisión**: modelar dos pasos con **acoplamiento débil**:
  1. **Paso transaccional (crítico)**: bajo `SELECT … FOR UPDATE` de la fila RESERVA, re-evaluar
     la guarda de origen (`estado = evento_en_curso`), transicionar a `post_evento`, escribir el
     `AUDIT_LOG` de la transición, marcar la NPS como programada (D-6) y —si procede— la alerta
     de dato anómalo de fianza (D-5). Este paso **commitea** el nuevo estado.
  2. **Paso post-commit (best-effort)**: si `fianza_eur > 0`, invocar el motor de E5. El envío
     vive **fuera** de la transacción de la transición (o en una unidad de trabajo propia), de
     modo que un fallo del proveedor deja `COMUNICACION.estado = fallido` **sin** revertir el
     estado ya commiteado.
- **Trade-off**: separar los pasos sacrifica la atomicidad "todo o nada" (podría quedar
  `post_evento` sin E5 enviado) a cambio de cumplir el requisito de negocio (la fianza es
  irrelevante para el avance del ciclo; el email es reintentable). La `COMUNICACION` E5 se crea
  **en ambos casos** (enviado/fallido) para dejar rastro y habilitar el reintento desde la ficha.
- **Idempotencia del email vs reintento del estado**: como la transición es irreversible y una
  segunda finalización se rechaza como conflicto de estado (guarda de origen), **E5 no se dispara
  dos veces** por reintentar la acción. El reintento de E5 se hace explícitamente desde la ficha
  (reenvío), no re-ejecutando la finalización.

## D-3. Endpoint que expone la acción del gestor — DECISIÓN DE ALCANCE (gate)

**Contexto**: es una acción manual sobre una RESERVA concreta, autenticada con **JWT de usuario**
(rol gestor), bajo RLS del tenant. NO es un barrido de Sistema → **no** usa `X-Cron-Token` ni
vive bajo `/cron`. Debe encajar en la convención de acciones de transición ya existente en el
contrato (las transiciones manuales de US-014/US-021/US-019, etc.).

**Opciones (el `contract-engineer` la materializa tras el gate):**

- **Opción A (preferida) — acción POST semántica sobre el recurso**: `POST
  /reservas/{id}/finalizar-evento` (o `.../post-evento`), 200/204 con la RESERVA/estado
  resultante; 409 si la RESERVA no está en `evento_en_curso`; 404 si no existe / otro tenant. El
  body de respuesta puede incluir el resultado de E5 (enviado/fallido/no_aplica) y la lista de
  ítems de checklist pendientes (advertencia). Ventaja: verbo de dominio explícito, coherente con
  las acciones de transición manual ya existentes; deja hueco natural para la advertencia y el
  estado de E5.
- **Opción B — PATCH de estado genérico**: `PATCH /reservas/{id}` con `{ estado: 'post_evento' }`
  validado contra la máquina de estados. Ventaja: menos superficie. Inconveniente: oculta la
  semántica de la acción (E5, advertencia de checklist, NPS) tras un PATCH genérico y complica el
  contrato de la respuesta (advertencia + resultado de E5).

**Recomendación del autor**: **Opción A** (acción semántica), por claridad de la respuesta
(advertencia de checklist + resultado de E5) y simetría con las transiciones manuales existentes.
La respuesta expone: estado resultante, `e5: { resultado: enviado|fallido|no_aplica }`,
`documentacionPendiente: string[]` (para la advertencia no bloqueante). **El
`contract-engineer` confirma verbo/ruta/DTO exactos tras el gate.** El **reintento de E5** desde
la ficha es un endpoint aparte del dominio `comunicaciones` (reenvío de una `COMUNICACION`
fallida); si no existe, el `contract-engineer` decide si lo añade aquí o queda a US de reenvío —
**punto de gate menor** (ver D-7).

## D-4. Condición de la fianza: fianza_eur > 0, con NULL == sin fianza (guarda pura)

- **Decisión**: una función de dominio **pura** decide si corresponde E5:
  `debeEnviarseE5(fianzaEur: number | null): boolean` ⇒ `fianzaEur != null && fianzaEur > 0`.
  `NULL` y `0` colapsan a **false** (sin E5). Vive en dominio (sin `@nestjs`/Prisma), testeada
  con la matriz `{null, 0, -x (defensivo), >0}`.
- **Dato anómalo**: `fianza_status = 'cobrada'` **AND** `fianza_eur IS NULL` es inconsistente.
  **Decisión**: `fianza_eur` **manda** sobre `fianza_status` para E5 (nunca se envía IBAN sin
  importe), y la inconsistencia se registra como **alerta de dato anómalo en `AUDIT_LOG`** (no
  bloquea la transición, no envía E5). No se "arregla" el dato aquí (eso sería otra US); solo se
  deja rastro auditable.

## D-5. AUDIT_LOG de la transición (origen Usuario) + alerta de dato anómalo

- La transición se audita con `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores =
  {estado: evento_en_curso}`, `datos_nuevos = {estado: post_evento}`, **con `usuario_id` del
  gestor** (origen **Usuario**), vía el `AuditLogPort` compartido. **Contraste con US-031**: allí
  el barrido es Sistema (`usuario_id` no poblado); aquí es una acción manual (usuario poblado).
- El `AUDIT_LOG` de la transición **refleja el resultado de E5** (enviado/fallido/no_aplica) y,
  si aplica, la **alerta de dato anómalo** de fianza. La entrada de transición se escribe en el
  paso transaccional (D-2 paso 1); el resultado de E5 se conoce tras el paso 2 — el diseño puede
  (a) escribir el rastro de E5 en la `COMUNICACION` (fuente de verdad del estado del email) y
  referenciarlo, o (b) actualizar/anexar el resultado de E5 al rastro. **Decisión**:
  `COMUNICACION` es la fuente de verdad del estado de E5; el `AUDIT_LOG` de la transición registra
  la finalización y una nota del resultado de E5 sin duplicar la máquina de estados del email.

## D-6. Modelado de "NPS programada" (T+3d) sin envío real (out-of-scope MVP)

- La NPS queda **programada** siempre (independiente de la fianza), pero **no se envía** en MVP.
  **Decisión**: modelar "programada" como una **marca** derivada del estado `post_evento` +
  `fecha_evento` (T+3d es calculable), sin introducir esquema nuevo ni un cron de envío. El
  disparo real a T+3d seguiría el patrón "estado en fila + barrido periódico" de US-012/US-031 en
  una **US futura** (📐 recordatorios automáticos extendidos), que barrería reservas en
  `post_evento` con NPS programada y vencida. US-034 **no** crea ese cron ni envía la NPS.
- Trade-off: no persistir un campo dedicado "nps_programada" evita esquema y mantiene la marca
  como derivada; si la implementación descubre que necesita un flag/fecha explícito para el barrido
  futuro, es una decisión de implementación menor (no de alcance) siempre que **no** dispare envío.

## D-7. Detección del checklist incompleto (advertencia no bloqueante)

- El checklist de documentación del evento es superficie de **US-033**. US-034 **consulta** su
  completitud vía un **puerto de lectura** (`DocumentacionEventoPort.itemsPendientes(reservaId)`
  o equivalente) que devuelve la lista de ítems sin subir. La advertencia es **informativa**:
  se calcula y se devuelve en la respuesta de la acción, pero **no** condiciona la transición.
- Si US-033 aún no expone ese checklist en el estado actual del código, el puerto se define con un
  **adaptador conservador** (p. ej. "sin ítems pendientes" o basado en los campos de documentación
  ya existentes en `FICHA_OPERATIVA`/`RESERVA`), documentando la asunción. La advertencia nunca
  bloquea; en el peor caso no se advierte, y la transición procede — **fail-open** coherente con
  "no bloqueante". Esta es una decisión de acoplamiento con US-033 que conviene validar en el gate.

## D-8. Concurrencia — doble finalización de la misma RESERVA (TDD primero)

- Única condición de carrera: dos peticiones concurrentes de finalización de la misma RESERVA
  (doble click). **Decisión**: la guarda de origen se re-evalúa **dentro de la transacción bajo
  `SELECT … FOR UPDATE`** de la fila RESERVA; exactamente una UPDATE gana (`estado =
  evento_en_curso → post_evento`), la segunda observa `estado ≠ evento_en_curso` (0 filas) y
  termina como **conflicto de estado** sin doble transición, sin doble `AUDIT_LOG` y **sin doble
  E5** (E5 solo se dispara tras un commit exitoso de la transición). La serialización la da
  PostgreSQL sobre la fila RESERVA — **sin locks distribuidos** (hook `no-distributed-lock`; no se
  toca `FECHA_BLOQUEADA` ni la cola). **TDD primero** sobre este caso.

## D-9. Hexagonal: dominio puro + caso de uso + adaptadores

- **Dominio** (`reservas/domain`): la guarda de origen `evento_en_curso → post_evento` en
  `maquina-estados.ts` (tabla declarativa) + la guarda pura `debeEnviarseE5(fianzaEur)`. Sin
  `@nestjs`/Prisma (hook `no-infra-in-domain`).
- **Aplicación**: un caso de uso `FinalizarEventoService` que (1) abre transacción, `SELECT …
  FOR UPDATE`, re-evalúa la guarda de origen, transiciona a `post_evento`, escribe `AUDIT_LOG`
  (origen Usuario), marca NPS programada y —si `fianza_status=cobrada && fianza_eur IS NULL`—
  la alerta de dato anómalo; commit; (2) si `debeEnviarseE5(fianzaEur)`, invoca el **motor de
  email de `comunicaciones`** (puerto) con el trigger E5 (best-effort, deja `COMUNICACION`
  enviado/fallido); (3) consulta ítems de documentación pendientes (puerto de lectura) para la
  advertencia; (4) devuelve estado resultante + resultado de E5 + advertencia.
- **Infraestructura**: controller con **JWT guard** (rol gestor) para el endpoint (D-3); adaptador
  Prisma de la UoW de transición (`$transaction` + RLS del tenant del gestor + `SELECT … FOR
  UPDATE` sobre RESERVA); reuso del motor/puerto de `comunicaciones` (US-045) y de `AuditLogPort`.
  Sin adaptador de proveedor de email nuevo (lo aporta US-045).

## Riesgos / Trade-offs

- **Atomicidad parcial (D-2)**: `post_evento` puede quedar sin E5 enviado si el proveedor falla;
  se acepta por requisito de negocio y se mitiga con `COMUNICACION.estado = fallido` + reintento
  desde la ficha. El riesgo inverso (E5 enviado pero estado no commiteado) se evita disparando E5
  **solo tras** el commit de la transición.
- **Dato anómalo de fianza (D-4)**: `fianza_eur` manda sobre `fianza_status`; se prioriza "no
  enviar IBAN sin importe" y se deja alerta auditable. No se corrige el dato aquí.
- **Acoplamiento con US-033 (D-7)**: si el checklist aún no está expuesto, la advertencia es
  fail-open; conviene confirmar en el gate el contrato del puerto de lectura de documentación.
- **NPS programada sin envío (D-6)**: se modela como marca derivada; el envío real es una US
  futura (📐). Riesgo: si se necesita flag/fecha explícito para el barrido futuro, es decisión de
  implementación menor sin disparar envío.
- **Endpoint de la acción (D-3)**: decisión de gate; A (acción semántica) vs B (PATCH genérico).
- **Reintento de E5 (D-3/D-7)**: si no existe endpoint de reenvío de `COMUNICACION`, el
  `contract-engineer` decide alcance en el gate.

## Pendiente / fuera de alcance

- **Envío real de la NPS a T+3d** → 📐 recordatorios automáticos extendidos (US futura). US-034
  solo marca "programada".
- **A23 (T+3d recordatorio IBAN)** y **A24 (T+7d segundo recordatorio IBAN)** → 📐 lista negra.
- **Factura complementaria post-evento** (`RESERVA_EXTRA` con `factura_id IS NULL`) → 📐 lista
  negra; quedan pendientes, US-034 no las genera.
- **Construcción del checklist de documentación del evento** → **US-033** (US-034 solo consulta).
- **US-032 (override manual del inicio de evento)** → no implementada; US-034 no la requiere
  (D-1).
- **UI del dashboard de notificaciones** → **US-044** (US-034 produce alertas, no construye la
  superficie).
- **Corrección del dato anómalo de fianza** (`fianza_status=cobrada` con `fianza_eur IS NULL`) →
  fuera de alcance; US-034 solo alerta en `AUDIT_LOG`.
