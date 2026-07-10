# Change: us-035-registrar-iban-devolucion

## Why

Cuando un evento ha finalizado (`RESERVA.estado = post_evento`, estado provisto por **US-034**)
y hubo **fianza cobrada** (`RESERVA.fianza_eur > 0`), el sistema ya solicitó al cliente su IBAN
enviando el email **E5** (agradecimiento + solicitud de IBAN, US-034). El cliente responde con su
IBAN por email o comunicación directa, pero hoy ese dato **se pierde en hilos de Gmail** y la
confirmación de recepción se hace **a mano o se olvida**, retrasando la devolución de la fianza
(dolores **D6** —gestión centralizada de la fianza en Slotify—, **D9** —confirmación automática al
cliente—, **D1** —trazabilidad del ciclo solicitud → recepción → confirmación).

US-035 cierra ese ciclo: el **gestor** registra manualmente en Slotify el IBAN que el cliente le
proporcionó, y el sistema, tras validar el IBAN, lo persiste y **confirma automáticamente** la
recepción al cliente enviando el email **E8** (confirmación de recepción del IBAN + próximos pasos
para la devolución). Es el paso que **UC-26 (FA-01)** y **UC-27 (pasos 1–3)** modelan como cierre
del ciclo de solicitud iniciado por E5. (Fuente: `US-035 §Historia`, `§Contexto de Negocio`,
`§Impacto de Negocio`; `use-cases.md` UC-26/UC-27.)

- **El IBAN es un atributo de `CLIENTE`, no de `RESERVA`**: se persiste en `CLIENTE.iban_devolucion`
  (campo ya existente en el schema, ver §Impact) y queda **disponible para futuras reservas del
  mismo cliente**. La acción se ejecuta **en el contexto de una RESERVA concreta** en `post_evento`
  con `fianza_eur > 0` (para acotar el dolor y para que la `COMUNICACION` E8 quede ligada a esa
  reserva). (`US-035 §Reglas de negocio`, `§Reglas de Validación`.)
- **La validación de formato/checksum IBAN (módulo 97) precede a toda escritura**: si el IBAN es
  inválido, el sistema **no persiste** ni envía E8 (FA-01). La validación de formato es la única en
  MVP; la verificación bancaria en tiempo real queda **fuera de alcance** (📐). (`US-035 §Reglas de
  negocio`, `FA-01`, `§Notas de alcance`.)
- **El envío de E8 reutiliza el motor de email de `comunicaciones` (US-045)**: dado el trigger E8,
  el motor selecciona la plantilla, sustituye variables de `RESERVA`/`CLIENTE`, envía al
  `CLIENTE.email` por el puerto de dominio de envío y registra la `COMUNICACION` (`codigo_email =
  E8`, `reserva_id`, `cliente_id`, `tenant_id`, `estado`) y el `AUDIT_LOG`. US-035 **no reimplementa**
  el motor: lo **invoca** con el trigger E8. `E8` ya pertenece al catálogo E1–E8 declarado por
  US-045. Es el **trigger hermano de E5** cableado por US-034 sobre la misma capability.
- **El guardado del IBAN y el envío de E8 son operaciones separadas** (patrón "guardar-luego-enviar",
  ver `design.md §D-2`): si el proveedor de email falla, el IBAN queda **guardado igualmente**,
  `COMUNICACION.estado = fallido`, y el gestor puede **reintentar** el envío desde la ficha (FA-03).
  Esto es simétrico al patrón de E5 en US-034 (fallo de email no revierte el efecto persistido).

## What Changes

- **Extiende la capability existente `comunicaciones`** (dueña del motor de email E1–E8 y del
  cableado de sus triggers, US-045 + US-034): se añaden `ADDED Requirements` para el **registro del
  IBAN de devolución** y el disparo del trigger **E8**. No se crean capabilities nuevas.
