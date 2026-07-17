# Design — us-046-revisar-enviar-email-borrador

> Decisiones técnicas de US-046 / UC-36. La US es un **flujo de acción manual del
> gestor** sobre el módulo `comunicaciones` (US-045). Introduce por primera vez la
> **superficie HTTP** del módulo (`interface/`, hoy solo `.gitkeep`). Todas las
> decisiones marcadas **DECISIÓN ABIERTA** requieren el visto bueno humano en el
> Gate 1 antes de implementar.
>
> Fuente: `US-046`; UC-36; spec viva `comunicaciones` (US-045); código
> `apps/api/src/comunicaciones/{domain,application}`; `CLAUDE.md §Multi-tenancy`,
> `§Máquina de estados`, `§Regla crítica bloqueo atómico` (no aplica aquí).

## Contexto: qué existe ya (US-045) y qué NO se reimplementa

- **Motor** `DespacharEmailService` (application) con tres caminos ya centralizados:
  - `despachar(comando)` — camino automático del ciclo de vida (idempotente por
    `(reserva, código)`; crea borrador y envía o deja `borrador` si `autoenviar=false`).
  - `finalizarEnvio(params)` — **post-commit**: dada una `COMUNICACION` ya creada en
    estado NO final, envía por el puerto y la promueve a `enviado`/`fallido`. **No
    propaga** el fallo del proveedor (lo traza en `AUDIT_LOG` y deja `fallido`).
  - `despacharReenvio(comando)` — crea SIEMPRE una fila nueva `es_reenvio=true`
    (excepción auditada a la idempotencia) y envía.
- **Puertos de dominio**: `EnviarEmailPort`, `ComunicacionRepositoryPort`
  (`buscarPorReservaYCodigo`, `crear`, `actualizarEstado`), `CatalogoPlantillasPort`,
  `TenantSettingsPort`, `AuditLogPort`, `ClockPort`.
- **Esquema**: `COMUNICACION` ya tiene `asunto`, `cuerpo?`, `destinatario_email`,
  `estado`, `fecha_envio?`, `es_reenvio` (default false), índice UNIQUE parcial
  `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false`.
- **NO se toca**: transporte real (Resend) / fake, bloqueo atómico de fecha, máquina
  de estados de la RESERVA. US-046 **no** cambia el estado de la RESERVA.

---

## Decisiones abiertas (para el Gate 1)

### D-1 — ¿Use-case de aplicación dedicado o reutilizar `finalizarEnvio`/`despacharReenvio`?

**Contexto.** El envío del borrador (borrador→enviado por el gestor) encaja
casi exactamente con `finalizarEnvio` (fila ya creada, no final, enviar y promover
a `enviado`/`fallido`, sin propagar). El email manual encaja con "crear fila nueva y
enviar" (patrón `despacharReenvio` pero sin `es_reenvio`). Pero US-046 añade
requisitos que hoy **no** están en esos métodos:

- Edición opcional de `asunto`/`cuerpo` (hay que persistir lo enviado, no el original).
- Validación de `destinatario_email` **antes** de enviar que **deja en `borrador`**
  (los métodos actuales, ante fallo, dejan `fallido`).
- Descartar (borrador→`fallido` **sin** enviar).
- Carga del contexto (leer la `COMUNICACION` por id + tenant, leer el `CLIENTE`).

- **Opción A (recomendada): use-case(s) de aplicación nuevos que ORQUESTAN los
  puertos de US-045.** Un `GestionarComunicacionManualUseCase` (o tres use-cases:
  `EnviarBorradorUseCase`, `DescartarBorradorUseCase`, `CrearEmailManualUseCase`) que:
  lee la `COMUNICACION` y el `CLIENTE`, valida estado/destinatario, y **reutiliza**
  `EnviarEmailPort` + `ComunicacionRepositoryPort.actualizarEstado`/`crear` (o invoca
  `finalizarEnvio` para el envío del borrador). Para editar, actualiza `asunto`/
  `cuerpo` antes/junto al envío. No reimplementa el transporte ni la auditoría.
  *Pro*: la semántica de US-046 (validación previa que deja en borrador, descarte,
  edición) es distinta de los caminos de US-045; encapsularla en su use-case evita
  contaminar el motor con ramas de acción manual. *Contra*: algo de código nuevo.
