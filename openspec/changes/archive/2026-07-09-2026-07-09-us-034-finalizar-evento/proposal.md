# Change: 2026-07-09-us-034-finalizar-evento

## Why

Cuando un evento está en ejecución (`RESERVA.estado = evento_en_curso`, estado provisto
automáticamente por **US-031** en T-0), el **gestor** necesita una acción explícita para
**cerrar el ciclo de ejecución**: marcar el evento como finalizado. Esa acción hace **dos
cosas separadas pero disparadas por el mismo click**: (1) transiciona la RESERVA a
`post_evento` (transición **irreversible**, arranca el sub-proceso post-evento), y (2) si
hay fianza cobrada (`fianza_eur > 0`), **automatiza la solicitud de IBAN** enviando el email
**E5** (agradecimiento + solicitud de IBAN para la devolución de fianza + enlace NPS). Hoy
esa solicitud de IBAN se hace manualmente o **se olvida**, retrasando la devolución de la
fianza al cliente (dolores **D9** —automatización—, **D6** —inicio inmediato del sub-proceso
de devolución de fianza—, **D1** —trazabilidad centralizada del cierre del evento). Es la
**acción manual del gestor** que UC-25 modela como flujo básico. (Fuente: `US-034 §Historia`,
`§Contexto de Negocio`, `§Impacto de Negocio`; `use-cases.md` UC-25; `CLAUDE.md §Máquina de
estados`.)

- US-034 reutiliza la **máquina de estados declarativa** del agregado RESERVA
  (`apps/api/src/reservas/domain/maquina-estados.ts`): añade la guarda de origen
  `evento_en_curso → post_evento` como **estructura de datos** (misma forma que
  `resolverInicioEvento` de US-031 o `resolverExpiracionTtl` de US-012), **NO** como `if`
  dispersos. La transición es **incondicional respecto a la fianza y al email**: solo depende
  de que el estado de origen sea `evento_en_curso`. (`US-034 §Reglas de negocio`, `§Reglas de
  Validación`.)
- El envío de **E5** se apoya en el **motor de email reutilizable** ya archivado por **US-045**
  (capability `comunicaciones`): el motor selecciona la plantilla del `codigo_email = E5`,
  sustituye variables de `RESERVA`/`CLIENTE`, envía al `CLIENTE.email` por el puerto de dominio
  de envío y **registra** el resultado en `COMUNICACION` (`codigo_email = E5`, `reserva_id`,
  `cliente_id`, `tenant_id`, `estado`) y en `AUDIT_LOG`. US-034 **no reimplementa** ese motor:
  lo **invoca** con el trigger E5, condicionado a `fianza_eur > 0`. (`comunicaciones` spec viva,
  Requirement "Motor de email reutilizable"; `US-034 §Email relacionado` E5.)
- La **transición de estado y el envío de E5 son operaciones separadas** (ver `design.md §D-2`):
  el fallo de E5 (proveedor caído) **NO** revierte la transición. Si E5 falla, la RESERVA queda
  igualmente en `post_evento`, `COMUNICACION.estado = fallido`, y el gestor puede **reintentar**
  el envío desde la ficha. Esto es un requisito explícito de la US.
- La acción es la **contraparte manual** de la automatización de inicio de evento de US-031:
  US-031 dejó la RESERVA en `evento_en_curso` (precondición de estado); US-034 la saca de ahí a
  `post_evento`. **US-033** (documentación del evento) construye el checklist de documentación
  cuya completitud US-034 **consulta** (advertencia informativa no bloqueante), pero US-034
  **no** construye ese checklist.

## What Changes

- **Extiende la capability existente `consultas`** (dueña del ciclo de vida y las transiciones
  del agregado RESERVA, como declara la spec viva de `pipeline` y como hizo US-031): se añade la
  **transición manual `evento_en_curso → post_evento`** disparada por el gestor, modelada como
  **guarda de origen declarativa** en `maquina-estados.ts`. La transición es **irreversible** y
  **no depende** ni de la fianza ni del resultado del envío de E5.