- **Endpoint de usuario nuevo** que expone la acción "Registrar IBAN de devolución" del gestor
  sobre una RESERVA concreta (autenticado con **JWT de usuario**, no `X-Cron-Token`: es una acción
  manual). Solo disponible cuando `RESERVA.estado = post_evento` **Y** `RESERVA.fianza_eur > 0`; en
  cualquier otra combinación la acción se **rechaza** (conflicto de estado / sin fianza). La
  superficie exacta (verbo/ruta) la materializa el `contract-engineer` tras el gate; ver
  `design.md §D-4` para las opciones y la recomendación.
- **Validación IBAN (checksum módulo 97) previa a toda escritura**: el IBAN introducido se valida
  (longitud por país, prefijo de país, dígitos de control mod-97) **antes** de persistir. Si es
  inválido, el endpoint responde error de validación (`422`), **no** actualiza `CLIENTE.iban_devolucion`
  y **no** envía E8 (FA-01). La validación vive en el **dominio** (regla pura, sin infra).
- **Persistencia del IBAN en `CLIENTE.iban_devolucion`** (atributo del cliente): al guardar un IBAN
  válido se actualiza el campo. Si ya tenía valor previo (corrección), se **sobreescribe** (FA-02).
  El valor queda disponible para futuras reservas del mismo cliente.
- **Disparo de E8 tras guardar** (solo si el IBAN es válido y se persistió): se invoca el motor de
  email de `comunicaciones` con el trigger **E8** hacia `CLIENTE.email` (**nunca** al gestor),
  creando `COMUNICACION` con `codigo_email = E8`, `reserva_id`, `cliente_id`, `tenant_id`, `estado`.
- **Reenvío en corrección (FA-02)**: cada registro/corrección del IBAN dispara E8. Igual que el
  reenvío manual de E4 (US-028), un reenvío intencionado del gestor es una **excepción explícita y
  auditada** a la idempotencia `(reserva_id, codigo_email)` de US-045: crea una **nueva**
  `COMUNICACION` E8 (la decisión concreta —nueva fila vs. contador de reenvíos— se fija en el gate,
  `design.md §D-3`).