- **Opción B: extender `finalizarEnvio` con parámetros de edición y de "no fallar,
  dejar en borrador".** *Pro*: menos clases. *Contra*: mezcla la semántica
  post-commit automática con la acción manual; sobrecarga un método que hoy tiene un
  contrato claro; riesgo de regresión en el cableado E1 del alta.

**Sub-decisión.** ¿El envío del borrador **reutiliza `finalizarEnvio`** internamente
(recomendado, un solo camino de envío/finalización) o replica `enviarYFinalizar`?
Nota: la validación de destinatario que **deja en `borrador`** debe correr **antes**
de `finalizarEnvio` (que ante fallo deja `fallido`).

**Recomendación:** Opción A con envío del borrador delegado a `finalizarEnvio`
(previa edición de `asunto`/`cuerpo` y previa validación de email). Confirmar
granularidad (uno o tres use-cases).

### D-2 — Rutas y verbos REST

Módulo `comunicaciones` sin superficie HTTP previa. Todas las acciones cuelgan de una
RESERVA (multi-tenancy + contexto de la ficha).

- **Opción A (recomendada): sub-recurso de la reserva.**
  - `GET  /reservas/{id}/comunicaciones`
  - `POST /reservas/{id}/comunicaciones/{idComunicacion}/enviar`
  - `POST /reservas/{id}/comunicaciones/{idComunicacion}/descartar`
  - `POST /reservas/{id}/comunicaciones/manual`
  *Pro*: coherente con `/reservas/{id}/presupuesto/...` de US-015 y con la ficha.
- **Opción B: recurso raíz `/comunicaciones` con `reservaId` en query/body.**
  *Contra*: menos alineado con el resto del contrato; RLS/scoping menos explícito.

**Sub-decisiones:** ¿`enviar`/`descartar` como verbos de acción (POST sub-ruta) o
`PATCH .../{idComunicacion}` con `{ accion }`? ¿código de error del proveedor: `502`
Bad Gateway o `200` con la fila en `fallido`? (el hook de contrato exige coherencia
con OpenAPI; lo cierra `contract-engineer`).

**Recomendación:** Opción A, verbos de acción POST. Formato de error del proveedor a
decidir (propuesta: responder 200 con la fila en `fallido` + flag, para que el gestor
vea el estado y pueda reintentar, coherente con "sin excepción al llamador" del motor).

### D-3 — Listado de comunicaciones de una reserva (nuevo método de repositorio)

`ComunicacionRepositoryPort` hoy solo tiene `buscarPorReservaYCodigo`, `crear`,
`actualizarEstado`. El listado de la ficha necesita **todas** las `COMUNICACION` de
una reserva.

- **Opción A (recomendada): añadir `listarPorReserva({ tenantId, reservaId })` al
  puerto** y su adaptador Prisma (scoped por RLS/tenant), devolviendo la proyección
  `ComunicacionRegistrada` (+ `asunto`, `codigoEmail`, `fechaCreacion`, `esReenvio`
  si el listado los expone). *Pro*: mantiene el listado en el puerto de dominio,
  testeable con doble. *Contra*: amplía la interfaz.
- **Opción B: query de lectura dedicada (CQRS-lite) fuera del puerto.** *Contra*:
  duplica el acceso a `COMUNICACION`; el proyecto ya centraliza en el puerto.

**Sub-decisión:** ¿La proyección de listado necesita más campos que
`ComunicacionRegistrada` (p. ej. `asunto`, `cuerpo`, `fechaCreacion`)? Probablemente
sí para la ficha; definir un `ComunicacionListItem` o extender la proyección.

**Recomendación:** Opción A con proyección de listado enriquecida.

### D-4 — ¿Dónde vive la validación de `destinatario_email` / `CLIENTE.email`?

La regla exige validar formato RFC 5321 + no-nulo **antes** de intentar el envío, y
que un email inválido **deje el borrador en `borrador`** (no `fallido`).