- **Endpoint de usuario nuevo** que expone la acción "Marcar evento como finalizado" para el
  gestor sobre una RESERVA concreta (autenticado con **JWT de usuario**, no `X-Cron-Token`:
  esto es una acción manual, no un barrido de Sistema). La superficie exacta (verbo/ruta) la
  materializa el `contract-engineer` tras el gate; ver `design.md §D-3` para las opciones y la
  recomendación. Solo disponible cuando `RESERVA.estado = evento_en_curso`; en cualquier otro
  estado la acción se rechaza (conflicto de estado).
- **Disparo condicionado de E5** al confirmar la finalización: **solo si `fianza_eur > 0`** se
  invoca el motor de email de `comunicaciones` (US-045) con el trigger **E5** hacia
  `CLIENTE.email`, creando `COMUNICACION` con `codigo_email = E5`. Si `fianza_eur = 0` **o
  `fianza_eur IS NULL`**, **NO** se envía E5 **ni** se crea `COMUNICACION` para E5. E5 se
  envía **al cliente, nunca al gestor**.
- **`fianza_eur IS NULL` se trata como "sin fianza"** aunque `fianza_status = cobrada` (dato
  inconsistente de integridad): no se envía E5, y la inconsistencia se **registra en
  `AUDIT_LOG` como alerta de dato anómalo**. `fianza_eur IS NULL` nunca debe provocar un envío
  de E5 con IBAN pendiente.