- **Guardado y envío separados (FA-03)**: si E8 falla en el proveedor, el IBAN **permanece guardado**,
  `COMUNICACION.estado = fallido`, y el gestor ve una alerta ("⚠️ IBAN guardado, pero E8 no pudo
  enviarse. Puedes reenviarlo desde la ficha.") El fallo del email **no** revierte la actualización
  del IBAN. El reintento se apoya en el mecanismo de reintento del motor de `comunicaciones`.
- **Sin fianza no se permite registrar IBAN (FA-04)**: si `RESERVA.fianza_eur = 0` **o `IS NULL`**,
  la acción se **rechaza** en backend (no hay fianza que devolver); la UI condiciona la
  visibilidad/habilitación del campo a `fianza_eur > 0`. El backend **no confía** en la UI: valida
  la precondición.
- **AUDIT_LOG obligatorio en toda actualización de `iban_devolucion`**: `accion = 'actualizar'`,
  `entidad = 'CLIENTE'`, `datos_anteriores = {iban_devolucion: <previo o null>}`, `datos_nuevos =
  {iban_devolucion: <nuevo>}`. En caso de fallo de E8, el `AUDIT_LOG` refleja también el fallo del
  email (coherente con el patrón de E5 de US-034).

## Impact

- **Specs afectadas**:
  - **`comunicaciones`** (extendida): `ADDED Requirements` para (1) el registro del IBAN de
    devolución sobre `CLIENTE.iban_devolucion` con validación mod-97 previa a toda escritura y
    auditoría obligatoria; (2) la precondición dual de disponibilidad (`estado = post_evento` **Y**
    `fianza_eur > 0`); (3) el disparo del trigger **E8** al `CLIENTE.email` (nunca al gestor) tras
    guardar; (4) la separación guardar↔envío (fallo de E8 ⇒ IBAN guardado + `COMUNICACION.estado =
    fallido` + reintento desde la ficha); (5) el reenvío de E8 en corrección del IBAN como excepción
    auditada a la idempotencia.
  - **NO** se crean capabilities nuevas; **NO** se modifican `pipeline`, `ficha-operativa`,
    `facturacion`, `foundation`, `calendario`, `auth`, `dashboard`, `consultas` ni `app-shell`
    (salvo lo que el `contract-engineer` decida para exponer el endpoint de la acción, dentro de la
    superficie de post-evento — a fijar en el gate).
- **Datos**: **ninguna entidad ni migración de esquema nueva**. `CLIENTE.iban_devolucion`
  (`String?`, máx. 34) **ya existe** en el schema Prisma (`apps/api/prisma/schema.prisma`, model
  `Cliente`, `ibanDevolucion String? @map("iban_devolucion")`) y en `docs/data-model.md §CLIENTE`.
  Se usan `RESERVA` (`estado`, `fianza_eur`), `CLIENTE` (`iban_devolucion`, `email`), `COMUNICACION`
  (`codigo_email = E8`, `reserva_id`, `cliente_id`, `tenant_id`, `estado`) y `AUDIT_LOG`. `E8` ya
  está en el catálogo E1–E8 del motor de `comunicaciones` (US-045).
- **Contrato OpenAPI**: **un endpoint de usuario nuevo** para la acción del gestor (autenticación
  JWT), decidido por el `contract-engineer` tras el gate (`design.md §D-4`). No hay endpoint de
  barrido/cron (no es un job de Sistema). El cliente HTTP del frontend se **regenera** desde el
  contrato (nunca a mano).
- **Multi-tenancy/RLS**: la acción se ejecuta **bajo el contexto RLS del tenant** del gestor
  autenticado (el `tenant_id` viaja en el JWT); la RESERVA, el `CLIENTE` y la `COMUNICACION` operan
  en ese tenant. Nunca cross-tenant.
- **Bloqueo atómico de fecha**: **NO aplica**. US-035 no toca `FECHA_BLOQUEADA`, la cola ni el
  bloqueo atómico. No se introduce ningún lock distribuido (hook `no-distributed-lock`).
- **Concurrencia**: `concurrencia_crítica = false`. No hay carrera crítica de negocio: registrar el
  IBAN es una escritura simple sobre `CLIENTE`. Un doble submit del mismo IBAN es idempotente en el
  valor persistido (el segundo escribe el mismo valor); dispararía a lo sumo un segundo E8 (reenvío
  auditado, aceptado por FA-02). No se requieren tests de concurrencia de bloqueo.
- **Frontend**: hay cambios de frontend (campo IBAN en la ficha de post-evento, condicionado a
  `fianza_eur > 0`, con validación de formato y alerta de fallo de E8 / botón de reenvío). Por
  tanto **aplica el paso E2E con Playwright MCP** (`step-N+3`).
- **Trazabilidad**: **US-035**, **UC-26 (FA-01)**, **UC-27 (pasos 1–3)**, dolores **D6**/**D9**/**D1**;
  automatización **A11** (cierre del ciclo de recepción de IBAN — sin código Axx propio); email
  **E8** (automático al guardar IBAN válido). Reutiliza US-034 (precondición de estado `post_evento`
  + fianza + E5 previo) y US-045 (motor de email/`comunicaciones`).
- **Fuera de alcance (out-of-scope / lista negra MVP — declaración explícita)** (de `US-035 §Notas de
  alcance`):
  - **Recordatorios automáticos si el cliente no aporta IBAN (A23 T+3d, A24 T+7d)**: 📐 Solo
    diseñado. **NO** implementados en MVP. El gestor contacta manualmente si el cliente no responde
    al E5. US-035 no construye ese cron.
  - **Formulario web autónomo del cliente para aportar IBAN**: 📐. En MVP el gestor introduce el
    IBAN recibido por email directamente en la ficha de la reserva; no hay portal de cliente.
  - **Validación bancaria en tiempo real** (verificar que la cuenta existe en el banco): 📐. En MVP
    solo se aplica la validación de **formato/checksum IBAN (mod-97)**.
  - **Procesamiento/ejecución de la devolución de la fianza** (transferencia, US-036): fuera de
    US-035. US-035 solo **registra el IBAN** y **confirma la recepción** (E8); la devolución
    efectiva la modela US-036.