- **Opción A (recomendada): validador de dominio puro reutilizable**
  (`esEmailValido(email): boolean` en `comunicaciones/domain/`, junto a `validar-iban`
  que ya existe con ese patrón), invocado por el use-case **antes** de llamar al
  puerto de envío. Si es inválido → error de validación de aplicación (422), sin tocar
  la fila. *Pro*: puro, testeable, coherente con `validar-iban.ts`; separa "no se pudo
  intentar" (queda `borrador`) de "el proveedor falló" (queda `fallido`).
- **Opción B: validar solo en el DTO (class-validator `@IsEmail`).** *Contra*: el
  `destinatario_email` **no** lo edita el gestor (viene del cliente); la validación es
  sobre un dato leído de BD, no del body; el DTO no cubre el caso.

**Recomendación:** Opción A (validador de dominio), invocado por el use-case. El DTO
valida solo los campos que el gestor sí edita (`asunto`, `cuerpo` opcionales; y en el
email manual, obligatorios).

### D-5 — Descarte a `fallido` y `reserva_id` del email `manual` frente al índice parcial

**Descarte.** No hay estado "descartado"; el descarte intencional del gestor se
modela como `estado='fallido'` + `AUDIT_LOG` con causa "descartado por gestor".

- **Opción A (recomendada): `actualizarEstado({ estado:'fallido', fechaEnvio:null })`**
  sobre la fila del borrador, **sin** llamar al puerto de envío, + `AuditLogPort` con
  la causa. *Pro*: reutiliza el repositorio; deja la fila coherente (`fallido` sin
  `fecha_envio`). *Contra*: `fallido` mezcla "el proveedor falló" con "el gestor
  descartó"; se **distingue por el `AUDIT_LOG`** (causa "descartado por gestor").
  Documentar esta convención.
- **Opción B: añadir un campo/motivo de descarte.** *Contra*: cambio de esquema; la
  US dice explícitamente que no hay estado descartado y que se registra en auditoría.

**`reserva_id` del email `manual`.** La US-046 crea el email manual **desde la ficha
de una RESERVA** (AC: "`reserva_id` y `cliente_id` correctos"), luego lleva
`reserva_id` **no nulo**. Pero el índice UNIQUE parcial es
`(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false`, y el
comentario del schema de US-045 asumía que los `manual` iban con `reserva_id NULL`
(fuera del constraint). **Tensión a resolver:**

- **Opción A (recomendada): email `manual` con `reserva_id` no nulo y
  `es_reenvio = true`** al crearlo, de modo que queda **fuera** del índice parcial
  (permite varios `manual` por reserva sin colisión `P2002`), reutilizando el
  mecanismo ya usado por US-028/US-023 para reenvíos. *Pro*: sin cambio de esquema;
  permite múltiples emails manuales por reserva; consistente con "excepción a la
  idempotencia". *Contra*: usa `es_reenvio` con una semántica ampliada ("fuera del
  constraint de idempotencia", no literalmente "reenvío"); documentar.
- **Opción B: `manual` con `reserva_id NULL`** (como asumía el comentario original).
  *Contra*: contradice el AC de US-046 ("`reserva_id` correcto") y rompería el listado
  por reserva de la ficha (no se podría listar el manual bajo su reserva).
- **Opción C: cambiar el predicado del índice para excluir `codigo_email='manual'`.**
  *Contra*: migración de esquema + SQL crudo del índice parcial; mayor alcance.

**Recomendación:** Opción A (`manual` con `reserva_id` + `es_reenvio=true`), sin
migración, documentando la semántica de `es_reenvio` como "fuera del constraint de
idempotencia". Confirmar con el humano por afectar a la invariante de US-045.

---

## Invariantes y no-objetivos

- US-046 **NO** muta `RESERVA.estado` ni `FECHA_BLOQUEADA` (solo lee cliente/reserva).
- `enviado` es **terminal**: no se revierte a `borrador`; no se re-envía una fila
  `enviado` (idempotencia de la acción manual; ver requirement ADDED).
- Envío de email en **modo fake** en `test`/CI (reutiliza el transporte de US-045):
  las pruebas no envían correos reales.
- Toda operación corre bajo el **contexto RLS del tenant del JWT**; nunca cross-tenant.
- El gestor edita **solo** `asunto`/`cuerpo`; `codigo_email` y `destinatario_email`
  no son editables.

