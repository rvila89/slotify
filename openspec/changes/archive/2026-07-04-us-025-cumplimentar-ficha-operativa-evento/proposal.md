# Change: us-025-cumplimentar-ficha-operativa-evento

## Why

US-025 (Alta, talla M, UC-20, Módulo M7 "Ficha operativa del Evento / Slotify Brief"):
una vez que una RESERVA está en `reserva_confirmada`, el Gestor necesita **cumplimentar
progresivamente** la ficha operativa del evento (nº invitados confirmado, menú, timing,
contacto del evento, notas, briefing del equipo) y **marcarla como cerrada** cuando esté
lista. Resuelve **D10** (elimina el briefing disperso en emails y WhatsApp centralizando
todos los datos operativos en un único documento consultable por el equipo), **D9** y
**D1**. Además, `pre_evento_status = cerrado` es **una de las tres precondiciones** para la
futura transición a `evento_en_curso` (junto con `liquidacion_status = cobrada` y
`fianza_status = cobrada`, US-031, fuera de alcance aquí). (Fuente: `US-025 §Historia`,
`§Contexto de Negocio`, `§Impacto de Negocio`; UC-20; `er-diagram.md §3.14 FICHA_OPERATIVA`,
`§RESERVA pre_evento_status`.)

El cimiento ya existe en `master` / en las specs vivas y **se reutiliza, no se recrea**:

- **Entidad `FICHA_OPERATIVA` (US-021, capability `confirmacion`)**: la spec viva de
  `confirmacion` ya declara el requisito "Creación idempotente de la FICHA_OPERATIVA vacía
  (relación 1:1)": al confirmar el pago de la señal, se crea una FICHA_OPERATIVA con
  `reserva_id @unique`, todos los campos de contenido a `NULL` y `ficha_cerrada = false`.
  El modelo Prisma `FichaOperativa` (schema.prisma ~L489) y el campo
  `RESERVA.preEventoStatus` (`enum PreEventoStatus { pendiente | en_curso | cerrado }`,
  `@default(pendiente)`, schema.prisma L72–76 y L280) **ya existen**. Este change **NO crea
  la entidad ni el enum**: añade la lectura/escritura de la ficha, su cierre y las
  transiciones de `pre_evento_status`.
- **Máquina de estados de reserva (`CLAUDE.md`, capability transversal)**: `pre_evento_status`
  es un sub-proceso paralelo de la RESERVA; sus transiciones (`pendiente → en_curso →
  cerrado`) se modelan como **estructura de datos** con guardas, no como código disperso,
  siguiendo el patrón del proyecto.
- **Multi-tenancy / RLS (`CLAUDE.md`)**: toda lectura/escritura de la ficha filtra por el
  `tenant_id` del JWT; la ficha de una reserva de otro tenant no es visible ni editable.
- **AUDIT_LOG (US-003+)**: cada guardado, cierre y edición posterior de la ficha registra la
  acción correspondiente.

(Fuente: ver `design.md` para la máquina de estados de `pre_evento_status`, las guardas de
acceso por estado de la RESERVA y las firmas previstas.)

## What Changes

> Slice vertical (backend + contrato + frontend "vista/formulario de la ficha operativa").
> Sujeto al **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Leer la ficha operativa de una RESERVA confirmada**: el Gestor consulta la ficha
  operativa de una RESERVA cuando `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso,
  post_evento}`. La respuesta incluye los campos de contenido, `ficha_cerrada`,
  `fecha_cierre` y el `pre_evento_status` de la reserva. (Fuente: `US-025 §Historia`, UC-20.)
- **Guardar/actualizar campos de la ficha**: el Gestor persiste `num_invitados_confirmado`,
  `menu_seleccionado`, `timing_detallado`, `contacto_evento_nombre`,
  `contacto_evento_telefono`, `notas_operativas`, `briefing_equipo`. Los campos son
  **opcionales** (parcial): se pueden guardar en varias pasadas. (Fuente: `US-025 §Happy
  Path`, `§Reglas de Validación`.)
- **Transición `pendiente → en_curso` al primer guardado con datos**: si al persistir la
  ficha `pre_evento_status = pendiente` y el guardado aporta **al menos un campo con dato**,
  el sistema transiciona `RESERVA.pre_evento_status` a `en_curso` en la misma transacción.
  **No requiere confirmación explícita** del Gestor. (Fuente: `US-025 §Happy Path`, `§Reglas
  de Validación`.)
- **Cerrar la ficha**: el Gestor activa "Cerrar ficha"; el sistema fija
  `FICHA_OPERATIVA.ficha_cerrada = true`, `FICHA_OPERATIVA.fecha_cierre = now()` y transiciona
  `RESERVA.pre_evento_status: en_curso → cerrado`. El **cierre NO está bloqueado por campos
  vacíos**: si faltan campos (p. ej. `menu_seleccionado`, `briefing_equipo`), el sistema
  permite el cierre y muestra un **aviso puramente informativo** (no es error). (Fuente:
  `US-025 §Happy Path`, `§Cierre con campos opcionales vacíos`, `§Reglas de negocio`.)
- **Edición de la ficha tras cerrarla**: con `ficha_cerrada = true` y `pre_evento_status =
  cerrado`, el Gestor puede seguir modificando campos; el sistema persiste el cambio,
  **actualiza `fecha_cierre = now()`** y **NO reabre el estado** (`pre_evento_status`
  permanece `cerrado`, la edición no lo devuelve a `en_curso`). (Fuente: `US-025 §Edición de
  la ficha tras cerrarla`, `§Reglas de negocio`.)