- **La transición NO depende del éxito del envío de E5**: si E5 falla, la transición a
  `post_evento` se mantiene, `COMUNICACION.estado = fallido`, y el gestor recibe una alerta
  ("La reserva ha pasado a post-evento, pero el email E5 no pudo enviarse. Puedes reenviarlo
  desde la ficha."). El reenvío desde la ficha se apoya en el mecanismo de reintento del motor
  de `comunicaciones`.
- **NPS "programada" (T+3d) siempre**: al finalizar, la NPS queda **marcada como programada**
  (independiente de la fianza), como estado/marca. El **envío real** de la NPS a T+3d está
  **fuera de alcance MVP** (ver scope-out).
- **Advertencia informativa (no bloqueante) por checklist de documentación incompleto**: si el
  checklist de documentación del evento (superficie de **US-033**) tiene ítems pendientes, la
  acción **muestra una advertencia** enumerando los ítems sin subir ("Documentación pendiente:
  [lista]. Puedes continuar igualmente."), pero **NO bloquea** la finalización; el checklist
  permanece accesible para subidas tardías en `post_evento`. US-034 **consulta** la completitud
  del checklist; no lo construye.
- **AUDIT_LOG obligatorio en la transición**: `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores = {estado: evento_en_curso}`, `datos_nuevos = {estado: post_evento}`, con
  origen **Usuario** (el gestor autenticado, `usuario_id` poblado — a diferencia del barrido de
  Sistema de US-031). El `AUDIT_LOG` es obligatorio para toda transición de estado.

## Impact

- **Specs afectadas**:
  - **`consultas`** (extendida): `ADDED Requirements` para la transición manual `evento_en_curso
    → post_evento` (irreversible, incondicional respecto a fianza/email), la guarda de origen
    declarativa, la disponibilidad de la acción solo en `evento_en_curso`, la advertencia no
    bloqueante por checklist incompleto, y la auditoría de la transición con origen Usuario.
  - **`comunicaciones`** (extendida): `ADDED Requirements` para el disparo condicionado del
    trigger **E5** (solo `fianza_eur > 0`), el tratamiento de `fianza_eur IS NULL`/`= 0` como
    "sin fianza" (sin E5 ni `COMUNICACION`), la alerta de dato anómalo en `AUDIT_LOG` cuando
    `fianza_status = cobrada` con `fianza_eur IS NULL`, la separación transición↔envío (fallo de
    E5 ⇒ `COMUNICACION.estado = fallido` + reintento desde la ficha, sin revertir el estado), y
    la programación (marca) de la NPS a T+3d.
  - **NO** se crean capabilities nuevas; **NO** se modifican `pipeline` (lectura pura),
    `ficha-operativa`, `facturacion`, `foundation`, `calendario`, `auth`, `dashboard` ni
    `app-shell` (salvo lo que el `contract-engineer` decida para exponer el endpoint de la
    acción, dentro de `consultas`/`pipeline-ui`).
- **Datos**: **ninguna entidad ni migración de esquema nueva**. Usa `RESERVA` (`estado`,
  `fianza_eur`, `fianza_status`), `CLIENTE` (`email`), `COMUNICACION` (`codigo_email = E5`,
  `reserva_id`, `cliente_id`, `tenant_id`, `estado`) y `AUDIT_LOG`. El estado `post_evento` ya
  existe en el enum `EstadoReserva` (`maquina-estados.ts`, enum Prisma, contrato). La marca de
  "NPS programada" se resuelve con el modelo ya existente (ver `design.md §D-6`); no introduce
  esquema nuevo. `E5` ya está en el catálogo E1–E8 del motor de `comunicaciones` (US-045).
- **Contrato OpenAPI**: **un endpoint de usuario nuevo** para la acción del gestor
  (autenticación JWT), decidido por el `contract-engineer` tras el gate (`design.md §D-3`). No
  hay endpoint de barrido/cron (no es un job de Sistema).
- **Multi-tenancy/RLS**: la acción se ejecuta **bajo el contexto RLS del tenant** del gestor
  autenticado (el `tenant_id` viaja en el JWT); la RESERVA, el `CLIENTE` y la `COMUNICACION`
  operan en ese tenant. Nunca cross-tenant (a diferencia del barrido de US-031).
- **Bloqueo atómico de fecha**: **NO aplica**. US-034 no toca `FECHA_BLOQUEADA`, la cola ni el
  bloqueo atómico. La transición muta solo `RESERVA.estado` (+ COMUNICACION + AUDIT_LOG). No se
  introduce ningún lock distribuido (hook `no-distributed-lock`).
- **Concurrencia**: la única condición de carrera relevante es una doble finalización de la
  misma RESERVA (doble click / doble request). Se resuelve con la guarda de origen re-evaluada
  bajo `SELECT … FOR UPDATE` de la fila RESERVA: exactamente una transición gana; la segunda
  observa `estado ≠ evento_en_curso` y termina como conflicto de estado, sin doble transición ni
  doble `AUDIT_LOG` (**TDD primero**). La transición y el envío de E5 son operaciones separadas,
  de modo que el email no se envía dos veces por reintento del estado.
- **Trazabilidad**: **US-034**, **UC-25**, dolores **D9**/**D6**/**D1**; automatización **A11**
  (parcial en MVP: solicitud de IBAN vía E5 + NPS programada); email **E5** (condicionado a
  `fianza_eur > 0`); reutiliza US-031 (precondición de estado `evento_en_curso`), US-045 (motor
  de email/`comunicaciones`) y consulta US-033 (checklist de documentación).
- **Fuera de alcance (out-of-scope / lista negra MVP — declaración explícita)**:
  - **Envío real de la NPS a T+3d**: el disparo automático del email de NPS a T+3d es 📐
    ("Recordatorios automáticos extendidos"). En MVP la NPS solo queda **marcada como
    programada**; **NO** se envía automáticamente. US-034 no construye el cron de envío de NPS.
  - **A23 (T+3d, primer recordatorio de IBAN)** y **A24 (T+7d, segundo recordatorio de IBAN)**:
    ambos 📐 (lista negra — recordatorios automáticos extendidos). **NO** implementados en MVP.
  - **Factura complementaria post-evento** ("A11 factura complementaria si aplica"): 📐 lista
    negra explícita MVP. Si existen `RESERVA_EXTRA` con `factura_id IS NULL` al finalizar el
    evento, **quedan pendientes** para gestión futura; US-034 **no** las genera en este paso.
  - **Construcción del checklist de documentación del evento** (DNI anverso/reverso, cláusula de
    responsabilidad) → **US-033**. US-034 solo **consulta** su completitud para la advertencia no
    bloqueante; no construye ese checklist ni su UI.
  - **US-032 (override / forzado manual del inicio de evento) NO está implementado todavía**
    (ver `design.md §D-1`, asunción): US-034 depende **solo** de que la RESERVA esté en
    `evento_en_curso`, precondición que **US-031 (ya archivada)** provee automáticamente en T-0.
    US-034 no requiere US-032 para funcionar.
  - La **UI del dashboard de notificaciones** (US-044): US-034 **produce** las alertas (E5
    fallido, checklist incompleto, dato anómalo de fianza) siguiendo la convención de alertas ya
    establecida; **no** construye una superficie de notificaciones nueva. El rastro auditable es
    `AUDIT_LOG` + `COMUNICACION`.