## Tabla de decisiones — RESUELTA en el Gate 1 (2026-07-17)

| ID  | Decisión | Recomendación | Resolución humana (Gate 1) |
|-----|----------|---------------|-------------------|
| D-1 | Use-case dedicado vs. reutilizar métodos del motor | Opción A | **Opción A — TRES use-cases enfocados**: `EnviarBorradorUseCase`, `DescartarBorradorUseCase`, `CrearEmailManualUseCase`. Cada uno orquesta los puertos de US-045; el envío del borrador delega en `finalizarEnvio` (un solo camino de envío), previa edición de `asunto`/`cuerpo` y previa validación de destinatario. |
| D-2 | Rutas REST + formato de error del proveedor | Opción A + 200-fallido | **Opción A (sub-recurso de reserva, verbos POST)** para las rutas. **Error del proveedor → `502 Bad Gateway`** (NO 200-con-fila-fallido): el fallo del proveedor se expresa como error HTTP para que el `onError` del frontend lo capture por status. La fila queda igualmente persistida en `fallido` (el use-case traza el fallo antes de que el controller mapee a 502). Distinción de códigos: `422` = destinatario inválido, ni se intenta (queda `borrador`); `409` = conflicto de estado (no es `borrador`); `502` = se intentó y el proveedor falló (queda `fallido`). |
| D-3 | Listado por reserva en el repositorio | Opción A | **Opción A** — añadir `listarPorReserva({ tenantId, reservaId })` al `ComunicacionRepositoryPort` con proyección de listado enriquecida (`ComunicacionListItem`: + `asunto`, `codigoEmail`, `fechaCreacion`, `esReenvio`, flags de solo-lectura/accionable). |
| D-4 | Dónde vive la validación de email | Opción A | **Opción A** — validador de dominio puro `esEmailValido(email): boolean` en `comunicaciones/domain/` (junto a `validar-iban.ts`), invocado por el use-case ANTES del puerto de envío. El DTO valida solo lo que el gestor edita (`asunto`/`cuerpo`). |
| D-5 | Descarte a `fallido` + `reserva_id` del `manual` | Opción A (`es_reenvio=true`) | **Descarte: Opción A** — `actualizarEstado({ estado:'fallido', fechaEnvio:null })` sin enviar + `AuditLogPort` con causa `"descartado por gestor"`. **`reserva_id` del `manual`: Opción C (MIGRACIÓN)** — el email `manual` se crea con `reserva_id` NO nulo y `es_reenvio = false` (honesto: no es un reenvío), y se **recrea el índice UNIQUE parcial** para excluir `codigo_email = 'manual'`. Motivo: `es_reenvio` se muestra en el listado de la ficha; marcarlo `true` en un manual nuevo mentiría sobre la invariante de US-045. La migración es aditiva (solo añade un predicado de exclusión); E1–E8 conservan su idempotencia intacta. |

### D-5 — Forma concreta de la migración (Opción C)

Índice actual (US-028, `20260704140000`):

```sql
CREATE UNIQUE INDEX "uq_comunicacion_reserva_codigo"
  ON "comunicacion" ("reserva_id", "codigo_email")
  WHERE "reserva_id" IS NOT NULL AND "es_reenvio" = false;
```

Nueva migración US-046 (SQL crudo, patrón US-040/US-045/US-028, NO destructiva):

```sql
DROP INDEX IF EXISTS "uq_comunicacion_reserva_codigo";
CREATE UNIQUE INDEX "uq_comunicacion_reserva_codigo"
  ON "comunicacion" ("reserva_id", "codigo_email")
  WHERE "reserva_id" IS NOT NULL AND "es_reenvio" = false AND "codigo_email" <> 'manual';
```

Además, actualizar el **comentario del schema.prisma** del modelo `Comunicacion` (hoy dice
"Los emails `manual` (reserva_id NULL, US-046) … quedan excluidos"): ahora los `manual`
llevan `reserva_id` NO nulo y quedan excluidos por el predicado `codigo_email <> 'manual'`.
El email `manual` mantiene `es_reenvio = false` (semántica honesta).