- **Acceso restringido por estado de la RESERVA (guarda de acceso)**: la ficha solo existe y
  es editable cuando `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}`.
  Si la RESERVA está en un estado **anterior** a `reserva_confirmada` (p. ej. `pre_reserva`),
  el sistema **no expone entidad** y responde con un mensaje contextual "La ficha operativa
  estará disponible una vez confirmada la reserva". (Fuente: `US-025 §Acceso a la ficha
  operativa antes de reserva_confirmada`, `§Reglas de Validación`.)
- **Auditoría**: `AUDIT_LOG` con la acción correspondiente en cada guardado de campos, en el
  cierre (transición `en_curso → cerrado`) y en cada edición posterior al cierre. (Fuente:
  `US-025 §Happy Path`, ambos escenarios de cierre/edición.)
- **Frontend "Ficha operativa del evento"**: en la ficha de una RESERVA en
  `reserva_confirmada` (o posterior), el Gestor ve un formulario con los campos de la ficha,
  el estado (`pendiente`/`en_curso`/`cerrado`), el botón "Cerrar ficha" (con confirmación y
  aviso informativo de campos vacíos) y, tras el cierre, la fecha de cierre y la posibilidad
  de seguir editando. Cuando la RESERVA está antes de `reserva_confirmada`, muestra el
  mensaje contextual en lugar del formulario. Responsive mobile-first (390/768/1280).

## Impact

- Specs: **crea la capability `ficha-operativa`** (ADDED requirements para la lectura de la
  ficha de una reserva confirmada, el guardado parcial de campos, la transición `pendiente →
  en_curso` al primer guardado con datos, el cierre no bloqueante con aviso informativo de
  campos vacíos, la edición tras cierre que actualiza `fecha_cierre` sin reabrir el estado, la
  guarda de acceso por estado de la RESERVA con mensaje contextual y la auditoría de todos los
  cambios). La **creación** de la FICHA_OPERATIVA vacía **no** se redefine: la aporta la spec
  viva de `confirmacion` (US-021) y se **reutiliza**.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevén **endpoints nuevos** anidados en el
  recurso reserva (ver `design.md §D-5`, input para la fase de contrato). El
  `contract-engineer` (post-gate) los definirá; **no se toca `docs/api-spec.yml` en este
  change de spec**. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/ficha-operativa/{domain,application,infrastructure,interface}/**`
  (máquina de estados de `pre_evento_status` como estructura de datos con guardas en dominio
  puro, use-cases de leer/guardar/cerrar la ficha, guarda de acceso por estado de RESERVA,
  AUDIT_LOG) y `apps/web/src/features/ficha-operativa/**` (vista/formulario). La ubicación
  exacta se fija en `design.md`.
- **Migración**: **no prevista**. El modelo `FichaOperativa` ya tiene todas las columnas
  necesarias (`num_invitados_confirmado`, `menu_seleccionado`, `timing_detallado`,
  `contacto_evento_nombre`, `contacto_evento_telefono`, `notas_operativas`, `briefing_equipo`,
  `ficha_cerrada`, `fecha_cierre`, `reserva_id @unique`) y el enum `PreEventoStatus`
  (`pendiente | en_curso | cerrado`) ya existe (schema.prisma L72–76, L280, L489–507). Si el
  desarrollo detectara la falta de algo, se evalúa en implementación.
- Trazabilidad: **US-025**, **UC-20**, Módulo M7; entidades FICHA_OPERATIVA, RESERVA
  (`pre_evento_status`), AUDIT_LOG.
- Dependencias (archivada en `master`): **US-021** (la FICHA_OPERATIVA vacía y los tres
  sub-procesos —incl. `pre_evento_status = pendiente`— se crean al transicionar a
  `reserva_confirmada`), US-003+ (AUDIT_LOG).

## Lo que NO entra (anti-scope)

- **Cierre automático de la ficha a T-1d (US-026, actor Sistema)**: el barrido periódico
  que cierra la ficha si el Gestor no lo hizo antes del evento es **US-026**, fuera de este
  change (aquí solo el cierre **manual** del Gestor).
- **Transición a `evento_en_curso` (US-031)**: `pre_evento_status = cerrado` es una de las
  tres precondiciones, pero la transición en sí (y la comprobación conjunta con
  `liquidacion_status = cobrada` y `fianza_status = cobrada`) es US-031, fuera de alcance.
- **Email A8 (inicio sub-proceso pre-evento: email al cliente con nº invitados/menú/timing)**
  y **A9 (T-3d, briefing PDF al equipo)**: ambos 📐 **solo diseñados, no implementados en
  MVP** (lista negra de recordatorios automáticos extendidos). No se dispara ningún email en
  este paso. (Fuente: `US-025 §Automatización relacionada`, `§Notas de alcance`.)
- **Creación de la FICHA_OPERATIVA vacía**: la aporta US-021 (`confirmacion`) al confirmar;
  este change **no** la crea ni la redefine.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-1**: máquina de estados de `pre_evento_status` (`pendiente → en_curso → cerrado`) como
  estructura de datos con guardas; la edición post-cierre **no** reabre el estado.
- **D-2**: criterio de "primer guardado con datos" que dispara `pendiente → en_curso` (al
  menos un campo no nulo/no vacío en el guardado o en la ficha resultante).
- **D-3**: guarda de acceso por `RESERVA.estado`; respuesta ante estado anterior a
  `reserva_confirmada` (mensaje contextual, sin entidad) y forma de exponerlo en el contrato.
- **D-4**: comportamiento de `fecha_cierre` en la edición post-cierre (se actualiza a `now()`
  en cada guardado con la ficha ya cerrada).
- **D-5**: contrato — verbos/paths de los endpoints anidados de la ficha (input para la fase
  de contrato).
- **D-6**: cierre no bloqueante — el aviso de campos vacíos es informativo (front + payload
  de respuesta), nunca un error 4xx.
