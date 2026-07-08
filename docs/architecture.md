# Arquitectura del Sistema — Slotify

> **Documento**: Diseño de Arquitectura
> **Proyecto**: Slotify — Plataforma SaaS de Gestión Integral para Espacios Boutique de Eventos Privados
> **Fuente**: EspecificacionFuncional.md · er-diagram.md · use-cases.md

---

## 0. Cómo leer este documento

Este documento describe la arquitectura de Slotify en **dos niveles deliberadamente separados**, presentados en orden de prioridad de construcción:

1. **Arquitectura de implementación del MVP (§2)** — el subconjunto pragmático que se construye realmente para el TFM, dado el alcance, el plazo y el modelo de desarrollo. **Es lo que se construye.**
2. **Arquitectura objetivo de producción (§3)** — la arquitectura a la que el producto evolucionaría cuando opere a escala, con múltiples tenants, tráfico real y necesidades de alta disponibilidad. **Es la visión de destino, no se implementa en el MVP.**

Separar ambos niveles es una decisión de arquitectura consciente. Implementar un subconjunto justificado demuestra criterio de priorización; diseñar para la escala futura demuestra visión. Las dos cosas se evalúan, y confundirlas —construir la arquitectura de producción para un piloto de un tenant— sería un error de sobreingeniería que comprometería el plazo sin aportar valor en esta fase.

La §4 contiene los prompts para generar ambos diagramas con DiagramsGPT. La §5 analiza el coste de hosting del MVP. La §6 documenta la trazabilidad de cada decisión de divergencia entre ambos niveles.

---

## 1. Principios arquitectónicos transversales

Estos principios rigen ambos niveles (MVP y objetivo):

1. **La reserva es el agregado raíz (DDD).** Toda la lógica de transición de estado, bloqueo de fecha y cola se modela alrededor de la entidad reserva. *Fuente: EspecificacionFuncional §10.2 #3.*
2. **Multi-tenancy desde el día 1.** `tenant_id` en toda tabla de negocio + aislamiento por Row-Level Security en PostgreSQL. Un tenant = un espacio. *Fuente: §10.2 #1, #2.*
3. **Atomicidad del bloqueo de fecha garantizada por la base de datos.** Restricción `UNIQUE(tenant_id, fecha)` sobre la entidad de bloqueo + transacciones con `SELECT ... FOR UPDATE`. Es el mecanismo central contra la doble reserva (riesgo crítico #1). *Fuente: §10.2 #11, §14.*
4. **Máquina de estados como configuración, no como código disperso.** Las transiciones permitidas y sus guardas se modelan como una estructura de datos consultada por una única función de transición. *Fuente: §10.2 #4.*
5. **Arquitectura hexagonal (puertos y adaptadores) en el backend.** El dominio define puertos (interfaces); la infraestructura provee adaptadores. El dominio nunca depende de frameworks, ORM ni servicios externos directamente.
6. **Eventos de dominio como base de las automatizaciones.** `ReservaConfirmada`, `FechaBloqueada`, `ColaPromovida`, etc. *Fuente: §10.2 #10.*
7. **Configurabilidad por tenant desde el día 1, opinión única en UX.** TTLs, porcentajes, plantillas y políticas viven en configuración por tenant aunque el MVP exponga un solo flujo. *Fuente: §10.3 "opinado por fuera, configurable por dentro".*

---

## 2. Arquitectura de implementación del MVP

> **Estado: ESTO es lo que se construye para el TFM.**

### 2.1 Resumen

El MVP se implementa como un **monolito modular**: el código vive en un **único monorepo** con dos aplicaciones (`apps/web` y `apps/api`), pero se despliega en **dos destinos según la naturaleza de cada pieza**. El frontend SPA (Vite + React) se publica como **archivos estáticos en un hosting de CDN** (la SPA no es un proceso vivo: se descarga y corre en el navegador). El backend de dominio (NestJS) corre como **proceso vivo** en su plataforma, contra una **única base de datos PostgreSQL**. Que el despliegue tenga dos destinos no rompe el carácter "monolítico" de la arquitectura: sigue habiendo un solo backend de dominio y una sola base de datos, que es lo que preserva las transacciones ACID nativas que protegen el bloqueo atómico de fecha. El backend NestJS aplica arquitectura por capas, DDD y hexagonal, y expone su contrato vía **OpenAPI**; la SPA consume ese contrato (pudiendo generar su cliente HTTP type-safe a partir del OpenAPI) mediante llamadas HTTP cross-origin (CORS configurado en el backend). Los procesos asíncronos se implementan con un **cron simple** que invoca un endpoint protegido de barrido. PDFs y justificantes se almacenan en el storage del hosting; el email transaccional usa un proveedor ágil; los secretos viven en variables de entorno cifradas.

### 2.2 Diagrama de implementación del MVP

```mermaid
graph TB
    Browser["Gestor (Browser)"]

    subgraph cdn["Hosting estático / CDN"]
        WEB["Frontend SPA (archivos estáticos)<br/>Vite + React + React Router<br/>Tailwind + shadcn/ui<br/>Cliente OpenAPI generado"]
    end

    subgraph deploy["Despliegue del backend (proceso vivo)"]
        API["Backend NestJS<br/>interface · application · domain · infrastructure<br/>DDD + Hexagonal + OpenAPI/Swagger<br/>Prisma ORM"]
        CRON["Cron simple<br/>Barrido de TTLs · Promoción de cola · Recordatorios"]
    end

    DB[("PostgreSQL<br/>RLS multi-tenant<br/>UNIQUE(tenant_id, fecha)<br/>índices + FTS")]
    STORE["Storage del hosting<br/>PDFs · Justificantes · Documentos"]
    MAIL["Proveedor de email<br/>Plantillas E1-E8"]
    ERR["Errores/observabilidad<br/>(Sentry u similar)"]

    Browser -->|"Descarga la SPA (estáticos)"| WEB
    Browser -->|"HTTP / REST (CORS)"| API
    API -->|"Lectura/escritura · transacciones"| DB
    API -->|"Subida/descarga"| STORE
    API -->|"Envío de emails"| MAIL
    API -->|"Errores"| ERR
    CRON -->|"Invoca endpoint de barrido"| API
    API -->|"Materializa expiraciones y promociones"| DB
```

> **Nota:** ambas cajas de despliegue salen del mismo monorepo (`apps/web` → CDN; `apps/api` → plataforma de backend). El navegador descarga la SPA del CDN y, ya en el cliente, llama a la API de NestJS por HTTP cross-origin.

### 2.3 Stack del MVP

| Capa | Tecnología | Razón |
|---|---|---|
| **Frontend** | Vite + React + React Router + TypeScript | SPA pura servida como estáticos desde un CDN: el producto es interno tras login (sin SEO/SSR necesario) y el backend ya es NestJS, así que no hace falta un framework full-stack. Frontera front/back limpia |
| **CORS** | `enableCors` en NestJS con origen permitido | La SPA (dominio del CDN) y la API (dominio del backend) son orígenes distintos; el backend declara qué origen puede llamarlo |
| **UI** | Tailwind + shadcn/ui | Velocidad de desarrollo, componentes accesibles |
| **Calendario** | react-big-calendar o FullCalendar | Maduros para vistas mensual/semanal con bloqueos |
| **Cliente API** | Generado desde OpenAPI de NestJS | Recupera type-safety y demuestra que el contrato OpenAPI se consume realmente |
| **Backend** | NestJS + TypeScript | Aplica capas + DDD + hexagonal + OpenAPI (objetivos formativos del máster); estructura que exhibe la arquitectura de forma explícita |
| **ORM** | Prisma | Migraciones controladas, DX para IA; `SELECT ... FOR UPDATE` vía `$queryRaw` dentro de transacción para el bloqueo |
| **BBDD** | PostgreSQL (gestionada) | Sostiene bloqueo atómico, RLS multi-tenant y búsqueda full-text del histórico |
| **Auth** | JWT (access en memoria + refresh en cookie httpOnly), NestJS + Passport | Access token de vida corta en memoria; refresh token en cookie httpOnly a salvo de XSS. Tenant y rol en el payload firmado. Ver §2.8 |
| **Jobs** | Cron simple → endpoint de barrido | TTLs como campo `ttl_expiracion` + barrido periódico; robusto e idempotente |
| **Email** | Resend SDK (`ResendEmailAdapter`) + `FakeEmailAdapter` en test/CI/dev; motor `DespacharEmailService` (`comunicaciones/application/`) + puerto `EnviarEmailPort` (`comunicaciones/domain/`); catálogo de plantillas en `comunicaciones/infrastructure/plantillas/` | Motor hexagonal reutilizable (US-045): selecciona plantilla → sustituye variables → resuelve adjuntos → envía por el puerto → registra en `COMUNICACION` + `AUDIT_LOG`. `FakeEmailAdapter` forzado en test/CI/dev (cero envíos reales); `ResendEmailAdapter` en producción. Configuración validada con zod: `EMAIL_TRANSPORT` (`resend`\|`fake`), `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SANDBOX`; en producción se exige `EMAIL_TRANSPORT=resend`. E1 activa; E2–E8 diseñadas/inactivas (cableado diferido a cada US). |
| **PDF** | Plantillas HTML + Puppeteer (o react-pdf) | Generación server-side; plantillas editables (presupuestos/facturas borrador) |
| **Storage** | El del hosting (p. ej. Supabase Storage) | Menos integración que un proveedor de objetos aparte |
| **Hosting** | Railway (recomendado) o Render free + Postgres gestionada | Ver análisis de coste en §5 |
| **Observabilidad** | Sentry (errores) | Útil y barato; PostHog y analytics quedan post-TFM |

### 2.4 El núcleo crítico: bloqueo atómico sin coordinación distribuida

Es la decisión técnica más importante del MVP y la que más diverge de la arquitectura objetivo.

**Decisión:** el bloqueo de fecha NO usa locks distribuidos (Redis/Redlock). Usa la garantía nativa de PostgreSQL: una entidad `FECHA_BLOQUEADA` con restricción `UNIQUE(tenant_id, fecha)`, manipulada dentro de transacciones.

**Por qué:** los locks distribuidos sólo son necesarios cuando varios procesos sin transacción común compiten por un recurso. El MVP tiene una única base de datos transaccional, por lo que la atomicidad ya está garantizada por el motor: dos transacciones concurrentes que intenten insertar la misma `(tenant_id, fecha)` resultan en una inserción exitosa y una violación de unicidad determinista, sin ventana de carrera. Introducir Redis añadiría un punto de fallo (incoherencia si el lock se concede pero la transacción falla) para resolver un problema inexistente. *Fuente: EspecificacionFuncional §10.2 #11, riesgo crítico #1; decisión de modelado ERD §FECHA_BLOQUEADA.*

**Encapsulación:** toda mutación de bloqueo pasa por dos funciones transaccionales del dominio — `bloquearFecha()` (UC-30 / US-040) y `liberarFecha()` (UC-31 / US-041) — que sincronizan la fila de `FECHA_BLOQUEADA` y el estado de la reserva en la misma transacción. Toda la mecánica de cola (promoción, reordenación, encadenamiento) se construye sobre ellas. Esto centraliza el riesgo crítico en un punto único y testeable.

**`liberarFecha()` (UC-31 / US-041) — DELETE serializado, idempotente, exactamente-una-vez:** elimina la fila `(tenant_id, fecha)` de `FECHA_BLOQUEADA` vía `$executeRaw` dentro de `$transaction` + `SET LOCAL app.tenant_id` (RLS). Las filas afectadas son la señal canónica: `1` = liberación efectiva → registrar en `AUDIT_LOG` con causa (TTL/descarte/cancelacion) + invocar `PromocionColaPort` si existe cola activa; `0` = éxito silencioso idempotente (fecha ya libre), sin excepción, para que los retries del cron no generen errores. La guarda del bloqueo firme valida en dominio, antes del DELETE, que la `RESERVA` esté en `reserva_cancelada`; si no, rechaza con error tipado y audita el intento. Ante dos liberaciones concurrentes, exactamente una obtiene `rows = 1` y dispara la promoción; la otra obtiene `rows = 0` sin dispararla (exactamente-una-vez). Liberación en lote: N fechas expiradas se procesan en transacciones independientes con fallo aislado. Sin endpoint HTTP propio (D-7 / US-041): el actor de UC-31 es el Sistema; la liberación es efecto de transiciones de estado y del cron de barrido. `PromocionColaPort` es un seam implementado por `PromocionColaPrismaAdapter` (US-018): ejecuta la mecánica A15 completa — promoción FIFO `2d → 2b`, re-bloqueo atómico vía `bloquearFecha()` y reordenación de cola — dentro de **una única transacción**. El **punto de serialización es `SELECT … FOR UPDATE` sobre las RESERVA en `2d`** de `(tenant, fecha)`, no sobre `FECHA_BLOQUEADA` (que ya no existe tras el DELETE post-commit). La guarda "ya promovida" (D-3 del design) cubre idempotencia, doble disparo del cron y coordinación con US-019 (implementada). Sin email al cliente en MVP; alerta interna al gestor dentro de la misma transacción (superficie de notificaciones diferida a US-044). Sin entidad, migración ni endpoint nuevos.

**Mapa canónico fase → (tipo, TTL, modo):** `bloquearFecha()` deriva el tipo de bloqueo y el TTL a partir de la fase de la reserva usando una **tabla de datos declarativa** (no lógica dispersa), leyendo siempre los días de TTL de `TENANT_SETTINGS`. Las fases contempladas son `2.b`, `2.c` (extensión de TTL sin cambiar tipo), `2.v` (hasta día post-visita), `pre_reserva` y `reserva_confirmada` (upgrade a firme, sin TTL). El upgrade de blando a firme es un `UPDATE` del registro existente, nunca `DELETE+INSERT`.

**Defensa en profundidad — check constraints en la BD (US-040, D-3):** además de las validaciones de dominio, el motor impone dos invariantes de coherencia sobre la tabla `fecha_bloqueada`: `chk_firme_sin_ttl` (`tipo_bloqueo = 'firme' ⟹ ttl_expiracion IS NULL`) y `chk_blando_con_ttl` (`tipo_bloqueo = 'blando' ⟹ ttl_expiracion IS NOT NULL`). Añadidos en una migración no destructiva (la `UNIQUE(tenant_id, fecha)` y la RLS ya existían desde US-000).

**Errores de dominio tipados (en español):** `FECHA_YA_BLOQUEADA` (traducción del `P2002` de Prisma por índice de fecha), `FECHA_EN_PASADO` (validación previa a la transacción), `TENANT_MISMATCH`, `EXTENSION_SOBRE_BLOQUEO_FIRME` y `RESERVA_YA_TIENE_BLOQUEO` (por `reserva_id @unique`). El flujo invocante decide qué hacer ante cada error (p. ej. ofrecer cola ante `FECHA_YA_BLOQUEADA`).

**Sin endpoint HTTP propio (D-7):** `bloquearFecha()` es infraestructura de dominio invocada por las transiciones de estado de la reserva (A1/A2/A6/A18). No se expone como endpoint directo porque el bloqueo debe ocurrir en la misma transacción que la transición de estado; un endpoint aislado rompería la atomicidad reserva↔bloqueo.

**US-006 — extensión manual del TTL (prórroga pura sin transición de estado):**

US-006 no es una transición de máquina de estados (no cambia `estado`, `sub_estado`, `tipo_bloqueo` ni `fecha`): es una **prórroga directa del TTL del bloqueo blando** ya existente, aplicable cuando `sub_estado ∈ {2b, 2c, 2v}` O `estado = 'pre_reserva'`.

- **Guarda de precondición declarativa**: `esEstadoConBloqueoBlandoExtensible(estado, subEstado)` — tabla de datos en `maquina-estados.ts` (mismo estilo que `ORIGENES_TRANSICION_*`), no condicionales dispersos. Rechaza `2a`, terminales y `reserva_confirmada` antes de tocar la BD. La condición real en runtime es la presencia de fila blanda vigente en `FECHA_BLOQUEADA` con `ttl_expiracion > ahora`; el predicado de estado es defensa rápida previa.

- **Atomicidad de las tres operaciones**: UPDATE `RESERVA.ttl_expiracion = ttl_actual + N días` + UPDATE `FECHA_BLOQUEADA.ttl_expiracion` al mismo valor + INSERT `AUDIT_LOG accion='actualizar'`, en una única transacción con `SELECT … FOR UPDATE` sobre la fila bloqueante (mismo punto de serialización que US-005/007/008). Un fallo parcial hace rollback completo.

- **Concurrencia frente al barrido de expiración (US-012)**: si la extensión llega antes de que el barrido expire el bloqueo, el barrido ve el TTL ya extendido; si el barrido ya procesó la expiración, la extensión observa `ttl_expiracion < ahora` y se rechaza con `409`. La serialización por `SELECT … FOR UPDATE` garantiza que no hay estados intermedios ni "resurrección" de un bloqueo ya expirado.

- **Reprogramación implícita de recordatorios A3/A4/A5**: al cambiar `ttl_expiracion`, el barrido periódico (§2.5; US-012, pendiente) reevalúa los recordatorios contra el nuevo valor en su siguiente pasada. No se introduce ningún scheduler ni tabla de jobs adicional.

- **Sin migración**: `ttl_expiracion` (RESERVA y FechaBloqueada), `tipo_bloqueo` y `accion = 'actualizar'` en `AUDIT_LOG` existen desde US-000/US-040/US-004.

- **Nuevo endpoint**: `POST /reservas/{id}/extender-bloqueo` body `{ dias: integer ≥ 1 }` — respuestas `200` (TTL extendido), `409` (TTL expirado / sin fila bloqueante activa / bloqueo firme), `422` (estado sin bloqueo extensible o `dias` inválido), `404`/`401`/`403`.

**US-007 — extensiones del núcleo crítico (transición 2.b → 2.c + vaciado de cola A16):**

- **Guarda de origen `{consulta, 2b} → {consulta, 2c}`**: añadida a la tabla declarativa de `maquina-estados.ts` (mismo patrón que `ORIGENES_TRANSICION_ANADIR_FECHA` de US-005). Cualquier origen distinto de `2.b` —incluidos terminales `2.x`/`2.y`/`2.z` (inmutables)— se rechaza antes de entrar en la transacción.

- **Extensión atómica del TTL vía `resolverPlanBloqueo({ fase: '2.c' })`**: reutiliza la primitiva ya modelada (`er-diagram.md §3.16`, fase `2.c` → `accion: 'extend'`, `ttl = ttl_actual + ttl_consulta_dias`). Dentro de la misma transacción, hace `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA` y la **actualiza** (no inserta) al nuevo `ttl_expiracion`. La base es el `ttl_expiracion` actual de la RESERVA, no `now()`.

- **Vaciado atómico de la cola (mecánica A16)**: en la misma transacción, UPDATE masivo de todas las RESERVA con `consulta_bloqueante_id = id de esta RESERVA` y `sub_estado = '2d'` → `sub_estado = '2y'` (terminal), `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`. Si la cola está vacía, el UPDATE afecta a 0 filas sin error. El vaciado es irreversible (`2.y` es terminal). El `SELECT … FOR UPDATE` sobre la fila bloqueante serializa el vaciado frente a operaciones concurrentes de cola (UC-12/UC-13) sobre la misma fecha.

- **Atomicidad de las cuatro operaciones**: `sub_estado` RESERVA + `ttl_expiracion` RESERVA + `ttl_expiracion` `FECHA_BLOQUEADA` + vaciado de cola son all-or-nothing en una única transacción de BD bajo el contexto RLS del tenant. Un fallo parcial hace rollback completo.

- **Auditoría dual**: `AUDIT_LOG` con `accion = 'transicion'` para la RESERVA principal (`2b → 2c`) y para cada RESERVA descartada (`2d → 2y`), en la misma transacción.

- **Sin migración**: sub-estados `2c`/`2y` y campos de cola/TTL (`posicion_cola`, `consulta_bloqueante_id`, `ttl_expiracion`) existen desde US-000/US-040/US-004.

- **Gap de spec D-7**: el email al cliente de UC-06 paso 7 no tiene E-code asignado en §9.3; no se implementa en MVP. Ver UC-06 en `use-cases.md` y `design.md §D-7` del change us-007.

- **Nuevo endpoint**: `POST /reservas/{id}/pendiente-invitados` — respuestas `200` (transición aplicada), `409` (sin fecha bloqueada activa o TTL expirado), `422` (guarda de origen), `404`/`401`/`403`.

**US-018 — promoción automática de cola (cierre del seam PromocionColaPort):**

US-018 completa la mecánica A15 que US-012 dejó como stub no-op. No introduce entidad, migración ni endpoint OpenAPI nuevos; solo sustituye `PromocionColaStubAdapter` por `PromocionColaPrismaAdapter` via re-binding en `reservas.module.ts`.

- **Disparo heredado y congelado:** el punto de disparo (`liberar-fecha.service.ts`, post-commit, exactamente-una-vez) es de US-041 y no se toca. US-018 solo implementa el efecto.

- **Punto de serialización — cerrojo sobre RESERVA `2d`, no sobre `FECHA_BLOQUEADA`:** tras el DELETE de `liberarFecha()` ya no existe la fila de `FECHA_BLOQUEADA`; un `SELECT … FOR UPDATE` sobre 0 filas no serializa nada. El adaptador adquiere el lock sobre las **RESERVA en `sub_estado = '2d'`** de `(tenant, fecha)`, que son el recurso real a coordinar. Esto es la guarda "ya promovida" (D-3): si bajo lock ya no hay `posicion_cola = 1` en `2d`, aborta limpio (idempotencia + coordinación US-019).

- **Transacción única A15:** (1) adquirir lock sobre RESERVA `2d`; (2) aplicar plan de dominio puro `resolverPromocionCola` (tabla declarativa `MAPA_PROMOCION_COLA` en `maquina-estados.ts`, guarda origen estricta `{consulta, 2d} → {consulta, 2b}`); (3) mutar promovida (`sub_estado = '2b'`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`); (4) re-crear `FECHA_BLOQUEADA` vía `bloquearFecha()` (blando, `now() + ttl_consulta_dias`); (5) decrementar `posicion_cola` del resto en orden ascendente (respeta `reserva_cola_posicion_key`) y re-apuntar `consulta_bloqueante_id` a la promovida; (6) `AUDIT_LOG` por RESERVA con `origen: promocion_automatica`; (7) registrar alerta interna al gestor.

- **Notificación (D-5):** alerta interna al gestor dentro de la misma transacción; sin email al cliente ni invocación de US-045. Superficie de notificaciones diferida a US-044.

- **Coordinación con US-019 (D-6):** FIFO estricto + gana el primer lock. La guarda "ya promovida" — bajo `SELECT … FOR UPDATE` sobre RESERVA `2d` (automático) o sobre la fila de `FECHA_BLOQUEADA` (manual, pues la bloqueante aún existe) — es el mecanismo de coordinación entre la promoción automática y la manual. US-018 dejó este contrato; **US-019 (implementada) lo consume**: endpoint `POST /reservas/{id}/promover` con `{ confirmado: true }`, donde `{id}` es la RESERVA en `2d` elegida por el Gestor; al perder la carrera devuelve 409 "La cola ya fue actualizada automáticamente, por favor recarga la vista".

- **`ttl_expiracion` como instante:** `now() + ttl_consulta_dias` (comparación de instantes `timestamptz`; mitiga el off-by-one de TZ — misma decisión que US-012 §D-7).

**US-019 — promoción manual de consulta en cola (`PromoverManualEnColaService`):**

US-019 complementa US-018 permitiendo al Gestor promover deliberadamente una consulta arbitraria de la cola (cualquier `posicion_cola`, no solo la primera). Reutiliza las primitivas de US-018 y US-040/US-041 sin redefinirlas.

- **Locus de lock distinto al de US-018:** en la promoción automática la `FECHA_BLOQUEADA` ya no existe cuando el seam se dispara; en la manual la bloqueante sigue viva, por lo que el `SELECT … FOR UPDATE` se toma sobre la **fila de `FECHA_BLOQUEADA`** (no sobre RESERVA `2d`). Ambas rutas convergen porque `liberarFecha()` también adquiere `FOR UPDATE` sobre esa fila: los dos caminos contienden por el mismo recurso físico.

- **Expiración forzosa de la bloqueante:** a diferencia de US-018 (que parte de una fecha ya liberada), la promoción manual debe primero expirar la bloqueante activa (`sub_estado → '2x'`, `ttl_expiracion → NULL`) dentro de la misma transacción, reutilizando la semántica terminal de US-012.

- **Reordenación por cierre de hueco:** cuando se promueve la posición `P`, las RESERVA con `posicion_cola > P` decrementan 1 (cierre del hueco); las de `posicion_cola < P` conservan su posición pero actualizan `consulta_bloqueante_id` a la promovida. Generaliza el decremento uniforme de US-018 (que equivale al caso `P = 1`).

- **Endpoint:** `POST /reservas/{id}/promover` con body `{ confirmado: true }` (el `{id}` es la RESERVA en `2d` a promover). Rol requerido: Gestor. Respuestas: 200, 403, 404, 409 (carrera perdida), 422 (guarda de origen).

- **Política de arbitraje (US-018 §D-6, respetada sin cambio):** FIFO estricto + "gana quien toma el lock primero". El sistema NO cede prioridad al Gestor. Si el automático toma el lock primero, la acción manual recibe 409 "La cola ya fue actualizada automáticamente, por favor recarga la vista".

- **Sin migración de esquema:** US-019 no añade entidades ni columnas; reutiliza `RESERVA` (`posicion_cola`, `consulta_bloqueante_id`, `sub_estado`, `ttl_expiracion`), `FECHA_BLOQUEADA` y `AUDIT_LOG` tal como existen desde US-000/US-004.

- **AUDIT_LOG:** `accion='transicion'`, `entidad='RESERVA'` por cada RESERVA modificada (bloqueante expirada, promovida, reordenadas), con `datos_nuevos.origen: 'promocion_manual'` y `usuario_id` del Gestor.

**US-004 — extensiones del núcleo crítico (alta de consulta con fecha):**

- **`bloquearEnTx(tx, …)`**: `FechaBloqueadaPrismaAdapter` se refactorizó extrayendo el INSERT transaccional (`SELECT FOR UPDATE` + P2002) a un método que acepta el `tx` de la UoW del alta. El método público `bloquear()` (US-040) queda como wrapper sin cambio de contrato externo. Esto permite que `RESERVA 2b + FECHA_BLOQUEADA` se creen en una única transacción all-or-nothing. Fuente: `design.md §D-2`.

- **`determinarAltaConFecha(estadoFecha)`**: función declarativa en `maquina-estados.ts` — tabla de datos, no condicionales dispersos — que mapea el estado de disponibilidad de la fecha a `{ subEstado, accion }`: `libre → 2b/bloquear`, `bloqueada-por-2b → 2d/encolar`, `bloqueada-por-2c|2v|pre|conf+ → 2a/exploratoria`. Las entradas iniciales `2b` y `2d` se añadieron a `ENTRADAS_INICIALES`. Se evalúa **dentro del cuerpo transaccional reintentado** para garantizar que ante una colisión D4 el reintento re-derive el sub-estado con el estado ya actualizado. Fuente: `design.md §D-3`, `design.md §D-6`.

- **`TarifaEstimadaPort`**: nuevo puerto de dominio en `reservas/domain/` que envuelve `CalculadoraTarifaService.calcular()` (US-016). Tolerante a errores: si el cálculo no es posible (`TEMPORADA_NO_CONFIGURADA`, `TARIFA_NO_CONFIGURADA`, `tarifa_a_consultar = true`), E1 sale con el dossier general sin precio sin bloquear el alta. La tarifa no se persiste en `RESERVA`. Fuente: `design.md §D-4`.

- **Concurrencia D4 y serialización de cola**: ante colisión `UNIQUE(tenant_id, fecha)` (`P2002`), la UoW reabre la transacción y re-deriva el sub-estado con `determinarAltaConFecha`. La `posicion_cola` se serializa con `SELECT … FOR UPDATE` sobre la fila bloqueante (D-5). Defensa adicional: índice UNIQUE parcial `reserva_cola_posicion_key` (migración aditiva D-8, aprobada en Gate 1). Fuente: `design.md §D-5`, `design.md §D-6`.

- **Divergencia intencional — regla de fecha (Gate 1, decisión A):** `fecha_evento > hoy` (estrictamente futura) para toda creación con fecha, unificando con `validarFechaFutura` (US-040) y el motor de tarifa. La ficha US-004 admitía `≥ hoy`; la divergencia fue aprobada por el humano. El servidor rechaza `fecha_evento = hoy` y fechas pasadas con **400** sin crear registros. Fuente: `design.md §D-1`.

### 2.5 Procesos asíncronos sin infraestructura serverless

Los TTLs no se implementan con timers que disparan en el instante exacto, sino con el patrón **estado en la fila + barrido periódico**: cada reserva con bloqueo lleva `ttl_expiracion`; un cron invoca cada N minutos un endpoint protegido que barre las filas vencidas, las libera y dispara las promociones de cola. Si el cron se retrasa o cae, no hay pérdida de consistencia: al volver a ejecutarse barre lo pendiente. Es idempotente y trivial de testear (se llama a la función de barrido con una fecha simulada). Sustituye a Lambda + EventBridge sin perder corrección.

**US-012 — barrido de expiración por TTL (implementado):** el primer barrido concreto materializado es `POST /cron/barrido-expiracion`, que gestiona la expiración de consultas y pre-reservas con TTL agotado. La autenticación es **service-to-service** mediante la cabecera `X-Cron-Token` (validada por `CronTokenGuard` contra `CRON_TOKEN` del entorno), independiente del JWT de usuario. La lectura de candidatas es **cross-tenant** (único punto legítimo del proceso de Sistema); cada mutación opera bajo `SET LOCAL app.tenant_id` de la RESERVA candidata (defensa en profundidad + RLS). Ver §2.12 para la arquitectura interna de este módulo.

**US-026 — barrido de cierre automático de ficha operativa en T-1d / automatización A10 (implementado):** el segundo barrido periódico concreto es `POST /cron/barrido?tarea=fichas` (Opción A aprobada en Gate: endpoint genérico compartido con `tarea` como discriminador). Misma autenticación `X-Cron-Token` / `CronTokenGuard` que US-012; **nunca JWT de usuario**. Se ejecuta en un cron `@nestjs/schedule` diario a las 01:00. Selecciona RESERVA con `estado = 'reserva_confirmada'` AND `pre_evento_status != 'cerrado'` AND `date(fecha_evento) = date(hoy) + 1 día` (comparación estricta por fecha de calendario, no por string formateado — blindaje del off-by-one de TZ, decisión D-4). La selección es **cross-tenant** (mismo patrón que US-012); cada mutación opera bajo `SET LOCAL app.tenant_id` de la RESERVA candidata (RLS). Por cada candidata, en su **propia transacción** con `SELECT … FOR UPDATE` + re-evaluación de la guarda dentro de la TX (idempotencia + coordinación con el cierre manual US-025, serialización C-2): fija `FICHA_OPERATIVA.ficha_cerrada = true` + `fecha_cierre = now()`, transiciona `RESERVA.pre_evento_status → cerrado`, y registra `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`, `usuario_id = NULL` (origen Sistema), `causa = 'A10'`. Fallo aislado por RESERVA (rollback individual sin interrumpir el lote). Resumen de respuesta: `{ fichas: { candidatas, fichasCerradas, fallos } }` (bajo clave `fichas` en `BarridoResponse`). Sin email ni resumen al cliente de A10 en este change. Reutiliza la mutación de cierre de US-025 y el patrón cron de US-012. Sin migración de esquema (`ficha_cerrada`, `fecha_cierre`, `pre_evento_status` ya existían). La coordinación de concurrencia cierre manual (US-025) vs automático se resuelve porque el UoW de cierre manual de US-025 se endureció con `SELECT … FOR UPDATE` + re-evaluación: ambos caminos serializan por fila de RESERVA.

**US-031 — barrido de inicio automático de evento en T-0 / UC-23 flujo básico (implementado):** el tercer barrido periódico concreto es `POST /cron/barrido-eventos` (Opción B, endpoint dedicado — gemelo de `POST /cron/barrido-expiracion` de US-012, en el mismo módulo `reservas`). La Opción A (reutilizar `POST /cron/barrido?tarea=eventos`) se descartó porque el dispatch por `?tarea=` nunca se implementó y añadir un segundo controller sobre la misma ruta habría colisionado con el barrido de US-026 ya mergeado. Misma autenticación `X-Cron-Token` / `CronTokenGuard` que US-012 y US-026; **nunca JWT de usuario**. Se ejecuta en un cron `@nestjs/schedule` diario a las 00:00 (expresión `0 0 * * *`; configurable mediante la variable de entorno `CRON_BARRIDO_EVENTOS`). Selecciona RESERVA con `estado = 'reserva_confirmada'` AND `date(fecha_evento) = CURRENT_DATE` (día T-0; comparación estricta por fecha de calendario, no por string formateado — mismo blindaje del off-by-one de TZ que US-026). La selección es **cross-tenant** (mismo patrón que US-012/US-026); cada mutación opera bajo `SET LOCAL app.tenant_id` de la RESERVA candidata (RLS). Por cada candidata, en su **propia transacción** con `SELECT … FOR UPDATE` + re-evaluación de la guarda de origen (`reserva_confirmada → evento_en_curso`, tabla declarativa `MAPA_INICIO_EVENTO` en `maquina-estados.ts`) + re-evaluación de las **tres precondiciones** (`pre_evento_status = 'cerrado'` AND `liquidacion_status = 'cobrada'` AND `fianza_status = 'cobrada'`) dentro del lock: si las tres se cumplen → transiciona a `evento_en_curso` + `AUDIT_LOG` origen Sistema; si alguna falta → no transiciona + alerta crítica al gestor con la lista de precondiciones incumplidas (el forzado manual corresponde a US-032). Si `cond_part_firmadas = false` en el día del evento: alerta no bloqueante A29 con independencia del resultado de la transición. Fallo aislado por RESERVA (rollback individual sin interrumpir el lote). Idempotencia garantizada: reservas ya en `evento_en_curso` no son candidatas (el filtro `estado = 'reserva_confirmada'` las excluye); la re-evaluación bajo el lock protege también frente al cron↔gestor (US-032) concurrentes — exactamente uno gana, la UPDATE de la segunda operación afecta 0 filas y termina como no-op. Resumen de respuesta: `BarridoEventosResponse { candidatas, eventosIniciados, precondicionesIncumplidas, fallos }`. Sin email ni briefing al equipo en este change (briefing 📐 diseñado pero fuera del MVP; ver D-9 del design). Sin migración de esquema: `evento_en_curso` ya existía en el enum `RESERVA.estado`; `pre_evento_status`, `liquidacion_status`, `fianza_status` y `cond_part_firmadas` preexisten desde US-000/US-025/US-029/US-030. La **vista móvil "evento en curso"** y su checklist de documentación corresponden a **US-033/US-034**, que consumen el `RESERVA.estado = evento_en_curso` establecido por este barrido. La coordinación con el **forzado manual** es responsabilidad de **US-032**.

> **Nota de hosting:** en plataformas con proceso always-on (p. ej. Railway), el cron es trivial. En tiers gratuitos que duermen el servicio tras inactividad (p. ej. Render free), el barrido necesita un disparador externo que despierte el endpoint. Ver §5.

### 2.6 Organización interna del backend (capas + hexagonal + DDD)

```
apps/
  web/                      Frontend SPA (Vite + React)
  api/                      Backend NestJS
    src/
      <modulo>/             p. ej. reservas/, tarifas/, facturacion/, presupuestos/, comunicaciones/
        domain/             Entidades, objetos de valor, eventos de dominio, PUERTOS (interfaces)
        application/        Casos de uso (orquestan el dominio)
        infrastructure/     ADAPTADORES: Prisma, email, PDF, storage
        interface/          Controladores HTTP + documentación OpenAPI
```

- **Regla de dependencia hexagonal:** `domain` no importa nada de `infrastructure` ni de frameworks; depende sólo de sus propios puertos. Los adaptadores de `infrastructure` implementan esos puertos. Esto hace el dominio testeable de forma aislada (TDD).
- **Organización por módulos de dominio** (no por capas técnicas globales), alineada con M1–M12 de la especificación. Un módulo llama a otro sólo a través de su interfaz pública.

### 2.7 Cómo la arquitectura sirve a SDD + TDD asistido por IA

- **Type-safety end-to-end** (TS en front y back + OpenAPI + Prisma): la IA no puede generar código que viole el contrato sin que el compilador lo detecte.
- **Orden TDD impuesto por la arquitectura:** lo primero que se escribe son los tests de concurrencia del núcleo crítico (bloqueo atómico bajo transacciones simultáneas, promoción de cola, encadenamiento, salida de cola concurrente — edge cases #19, #20 de la especificación), antes que UI o CRUD.
- **Máquina de estados declarativa:** las specs SDD se traducen casi 1:1 a la tabla de transiciones y a sus tests.
- **Módulos acotados:** la IA recibe el contexto de un módulo sin necesitar todo el sistema.

### 2.8 Autenticación y modelo de usuarios

**Mecanismo: JWT con patrón access token + refresh token.** Se elige JWT (frente a sesión de servidor con cookie) tanto por encajar con la SPA cross-origin sin depender de cookies de sesión cross-site para las peticiones de API, como por su valor formativo. La seguridad no depende de "ocultar" el token —el payload de un JWT es legible por diseño; lo que lo protege es la firma del servidor— sino de **dónde se guarda cada token y cuánto vive**:

- **Access token** (JWT firmado): vida corta (~15 min). Se guarda **en memoria de la SPA** (estado de la aplicación), nunca en `localStorage` ni `sessionStorage`. Viaja en la cabecera `Authorization: Bearer`. Si un ataque XSS lo robara, solo serviría unos minutos.
- **Refresh token**: vida larga (~7 días). Se guarda en una **cookie httpOnly + Secure + SameSite**, que el JavaScript de la página **no puede leer**, lo que lo protege de XSS. Solo sirve para llamar a `/auth/refresh` y obtener un nuevo access token cuando el anterior caduca.
- **Prohibido:** guardar cualquier token en `localStorage`. Es la causa más común de robo de token por XSS, y no existe ningún "enmascaramiento" que lo mitigue.

**Tenant y rol en el token:** el `tenant_id` y el `rol` del usuario se incluyen en el payload firmado del access token. El backend los lee en cada petición para alimentar el aislamiento multi-tenant (RLS) y la autorización. Al ir firmados, el cliente no puede manipularlos.

**Implementación (US-001 y US-002, completadas):** El módulo `auth` aplica arquitectura hexagonal bajo `apps/api/src/auth/`:

- **domain/**: entidad `Usuario` (sin contraseña en claro), invariante `activo`.
- **application/**: `login.use-case.ts`, `refresh.use-case.ts`, `logout.use-case.ts`, `obtener-usuario-actual.use-case.ts`. Los **puertos** (`UsuarioRepositoryPort`, `PasswordHasherPort`, `TokenEmitterPort`) viven consolidados en esta capa junto a los casos de uso; no importan `@nestjs/*` ni Prisma. La inversión de dependencias se mantiene: la infraestructura implementa los puertos y `auth.module.ts` los enlaza por Symbol vía factory.
- **infrastructure/**: `usuario.prisma.adapter.ts` (Prisma), `argon2-password-hasher.adapter.ts` (argon2, coherente con el seed), `jwt-token-emitter.adapter.ts` (`@nestjs/jwt`).
- **interface/**: `auth.controller.ts` — `POST /auth/login` (ruta pública, `@Public`), `POST /auth/refresh`, `POST /auth/logout` (ver abajo), `GET /auth/me` (resuelve el usuario real desde BD, ya no devuelve solo el payload del JWT). La cookie de refresh se setea y limpia íntegramente en esta capa (framework); el dominio no la toca.

  **`POST /auth/logout` (US-002):** marcado `@Public()` (cookie opcional). Comportamiento idempotente: si el refresh token identifica a un usuario, registra `AUDIT_LOG` con `accion = logout`, `entidad = 'Usuario'`, `entidad_id = usuario_id`; si el token es ausente/expirado/inválido, responde igualmente 200/204 sin auditar. El endpoint es **no anónimo** (actúa solo sobre la cookie propia; no acepta `usuario_id` de destino) y **nunca devuelve 401**. El access token no se revoca activamente; caduca por TTL (~15 min). La invalidación stateful del refresh queda como deuda post-MVP (DT-AUTH-01).

El guard `JwtAuthGuard` y la estrategia `jwt` de Passport se reutilizan del scaffolding de US-000A (`shared/auth/`). Contraseñas verificadas con **argon2** (nunca bcrypt). `buscarPorEmail` es una consulta pre-autenticación: el email es único globalmente; el `tenant_id` se fija en contexto RLS **tras** autenticar.

**Anti-enumeration (OWASP A01):** el dominio lanza un único `CredencialesInvalidasError` para los tres casos de fallo — email inexistente, contraseña incorrecta, `activo=false` —; el controlador lo traduce siempre a **401 genérico uniforme** (`"Credenciales incorrectas"`) con el mismo body y status. Los intentos fallidos de login **no se registran en `AUDIT_LOG`**; solo los logins exitosos generan un registro `login`.

**Protección brute-force — throttler self-contained:** `LoginThrottleGuard` implementado con `Map` en memoria del proceso, clave `IP+email` normalizada, ventana **5 intentos / 60 s** → responde **429** genérico (no revela si el email existe). No usa `@nestjs/throttler` ni Redis. Adecuado para el MVP de instancia única; ver §2.9 DT-AUTH-03 para la deuda de migración.

**Cookie del refresh token:** `httpOnly: true`; `secure: true` + `sameSite: 'none'` en producción; `sameSite: 'lax'` en desarrollo. `path: '/api/auth'`, `maxAge` ~7 días. El frontend no puede leerla desde JavaScript.

**Puerto compartido de auditoría (`AuditLogPort`):** extraído a `shared/audit/audit-log.port.ts` (interfaz pura, sin NestJS ni Prisma). Los módulos `auth` y `reservas` la comparten: `auth` usa el adaptador genérico `shared/audit/audit-log.prisma.adapter.ts`; `reservas` conserva su adaptador especializado con tipos estrechados (`RegistroAuditoriaLiberacion extends RegistroAuditoria`). Sin duplicación de interfaz ni ruptura de comportamiento en US-040/US-041.

**Modelo de usuarios y los dos niveles de administración.** Conceptualmente, un SaaS multi-tenant tiene dos figuras de administración distintas:

| Nivel | Quién es | Qué hace | Alcance |
|---|---|---|---|
| **Admin de plataforma** | El operador del producto (Slotify como empresa) | Da de alta tenants, gestiona la facturación del SaaS | Cruza todos los tenants |
| **Admin de tenant** | El propietario de un espacio (p. ej. propietario de Masia l'Encís) | Crea y gestiona los usuarios de SU tenant (gestores, operarios), configura su tarifario | Un solo tenant |
| **Gestor / operario** | Personal del espacio | Opera reservas, presupuestos, facturas | Un solo tenant |

**En el MVP estos roles se colapsan:** como solo hay **un usuario por tenant (el gestor)**, no existe la necesidad de que un admin de tenant cree otros usuarios. El gestor único se aprovisiona por **seed/script** al crear el tenant; no se construye UI de gestión de usuarios, invitaciones ni roles múltiples. El campo `rol` permanece en la tabla `USUARIO` (el modelo es multi-tenant desde el día 1), pero en el MVP todos los usuarios reales tienen `rol = gestor`. La creación de usuarios por un admin de tenant y la administración de plataforma quedan **fuera del alcance del MVP** (post-TFM).

**Convención de layouts de la SPA (implementada en US-000A):** la SPA divide el árbol de rutas en dos ramas independientes. La rama protegida envuelve todas las pantallas autenticadas en el `AppShell` (sidebar 288px + header + `<Outlet/>`), precedida por el guard `RequireAuth` que redirige a `/login` preservando la ruta solicitada y vuelve a ella tras autenticar. La rama de autenticación (`/login`) tiene su propio layout y no hereda el chrome del shell. Esta separación garantiza que ninguna pantalla autenticada futura necesite redefinir navegación; se monta directamente como ruta hija dentro del árbol protegido.

**Cierre de sesión en el shell (US-002):** el `AppShell` incluye el botón "Cerrar sesión" en el pie del sidebar (escritorio, `lg:`) y dentro del drawer de navegación (móvil, `<lg`), conforme a la regla dura responsive mobile-first. Al activarlo: llama a `POST /auth/logout` (SDK generado), limpia el access token y la sesión de memoria (`session.tsx`) y redirige a `/login`. Ante error de red, limpia igualmente la sesión y muestra un aviso persistente en `/login` (modo degradado aceptable en MVP: el refresh token en cookie caduca por TTL ~7 días).

### 2.9 Deuda técnica y decisiones diferidas

Esta sección registra las decisiones tomadas conscientemente como deuda en US-001. Cada entrada lleva el fundamento y el punto de cierre previsto. El responsable de cada deuda técnica es el agente/US que la cierra.

| ID | Deuda / Decisión diferida | Contexto | Cuándo se cierra |
|---|---|---|---|
| DT-AUTH-01 | **Refresh stateless — sin revocación real (deuda post-MVP).** El `POST /auth/logout` limpia la cookie y audita la sesión del dispositivo actual, pero no invalida criptográficamente el refresh token en el servidor: un token ya emitido sigue siendo válido hasta su TTL (~7 días). El riesgo se acota por la cookie `httpOnly` (no robable por XSS) + vida corta del access (~15 min). US-002 ratificó este enfoque best-effort: añadió auditoría e idempotencia sin adoptar refresh stateful. La invalidación real (modelo `SesionRefresh` / denylist de `jti` en Prisma + verificación en `/auth/refresh`) queda diseñada y diferida. | Decisiones §1-A de US-001 y US-002 (`proposal.md` de ambos changes) | Post-MVP / sprint auth-completo cuando se necesite global logout o revocación real del refresh |
| DT-AUTH-02 | **Multi-device FA-03 diferido.** Las sesiones en múltiples dispositivos coexisten en silencio; no existe flujo interactivo ("continuar / cerrar sesión anterior"). El flujo completo requiere registro de sesiones activas, que depende de DT-AUTH-01 (refresh stateful). | Decisión §4 del change US-001 (`proposal.md`) | Cuando se adopte el refresh stateful |
| DT-AUTH-03 | **Throttler en memoria por proceso.** `LoginThrottleGuard` usa un `Map` en memoria del proceso: los contadores no se comparten entre instancias y se reinician al rearrancar el proceso. Aceptado para el MVP de instancia única (Railway). Antes de cualquier despliegue multi-instancia debe migrarse a una solución compartida (Redis, BD o `@nestjs/throttler` con store distribuido). | Decisión §3 del change US-001; nota de escalabilidad del code-review | Antes de despliegue multi-instancia |
| DT-AUTH-04 | **SDK del frontend genera `.d.ts` en lugar de `.ts`.** La configuración actual de `resolve.extensions` incluye `.d.ts`, lo que hace que el cliente generado sea un archivo de tipos, no un módulo importable directamente. Requiere workaround en el build del frontend. La corrección pasa por ajustar la config de codegen del `contract-engineer`. | Nota de codegen del code-review | Próxima iteración de codegen del `contract-engineer` |
| DT-EMAIL-01 | **Adaptador de email stub (no-op) — RESUELTA.** El `EnviarEmailStubAdapter` se sustituye en US-045 por `ResendEmailAdapter` (producción) y `FakeEmailAdapter` (test/CI/dev, forzado). El motor `DespacharEmailService` centraliza render + envío + actualización de estado. `AltaConsultaUseCase` delega el envío post-commit en `DespacharEmailService.finalizarEnvio`: la `COMUNICACION` E1 nace en `borrador` dentro de la `$transaction` del alta y el motor la promueve a `enviado`+`fecha_envio` (éxito) o a `fallido`+AUDIT_LOG (fallo del proveedor), sin reintento y sin tumbar el HTTP 201. Regresión cero sobre US-003/004 (contrato del puerto `EnviarEmailPort` intacto, campos nuevos solo opcionales). | US-045 (28/06/2026). Cierre: motor hexagonal + Resend + FakeEmailAdapter en test/CI + cableado real de E1. | RESUELTA — US-045 (28/06/2026) |
| DT-EMAIL-02 | **Cableado de triggers E2–E8 diferido a sus US.** El catálogo de plantillas declara E2–E8 como entradas diseñadas/inactivas (variables, adjuntos y metadatos declarados, sin render activo) pero sin trigger cableado. Mapa de deuda actualizado: **E2 → RESUELTA — US-014** (trigger cableado en `POST /reservas/{id}/presupuesto`; activado post-commit de la transición `{2a,2b,2c,2v} → pre_reserva`; PDF adjunto por referencia a `PRESUPUESTO.pdf_url`; idempotencia garantizada por índice UNIQUE parcial de US-045). **E6 → RESUELTA — US-008** (trigger cableado en `POST /reservas/{id}/visita`; activado post-commit de la transición `{2a,2b,2c} → 2v`). **E7 → RESUELTA — US-009** (trigger cableado en `PATCH /reservas/{id}/visita`; activado post-commit de la transición `2v → 2b` "cliente interesado"; confirmación de bloqueo post-visita con TTL fresco). **E3 — avance US-022 (04/07/2026):** US-022 implementa la generación y aprobación de la factura de señal (prerequisito de E3), pero el trigger de E3 no se cablea en este change — se cablea en US-023 (condiciones particulares), que es el trigger natural de E3 (`reserva_confirmada` + factura aprobada + condiciones generadas). **E4 → RESUELTA — US-028 (04/07/2026):** trigger cableado en `AprobarYEnviarLiquidacionUseCase` (`POST /reservas/{id}/facturas/liquidacion/aprobar-enviar`); modo síncrono confirmado (D-1: excepción al post-commit; rollback total si E4 falla); PDFs de liquidación y fianza adjuntos por referencia a `pdf_url`; `COMUNICACION E4` con `es_reenvio = false` para envío original y `es_reenvio = true` para reenvíos manuales (`POST /reservas/{id}/facturas/liquidacion/reenviar`). Pendientes: E3→US-023, E5→US-034 (`post_evento` con `fianza_eur > 0`), E8→US-035 (`iban_devolucion` registrado). Adjuntos PDF reales (factura/documento) y cron de recordatorios también diferidos. Envío manual de borradores: US-046. | Decisión de alcance del Gate SDD de US-045: el cableado de E2–E8 requiere triggers, PDFs y estados de US aún no implementadas; construirlos ahora sería spec especulativa. El motor ya está listo para recibirlos sin rediseño. | E2: RESUELTA — US-014 (03/07/2026). E6: RESUELTA — US-008 (30/06/2026). E7: RESUELTA — US-009 (03/07/2026). E3: avance US-022 (04/07/2026) → cierre pendiente US-023. **E4: RESUELTA — US-028 (04/07/2026).** E5, E8: cada US de trigger listada + US-046 |
| Bj3 | **Default inseguro de `EMAIL_SANDBOX` — RESUELTA.** Antes, si `EMAIL_SANDBOX` no estaba seteada, el sistema podía enviar emails reales (unset → `false`). Ahora el default es SEGURO con doble barrera: (1) validación zod en `env.validation.ts` — unset → `undefined !== 'false'` → `true` (sandbox activo); (2) cableado en `comunicaciones.module.ts` — trata como envío real solo el `false`/`'false'` explícito. Con `sandbox=true`, `resend.email.adapter.ts` reescribe el destinatario a `delivered@resend.dev`. El opt-in al envío real exige `EMAIL_SANDBOX=false` explícito en el entorno; cualquier otro valor, incluido unset, mantiene el sandbox activo. Cobertura: 3 tests nuevos en `env.validation.spec.ts` (unset→true, 'true'→true, 'false'→false). | Code-review de US-045, segunda pasada (29/06/2026). Detectada como deuda operativa de seguridad (baja→operativa). | RESUELTA — US-045 fix Bj3 (29/06/2026) |
| DT-CODIGO-01 | **Generación de `codigo` no atómica (count+1) — RESUELTA.** La implementación inicial generaba el correlativo `YY-NNNN` con `count(*)+1` dentro de la transacción: dos altas concurrentes podían leer el mismo recuento y colisionar en el índice `reserva_codigo_key`. Resuelto con **retry-on-conflict** en `UnidadDeTrabajoPrismaAdapter.ejecutar()` (hasta 3 reintentos): ante `P2002` sobre `reserva_codigo_key`, el adaptador reabre la `$transaction` y reintenta; el siguiente intento re-lee el `count` con el ganador ya confirmado. El índice UNIQUE permanece como red de seguridad final. Conexo: el controlador ya no enmascara errores como 500; cualquier `P2002` no capturado por el caso de uso se propaga al `HttpExceptionFilter` global → 409. | Code-review de US-003 (señalado como tolerable para MVP; corregido en los fixes finales de US-003) | RESUELTA — US-003 fixes finales (28/06/2026) |

### 2.10 Módulo M10 Comunicaciones: motor de email automático (US-045)

El módulo `comunicaciones` implementa un **motor de email hexagonal reutilizable** que sirve a todos los triggers del ciclo de vida de la reserva (E1–E8). **E1** está cableado en US-045; **E2** se activó en US-014 (post-commit de la transición a `pre_reserva`, PDF adjunto); **E6** se activó en US-008 (post-commit de la transición a `2.v`); **E7** se activó en US-009 (post-commit de la transición `2v → 2b` "cliente interesado", confirmación de bloqueo post-visita); **E3** avanza en US-022 (la factura de señal como prerequisito ya está implementada) pero su cableado se completa en US-023 (condiciones particulares); E4, E5, E8 se activarán en sus US respectivas (ver DT-EMAIL-02 en §2.9).

#### Arquitectura interna del módulo

```
apps/api/src/comunicaciones/
  domain/
    enviar-email.port.ts            Puerto de envío (interfaz pura — sin NestJS ni Resend)
    catalogo-plantillas.port.ts     Puerto del catálogo de plantillas
    comunicacion-duplicada.error.ts Error tipado de idempotencia
  application/
    despachar-email.service.ts      Motor principal: render → envío → actualización estado
  infrastructure/
    resend.email.adapter.ts         Adaptador real (Resend SDK, solo producción)
    fake.email.adapter.ts           Adaptador en memoria (test/CI/dev — sin red)
    comunicacion.prisma.repository.ts  Repositorio con RLS (buscarPorReservaYCodigo, actualizarEstado)
    plantillas/                     Catálogo tipado en código: E1 activa, E2–E8 diseñadas/inactivas
  comunicaciones.module.ts          Re-binding ENVIAR_EMAIL_PORT por useFactory según EMAIL_TRANSPORT
```

**Regla de dependencia:** `domain` no importa `infrastructure` ni SDK de Resend. Cambiar de Resend a Postmark = nuevo adaptador sin tocar dominio ni aplicación.

#### Flujo del motor (`DespacharEmailService`)

El método `finalizarEnvio(comunicacionId)` / `enviarYFinalizar(trigger)` orquesta:

1. Seleccionar plantilla por `codigo_email` + idioma (`TENANT_SETTINGS.idioma`, default `es`; fallback a `es` con AUDIT_LOG si falta la plantilla en el idioma del tenant).
2. Sustituir variables con datos de `RESERVA` y `CLIENTE`. Si un campo requerido es nulo: no envía, no crea `COMUNICACION` con `estado='enviado'`, registra en AUDIT_LOG.
3. Resolver adjuntos por referencia (`pdf_url` de `FACTURA`/`DOCUMENTO`/`PRESUPUESTO`); si el adjunto declarado no está disponible: no envía, registra error.
4. Invocar el puerto `EnviarEmailPort.enviar(...)`.
5. Actualizar `COMUNICACION`:
   - Éxito del proveedor → `estado='enviado'` + `fecha_envio = now()`.
   - Fallo del proveedor → `estado='fallido'` sin `fecha_envio` + AUDIT_LOG. Sin reintento en MVP.
6. El camino de éxito y fallo queda **centralizado** en el motor; el use-case invocante (p. ej. `AltaConsultaUseCase`) no contiene lógica de manejo de fallo de proveedor.

#### Integración con el alta de consulta (E1 real, cierre DT-EMAIL-01)

`AltaConsultaUseCase` (US-003/004) funciona así tras US-045:

- **Dentro de la `$transaction`:** crea `RESERVA`, `CLIENTE` y `COMUNICACION` E1 con `estado='borrador'` (estado no final, sin `fecha_envio`). La transacción garantiza que la `COMUNICACION` nace siempre, incluso si el envío falla después.
- **Post-commit (sin comentarios):** delega en `DespacharEmailService.finalizarEnvio` → promueve a `enviado` + `fecha_envio`.
- **Post-commit (con comentarios):** no llama al motor; la `COMUNICACION` permanece en `borrador` hasta revisión manual (UC-36 / US-046).
- **Si el proveedor falla:** motor actualiza a `fallido` + AUDIT_LOG; la respuesta HTTP es **201** igualmente (fallo de email no revierte la reserva).

#### Catálogo de plantillas e i18n

- **Ubicación:** `comunicaciones/infrastructure/plantillas/` — registro de infraestructura tipado en código (arrow functions; sin motor de plantillas externo).
- **Contrato del puerto `CatalogoPlantillasPort`:** `seleccionar(codigoEmail, idioma) → { asunto, render(variables): { cuerpoHtml, cuerpoTexto } }`.
- **E1:** activa con render real en `es` (MVP). Variables: `CLIENTE.nombre`, `RESERVA.codigo`, `TENANT.nombre`, `RESERVA.fecha_evento`.
- **E2–E8:** declaradas como diseñadas/inactivas (metadatos + variables requeridas + adjuntos documentados; sin render activo; sin trigger cableado).
- **i18n:** fallback a `es` si el tenant usa otro idioma no disponible; se registra en AUDIT_LOG.

#### Variables de entorno (validadas con zod en `config/env.validation.ts`)

| Variable | Tipo | Reglas |
|---|---|---|
| `EMAIL_TRANSPORT` | `resend` \| `fake` | Default `fake`; **en producción se exige `resend`** |
| `RESEND_API_KEY` | string | Requerida solo si `EMAIL_TRANSPORT=resend` (validación condicional con `superRefine`) |
| `EMAIL_FROM` | string | Remitente verificado (`no-reply@<dominio>`); requerido si `EMAIL_TRANSPORT=resend` |
| `EMAIL_SANDBOX` | boolean | **Default SEGURO: unset → sandbox activo** (no se envían correos reales). Solo `EMAIL_SANDBOX=false` explícito habilita el envío real. Si `true` o ausente, el adaptador real reescribe el destinatario a `delivered@resend.dev` (Resend test address) |

#### Idempotencia y migración de BD

El motor garantiza **una `COMUNICACION` por `(reserva_id, codigo_email)`** con dos mecanismos complementarios:

1. **Consulta previa en transacción:** `buscarPorReservaYCodigo(reservaId, codigoEmail)` antes de insertar; si existe, no duplica.
2. **Red de seguridad en BD:** índice UNIQUE parcial `comunicacion (reserva_id, codigo_email) WHERE reserva_id IS NOT NULL` (migración `20260628120000_us045_comunicacion_idempotencia_indice`). Parcial porque `reserva_id` es nullable (emails `manual` sin reserva no aplican el constraint). Ante violación del UNIQUE, el motor traduce el error a `ComunicacionDuplicadaError` (no a 500).

### 2.11 Módulo M2 Calendario: vista de disponibilidad de lectura agregada (US-039)

El módulo `calendario` entrega la **primera vista funcional del App Shell** como página de inicio tras el login (UC-29 / US-039). Es una **vista de lectura pura**: no muta `RESERVA` ni `FECHA_BLOQUEADA`; agrega el estado de ocupación del tenant sobre el rango de fechas solicitado.

#### Endpoint

`GET /calendario` — query params `desde` (date), `hasta` (date), `vista` (`mes`|`semana`|`dia`|`lista`). El rango lo calcula el frontend según la vista y el período activo; el backend solo agrega sobre `[desde, hasta]`. La vista es informativa; el conjunto de datos es el mismo para todas las vistas del mismo rango, lo que garantiza el código de colores idéntico entre vistas.

Respuestas: `200` (`CalendarioResponse`), `401` (sin sesión), `422` (rango inválido).

#### Forma de la respuesta

```jsonc
{
  "rango": { "desde": "2026-06-01", "hasta": "2026-06-30" },
  "fechas": [
    {
      "fecha": "2026-06-12",
      "color": "gris",           // gris|ambar|verde|azul|rojo
      "estado": "consulta",
      "subEstado": "2b",
      "reservaId": "uuid",
      "cliente": "Ana García",
      "ttlRestante": "2 días",   // null si no aplica (bloqueo firme / histórica)
      "enCola": 2                // conteo reservas en 2d; 0 si no hay cola
    }
  ]
}
```

Las fechas **libres no aparecen** en `fechas` (la celda neutra es la ausencia de entrada).

#### Arquitectura interna (hexagonal)

```
apps/api/src/calendario/
  domain/
    consultar-calendario.port.ts     Puerto de consulta (interfaz pura — sin NestJS ni Prisma)
    derivar-color.ts                 Función pura de derivación de color (tabla de datos)
  application/
    obtener-calendario.use-case.ts   Agrega fechas ocupadas del rango; calcula enCola
  infrastructure/
    calendario.prisma.adapter.ts     Adaptador Prisma con filtro por tenant_id + RLS
  interface/
    calendario.controller.ts         GET /calendario (DTO de query, mapeo 200/401/422)
  calendario.module.ts
```

**Regla de dependencia:** `domain/` no importa Prisma ni NestJS. La función `derivarColor(estado, subEstado)` es una **tabla de datos declarativa** — el mismo patrón que `determinarAltaConFecha` en `maquina-estados.ts` — que mapea el par `(estado, sub_estado)` al color semántico. Cambiar las reglas de color requiere solo editar la tabla, no lógica dispersa.

#### Derivación del color (SlotifyGeneralSpecs §11.3)

| Estado / sub_estado | Color |
|---|---|
| Consulta activa (`2a`, `2b`, `2c`, `2v`) | `gris` |
| `pre_reserva` | `ambar` |
| `reserva_confirmada`, `evento_en_curso`, `post_evento` | `verde` |
| `reserva_completada` | `azul` |
| `reserva_cancelada` | `rojo` |
| Fecha libre (sin bloqueo activo) | sin color — no aparece en `fechas` |

Sub-estados terminales (`2x`/`2y`/`2z`) no aparecen: su bloqueo en `FECHA_BLOQUEADA` ya fue liberado; `evento_en_curso` y `post_evento` heredan el verde de `reserva_confirmada`.

El color es un **token semántico** cableado por US-000A; el backend emite el nombre lógico (`gris`, `ambar`, `verde`, `azul`, `rojo`) y el frontend mapea al token Tailwind correspondiente — nunca hex inline.

#### Indicador de cola

`enCola = COUNT(RESERVA WHERE sub_estado = '2d' AND consulta_bloqueante_id = <id de la reserva bloqueante>)` calculado en el backend dentro de la misma agregación. El frontend muestra `🔁 N en cola` solo si `enCola ≥ 1`, sobre la celda gris (sin cambiar el color base). El clic en `🔁` navega a la vista de cola (UC-11 / US-017), fuera del alcance de esta US.

#### Multi-tenancy y RLS

La query filtra siempre por `tenant_id` del JWT, reforzado por RLS activo en PostgreSQL (defensa en profundidad). Ninguna fila de otro tenant es alcanzable aunque el filtro de aplicación fallara.

#### Frontend

Feature `apps/web/src/features/calendario/` (Bulletproof React: `api/ components/ lib/ model/ pages/` + barrel `index.ts`). Librería de calendario: **react-big-calendar** (MIT, ligera, soporte de vistas mes/semana/día/lista/agenda). El calendario es la **página de inicio** del slot Calendario del App Shell (sidebar → primera opción). Mobile-first responsive (390/768/1280); la navegación lateral colapsa a drawer en `<lg`. El popover de detalle al clic en una celda con bloqueo activo usa los campos ya presentes en la respuesta agregada — sin segunda llamada a la API.

#### Sin migración de esquema

US-039 no añade ninguna entidad nueva ni modifica columnas: lee `RESERVA` y `FECHA_BLOQUEADA` (ya existentes desde US-000/US-040).

### 2.12 Módulo de barrido de expiración por TTL (US-012 / UC-09)

El módulo `cron` materializa el primer barrido periódico concreto del patrón "estado en fila + barrido periódico" descrito en §2.5. Gestiona la automatización A4/A5/A21/A21b: expira las RESERVA cuyo bloqueo blando ha agotado su TTL, libera la fecha y dispara el seam de promoción de cola.

#### Scheduler y autenticación

- **Disparador:** cron registrado dinámicamente vía `SchedulerRegistry` en `onModuleInit` (no decorador `@Cron` estático). Expresión por defecto `'0 * * * *'` (cada hora); configurable mediante la variable de entorno `CRON_BARRIDO_EXPIRACION`. Si `CRON_TOKEN` no está definido en el entorno, el disparo automático se desactiva (el endpoint sigue disponible para disparo manual o externo). La latencia máxima de liberación de una fecha vencida es ~1 h.
- **Autenticación service-to-service:** cabecera `X-Cron-Token` (no JWT de usuario). El `CronTokenGuard` compara el valor contra `CRON_TOKEN` del entorno; sin token válido responde `401`. El securityScheme `cronToken` está declarado en `api-spec.yml`.
- **Testabilidad:** el endpoint puede invocarse manualmente o por un scheduler externo vía HTTP; no hay lógica de barrido fuera del endpoint.

#### Variables de entorno del módulo cron

| Variable | Tipo | Reglas |
|---|---|---|
| `CRON_TOKEN` | string | Secreto compartido para `X-Cron-Token`. Si está ausente, el disparo automático se desactiva; el endpoint sigue accesible para disparo manual. |
| `CRON_BARRIDO_EXPIRACION` | string (cron expression) | Expresión cron del barrido de expiración. **Default:** `'0 * * * *'` (cada hora). Ejemplos: `'*/15 * * * *'` (cada 15 min), `'0 */2 * * *'` (cada 2 h). |

#### Selección de candidatas (cross-tenant)

La consulta de candidatos es la **única lectura cross-tenant del sistema**: selecciona RESERVA con `ttl_expiracion < now()` AND (`sub_estado ∈ {'2b','2c','2v'}` OR `estado = 'pre_reserva'`), comparando instantes `timestamptz` (nunca fechas formateadas). Es el único punto legítimo donde el proceso de Sistema lee sin filtro de tenant; está documentado y acotado a esta operación de barrido.

#### Procesamiento por RESERVA (transacciones aisladas)

Por cada candidata, en su **propia transacción**, serializada por `SELECT … FOR UPDATE` sobre la fila `FECHA_BLOQUEADA` + `UNIQUE(tenant_id, fecha)`, bajo `SET LOCAL app.tenant_id` de la RESERVA (RLS del tenant candidato):

1. **Mapa declarativo de expiración** (`MAPA_EXPIRACION_TTL` / `resolverExpiracionTtl`): tablas de datos, no condicionales dispersos. Transiciones: `2b/2c/2v → 2x`; `pre_reserva → reserva_cancelada`.
2. **Liberación de fecha** vía `liberarFecha()` (US-041): DELETE idempotente de `FECHA_BLOQUEADA` con causa `TTL`. 0 filas afectadas = éxito silencioso (la fecha ya estaba libre); no lanza excepción.
3. **Auditoría:** `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`.
4. **Seam de promoción de cola:** si la RESERVA tenía cola activa (`2b`/`2v`), dispara `PromocionColaPort` exactamente una vez (exactamente-una-vez garantizado por `liberarFecha()`: solo la transacción con `rows = 1` lo dispara). El adaptador real `PromocionColaPrismaAdapter` (US-018) materializa la mecánica A15: `2d → 2b`, re-bloqueo atómico vía `bloquearFecha()`, reordenación FIFO y alerta interna al gestor, todo en una transacción serializada por `SELECT … FOR UPDATE` sobre RESERVA `2d`. La guarda "ya promovida" cubre idempotencia y coordinación con US-019 (implementada).

**Fallo aislado:** si el procesamiento de una candidata falla (rollback de su propia transacción), el resto del lote continúa sin interrupción. El resumen de respuesta registra el fallo.

**Idempotencia (D-4):** RESERVA ya en estado terminal no son candidatas (la guarda de la consulta las excluye). N ejecuciones sobre la misma RESERVA producen como máximo 1 transición y 1 auditoría.

#### Arquitectura interna (hexagonal)

```
apps/api/src/cron/
  domain/
    expiracion-ttl.port.ts         Puerto de expiración (interfaz pura — sin NestJS ni Prisma)
    mapa-expiracion-ttl.ts         Tabla declarativa: sub_estado/estado → estado terminal (resolverExpiracionTtl)
  application/
    barrido-expiracion.use-case.ts Orquesta: selección cross-tenant → por candidata: Tx + resolverExpiracionTtl + liberarFecha + PromocionColaPort
  infrastructure/
    cron.prisma.adapter.ts         Adaptador Prisma: selección candidatas + transacción por RESERVA con SELECT…FOR UPDATE
  interface/
    cron.controller.ts             POST /cron/barrido-expiracion (CronTokenGuard, mapeo BarridoExpiracionResponse)
  cron.module.ts
```

**Regla de dependencia:** `domain/` no importa Prisma ni NestJS. `resolverExpiracionTtl` es una función pura (el mismo patrón que `derivarColor` en `calendario/` y `determinarAltaConFecha` en `maquina-estados.ts`).

#### Respuesta (`BarridoExpiracionResponse`)

| Campo | Tipo | Descripción |
|---|---|---|
| `candidatas` | integer | RESERVA seleccionadas como candidatas cross-tenant |
| `expiradas` | integer | Candidatas efectivamente transicionadas y con fecha liberada |
| `promocionesDisparadas` | integer | Veces que se disparó el seam `PromocionColaPort` (una por expiración con cola activa) |
| `fallos` | integer | Candidatas cuya expiración falló de forma aislada |

#### Multi-tenancy y RLS

Cada mutación se ejecuta bajo `SET LOCAL app.tenant_id` del tenant de la RESERVA candidata. La lectura inicial es cross-tenant (proceso de Sistema); todas las escrituras están acotadas al tenant correcto. La defensa en profundidad (RLS en PostgreSQL) garantiza el aislamiento incluso ante un error de aplicación.

#### Sin migración de esquema

US-012 no añade entidades ni columnas nuevas: `ttl_expiracion` (en `RESERVA` y `FECHA_BLOQUEADA`), `estado`, `sub_estado` y `AUDIT_LOG` existen desde US-000/US-040/US-004.

### 2.13 Capability M11 Presupuestos: generación del presupuesto y activación de pre-reserva (US-014 / UC-14)

La capability `presupuestos` cubre el **nodo de mayor complejidad del camino feliz**: coordina tres capabilities en **una única transacción** — crear PRESUPUESTO, transicionar RESERVA, actualizar FECHA_BLOQUEADA, vaciar la cola — y delega el cálculo al motor de tarifa (UC-16 / US-016). Es el primer agregado distinto de RESERVA con ciclo de vida propio (`borrador`/`enviado`/`aceptado`/`rechazado`) que se introduce en el MVP.

#### Módulo backend

```
apps/api/src/presupuestos/
  domain/
    presupuesto.entity.ts            Entidad PRESUPUESTO con desglose fiscal congelado
    pdf-presupuesto.port.ts          Puerto de generación de PDF (interfaz pura — sin Puppeteer)
    presupuesto.repository.port.ts   Puerto de persistencia
  application/
    generar-presupuesto.use-case.ts  Orquestador UC-14: preview + confirmación (Unit of Work)
  infrastructure/
    presupuesto.prisma.adapter.ts    Repositorio Prisma con RLS
    puppeteer-pdf.adapter.ts         Adaptador de generación PDF (Puppeteer/react-pdf)
  interface/
    presupuestos.controller.ts       POST /reservas/{id}/presupuesto/preview · POST /reservas/{id}/presupuesto
  presupuestos.module.ts
```

**Regla de dependencia hexagonal:** `domain/` no importa Prisma ni Puppeteer ni NestJS. El módulo `presupuestos` no importa de `reservas/domain/` directamente: la coordinación transaccional se realiza a través del puerto de transición de RESERVA que el use-case de `presupuestos` invoca, respetando la regla de no-acoplamiento entre módulos de dominio.

#### Dos endpoints y la partición preview/confirmación

- **`POST /reservas/{id}/presupuesto/preview`** — calcula el **borrador** invocando el motor de tarifa (UC-16). No persiste ningún PRESUPUESTO, no muta la RESERVA ni la `FECHA_BLOQUEADA`, no envía ningún email. Acepta body opcional `{ extras?, descuento_eur?, precio_manual_eur? }` (para el caso `tarifa_a_consultar`). Responde con el desglose: base imponible, IVA 21%, extras, total, reparto 40%/60%/fianza, instrucciones de transferencia. Errores: `422` con `camposFaltantes` (datos fiscales incompletos), `422`/`409` por errores del motor de tarifa (`TARIFA_NO_CONFIGURADA`, `TEMPORADA_NO_CONFIGURADA`, `EXTRA_NO_ENCONTRADO`), `409` por guarda de origen o presupuesto ya existente.

- **`POST /reservas/{id}/presupuesto`** — **confirma** el borrador. Body: `{ extras, descuento_eur?, descuento_motivo?, precio_manual_eur? }`. En una **única transacción** all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante: INSERT PRESUPUESTO (`version = 1`, `tarifa_congelada = true`, `estado = 'enviado'`) + UPDATE RESERVA (`→ pre_reserva`, `ttl_expiracion = now() + ttl_prereserva_dias`) + insert-o-update de FECHA_BLOQUEADA (`tipo_bloqueo = 'blando'`, nuevo TTL 7 días) + vaciado de cola A16 (`2d → 2y`) + AUDIT_LOG. Post-commit: generación del PDF y UPDATE de `PRESUPUESTO.pdf_url` (idempotente); disparo de E2 vía motor US-045. Errores: `201` (éxito), `409` (carrera `UNIQUE(tenant_id, fecha)`, presupuesto ya existente), `422` (guarda de origen, datos fiscales, precio manual requerido).

#### Transacción única — garantía de atomicidad

La transacción que sostiene la confirmación es **la más compleja del MVP** porque coordina dos agregados en la misma BD bajo el mismo `SELECT … FOR UPDATE`:

1. **Serialización:** `FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` (si existe fila activa en `2b`/`2c`/`2v`) o sobre `UNIQUE(tenant_id, fecha)` (si origen es `2a`, protege el INSERT por colisión P2002).
2. **INSERT PRESUPUESTO congelado:** desglose fiscal derivado del motor de tarifa; una vez confirmado, cambios en el tarifario no lo recalculan.
3. **UPDATE RESERVA:** `estado → 'pre_reserva'`, `sub_estado → NULL`, `ttl_expiracion = now() + ttl_prereserva_dias`.
4. **Insert-o-update FECHA_BLOQUEADA:** reutiliza `bloquearFecha(fase = 'pre_reserva')` de US-040 con la rama insert-o-update ya en `bloquearEnTx(tx, …)`. `tipo_bloqueo` permanece `'blando'` (el upgrade a `firme` ocurre en la confirmación de reserva, fuera de US-014).
5. **Vaciado de cola A16:** reutiliza la mecánica de US-007 (UPDATE masivo `2d → 2y`); si la cola está vacía, 0 filas afectadas sin error.
6. **AUDIT_LOG:** `accion='transicion'` por la RESERVA principal + una entrada por cada RESERVA descartada de la cola.

Un fallo parcial hace rollback completo de las 6 operaciones.

#### PDF y E2 fuera de la transacción crítica

La generación del PDF (Puppeteer/react-pdf) y el envío del email E2 ocurren **post-commit** para no alargar la ventana del `FOR UPDATE`:

- El adaptador `PdfPresupuestoPort` genera el PDF y devuelve la URL; un segundo UPDATE idempotente almacena `PRESUPUESTO.pdf_url`.
- E2 se dispara vía `DespacharEmailService` (US-045), adjuntando el PDF por referencia a `pdf_url`. La idempotencia `(reserva_id, codigo_email)` de US-045 garantiza una sola E2 por RESERVA (protege del doble clic).
- Un fallo del proveedor de email **no revierte** la pre-reserva; queda trazado en `COMUNICACION` (`estado = 'fallido'`) sin reintento en MVP. E2 pasa de `diseñada/inactiva` a **activa** a partir de US-014. Ver DT-EMAIL-02 en §2.9.

#### Precio manual (>50 invitados)

Cuando el motor de tarifa devuelve `tarifa_a_consultar = true`, la confirmación exige `precio_manual_eur` en el body; si no se proporciona, el sistema devuelve `422`. El `PRESUPUESTO.total` se fija al precio manual; `tarifa_id` queda a `null` en el AUDIT_LOG (no se almacena en el PRESUPUESTO).

#### `HttpExceptionFilter` — propagación de `camposFaltantes` (US-014)

US-014 actualiza el `HttpExceptionFilter` global para que propague el campo `camposFaltantes` (lista de nombres de campos fiscales faltantes) en el body del error `422`. Antes del cambio, los errores con payload estructurado podían perder ese detalle al pasar por el filtro.

#### Multi-tenancy y RLS

PRESUPUESTO no lleva `tenant_id` propio: el aislamiento se garantiza vía la FK a RESERVA (que sí lleva `tenant_id`) con RLS activo en PostgreSQL. El adaptador Prisma de presupuestos lee siempre a través de la RESERVA del tenant del JWT.

#### Sin migración de esquema

US-014 no añade entidades ni columnas nuevas al schema: la tabla `PRESUPUESTO` (con `fecha_envio` y `fecha_actualizacion`) ya existía desde US-000. La capability solo activa el uso productivo de esa tabla.

---

### 2.14 Capability M12 Facturación: generación de la factura de señal (US-022 / UC-18)

La capability `facturacion` cubre el **ciclo de vida completo de la FACTURA** como agregado raíz propio: numeración fiscal secuencial, desglose contable (base/IVA), generación de PDF y flujo de aprobación/rechazo por el Gestor. US-022 implementa la primera instancia concreta: la **factura de señal** (`tipo = 'senal'`), disparada automáticamente como efecto post-commit de la confirmación de la señal (US-021). La capability crecerá con la factura de liquidación (UC-21), la de fianza y las complementarias.

#### Módulo backend

```
apps/api/src/facturacion/
  domain/
    factura.entity.ts              Entidad FACTURA con ciclo de vida (borrador→enviada→cobrada)
    desglose-fiscal.ts             Función pura: base=round(total/1.21,2); iva=total−base
    generar-pdf-factura.port.ts    Puerto de generación de PDF (espejo de presupuestos/application)
    factura.repository.port.ts     Puerto de persistencia con idempotencia (findByReservaIdAndTipo)
  application/
    generar-factura-senal.use-case.ts  Orquestador UC-18: idempotencia + numeración + desglose + PDF
    aprobar-factura.use-case.ts        borrador → enviada (guarda PDF + datos fiscales)
    rechazar-factura.use-case.ts       Registra rechazo en AUDIT_LOG, E3 bloqueado
    regenerar-pdf-factura.use-case.ts  Reintento idempotente de generación de PDF
  infrastructure/
    factura.prisma.adapter.ts      Repositorio Prisma con RLS
    pdf-factura-fake.adapter.ts    Adaptador FAKE determinista (devuelve url sintética sin red)
  interface/
    facturas.controller.ts         GET /reservas/{id}/factura-senal · POST /facturas/{id}/aprobar
                                   · POST /facturas/{id}/rechazar · POST /facturas/{id}/regenerar-pdf
  facturacion.module.ts
```

**Regla de dependencia hexagonal:** `domain/` no importa Prisma ni Puppeteer ni NestJS. La función `desglose-fiscal.ts` es una **función de flecha pura e inmutable**, testeable sin BD (mismo patrón que `desglose-fiscal.ts` de `presupuestos/domain/`).

#### Patrón "efecto post-commit" — coordinación con `confirmacion` (decisión D-1)

La creación de la factura de señal es un **efecto posterior al commit** de la transición `pre_reserva → reserva_confirmada` de US-021, **no parte de su transacción crítica** (que sostiene el `FOR UPDATE` sobre `FECHA_BLOQUEADA`). Es el espejo exacto del patrón "PDF + E2 post-commit" de US-014:

- **Dentro de la transacción de US-021:** se confirma el estado, se congela `importe_senal`, se actualiza `FECHA_BLOQUEADA` a firme y se registra `AUDIT_LOG transicion`. Nada de facturación entra aquí.
- **Post-commit (no bloqueante):** `ConfirmarSenalUseCase` invoca `GenerarFacturaSenalUseCase` tras commitear. Su fallo **NO revierte la confirmación** — la RESERVA permanece en `reserva_confirmada`.
- **Separación de capabilities:** `confirmacion` (justificante + transición de estado + FICHA_OPERATIVA) y `facturacion` (FACTURA + numeración + PDF) son módulos distintos con cohesión propia. `confirmacion` solo conoce el puerto de `facturacion`; nunca importa el adaptador directamente.

#### Desglose fiscal como dominio puro

La función `calcularDesgloseFiscal(total)` es una **función de flecha pura e inmutable** en `facturacion/domain/desglose-fiscal.ts`:

- `iva_porcentaje = 21,00` (fijo IVA general MVP)
- `base_imponible = round(total / 1,21, 2)` (redondeo contable mitad hacia arriba)
- `iva_importe = total − base_imponible` (por **resta**, no `round(base × 0,21)`)

El cómputo de `iva_importe` por resta garantiza que `base_imponible + iva_importe = total` **exactamente**, sin desajuste de céntimos por doble redondeo. El mismo criterio rige el reparto señal/liquidación en US-021 (D-3). El ejemplo del AC: `total = 1.200,00` → `base = 991,74`, `iva = 208,26`, suma exacta.

#### Numeración `F-YYYY-NNNN` y concurrencia (decisión D-3, D-8)

El `numero_factura` sigue el formato `F-{año}-{NNNN}` con `NNNN = MAX(NNNN del tenant en el año) + 1` (padding a 4 dígitos). El año de emisión va embebido en el literal, sin columna `anio` aparte.

La unicidad la garantiza `@@unique([tenantId, numeroFactura])` en BD. Ante colisión entre dos facturas de reservas distintas del mismo tenant generadas simultáneamente:
1. Ambas calculan el mismo `NNNN`.
2. Una inserción falla con `P2002` en el constraint.
3. La aplicación **captura el `P2002`, recalcula el siguiente número y reintenta** (bucle acotado).
4. Ambas facturas quedan con números consecutivos, sin duplicados ni facturas sin número.

Nunca Redis ni locks distribuidos (hook `no-distributed-lock` del proyecto). Esta zona crítica tiene **tests de concurrencia reales** (skill `concurrency-locking`): N transacciones simultáneas → todos los números únicos y consecutivos.

#### Idempotencia — una factura de señal por reserva (decisión D-4)

Antes de crear, el use-case llama a `findByReservaIdAndTipo(reservaId, 'senal')`:
- Si existe: devuelve la existente, registra el intento en `AUDIT_LOG`, no crea duplicado.
- Si no existe: crea la FACTURA.

Red de seguridad en BD: `@@unique([reservaId, tipo])`. Ante `P2002` (dos disparos concurrentes que sortean la guarda), el use-case captura el error, recupera la existente y la devuelve. Espejo de la idempotencia de `FICHA_OPERATIVA` (US-021 D-4).

#### Generación del PDF (decisión D-5)

Reutiliza el puerto/adaptador de PDF ya existente en `presupuestos/` mediante el puerto de dominio `GenerarPdfFacturaPort` (interfaz pura). El adaptador de infraestructura activo en el MVP es `PdfFacturaFakeAdapter` (devuelve una `pdf_url` sintética sin Puppeteer ni red). La generación ocurre **post-commit** de la inserción de la FACTURA:

1. `GenerarFacturaSenalUseCase` inserta la FACTURA en `borrador` con `pdf_url = null`.
2. Post-commit: invoca `GenerarPdfFacturaPort.generar(datosFactura)`.
3. Al completar: UPDATE idempotente `FACTURA.pdf_url = url_generada`.

Si los datos fiscales del CLIENTE son incompletos (`dni_nif` o dirección nulos): no se intenta la generación; `pdf_url` permanece nulo; borrador marcado inválido. Si el servicio de PDF falla transitoriamente: `pdf_url = null`; el sistema reintenta automáticamente; la aprobación queda bloqueada hasta que el PDF esté disponible.

#### Aprobación y rechazo del borrador

| Operación | Endpoint | Precondición | Efecto |
|---|---|---|---|
| Aprobar | `POST /facturas/{id}/aprobar` | `estado = 'borrador'` + `pdf_url NOT NULL` + datos fiscales válidos | `estado = 'enviada'`, `fecha_emision = now()`, `AUDIT_LOG actualizar` |
| Rechazar | `POST /facturas/{id}/rechazar` | `estado = 'borrador'` | `estado` permanece `borrador`, motivo a `AUDIT_LOG`, E3 bloqueado |
| Regenerar PDF | `POST /facturas/{id}/regenerar-pdf` | `estado = 'borrador'` + `pdf_url IS NULL` | Reintento idempotente; UPDATE `pdf_url` si OK |
| Consultar borrador | `GET /reservas/{id}/factura-senal` | RESERVA existe + JWT válido | Devuelve FACTURA con flags `esBorradorInvalido` / `pdfPendiente` derivados |

El email E3 (al cliente) **no se dispara en US-022**; queda pendiente de la capability US-023 (condiciones particulares). La FACTURA en `enviada` es el requisito previo para E3.

#### Multi-tenancy y RLS

FACTURA lleva `tenant_id` propio (a diferencia de PRESUPUESTO). El aislamiento multi-tenant se garantiza por `tenant_id` en la tabla + RLS activo en PostgreSQL. El constraint `@@unique([tenantId, numeroFactura])` es multi-tenant correcto: `F-2026-0001` puede existir para dos tenants distintos.

#### Migración de schema (US-022 §D-7)

La tabla `FACTURA` existía desde US-000 con todas las columnas necesarias. La migración de US-022 **solo cambia constraints**, sin columnas nuevas:

1. **Sustituye** `numero_factura @unique` (global) por `@@unique([tenantId, numeroFactura])` (por tenant).
2. **Añade** `@@unique([reservaId, tipo])` (idempotencia por tipo y reserva).

#### Actualización de DT-EMAIL-02 (E3)

El email E3 (`reserva_confirmada` + factura de señal aprobada) estaba marcado como pendiente de US-021/022/023. US-022 implementa la generación y aprobación de la factura, pero **E3 no se cablea en este change**: se cableará en US-023 (condiciones particulares), que es el trigger natural de E3 (confirmación + factura + condiciones). Ver `§2.9 DT-EMAIL-02`.

---

### 2.15 Capability M12 Facturación — emisión atómica de liquidación y fianza (US-028 / UC-21 / UC-22)

US-028 cierra la capability de facturación para los documentos de liquidación y fianza: toma los borradores creados por US-027 (con `numero_factura = NULL`) y los emite al cliente. Introduce **tres nuevos casos de uso de aplicación** y **un nuevo campo en el modelo `Comunicacion`**.

#### Nuevos casos de uso

| Use case | Endpoint | Efecto principal |
|---|---|---|
| `AprobarYEnviarLiquidacionUseCase` | `POST /reservas/{id}/facturas/liquidacion/aprobar-enviar` | Emite liquidación (+ fianza si no se envió separada), envía E4, actualiza `liquidacion_status = 'facturada'` y `fianza_status = 'recibo_enviado'` |
| `EnviarReciboFianzaUseCase` | `POST /reservas/{id}/facturas/fianza/enviar` | Emite solo el recibo de fianza, email `manual`, actualiza `fianza_status = 'recibo_enviado'` sin tocar `liquidacion_status` |
| `ReenviarLiquidacionUseCase` | `POST /reservas/{id}/facturas/liquidacion/reenviar` | Reenvía el PDF ya emitido sin reasignar numeración ni cambiar estado; crea `COMUNICACION E4` con `es_reenvio = true` |

#### Patrón D-1: atomicidad estado↔E4 (excepción al post-commit)

US-045/US-014/US-008 establecieron que el email es **post-commit y su fallo no revierte el estado**. US-028 exige lo contrario para `AprobarYEnviarLiquidacionUseCase`: la transición de estado y el envío de E4 son **síncronos y confirmados**. El motor de US-045 se invoca en **modo síncrono** (no fire-and-forget):

1. Se preparan y verifican los PDFs adjuntos (ambos `pdf_url` existentes).
2. Se asignan los `numero_factura = F-YYYY-NNNN` (reutilizando la numeración de US-022: `MAX+1`, retry ante `P2002`, nunca locks distribuidos).
3. Se llama al motor de email E4 de forma **síncrona esperando la confirmación del proveedor**.
4. **Solo si E4 se confirma**: se commitea el conjunto `numero_factura asignado + estado = 'enviada' (ambas facturas) + liquidacion_status = 'facturada' + fianza_status = 'recibo_enviado' + marcado RESERVA_EXTRA + COMUNICACION E4 enviado + AUDIT_LOG`.
5. **Si E4 falla**: rollback total; ningún estado cambia; el `numero_factura` del intento no queda consolidado; se devuelve `502/503` recuperable.

En `test`/CI el transporte es `FakeEmailAdapter` (confirmación simulada, sin red), manteniendo la misma semántica.

#### Campo `esReenvio` en `Comunicacion` (migración D-4)

Para permitir múltiples `COMUNICACION E4` por reserva cuando el Gestor reenvía la factura, se añadió el campo `esReenvio Boolean @default(false)` al modelo `Comunicacion`. El índice UNIQUE parcial de US-045 se actualizó con la condición adicional `AND es_reenvio = false`:

```
uq_comunicacion_reserva_codigo (reserva_id, codigo_email)
  WHERE reserva_id IS NOT NULL AND es_reenvio = false
```

Los reenvíos (`esReenvio = true`) quedan fuera del constraint, permitiendo trazabilidad de cada envío sin violar la idempotencia del envío original.

#### Descuento negociado antes de emitir (D-2)

El Gestor puede aplicar un descuento sobre la factura de liquidación mientras está en `borrador`, antes de llamar a `aprobar-enviar`. El body opcional `{ descuento?, extrasCorregidos?, motivo? }` dispara la función pura `aplicarDescuentoLiquidacion` (dominio, reutiliza `calcularDesgloseFiscal` de US-022 con el total ajustado) y actualiza `RESERVA.importe_liquidacion`; el descuento y su motivo quedan en `AUDIT_LOG accion='actualizar'`.

#### Envío separado del recibo de fianza (D-3)

El recibo de fianza puede enviarse de forma independiente de la liquidación. `EnviarReciboFianzaUseCase` registra el email con `codigo_email = 'manual'` (no E4), por lo que no colisiona con la idempotencia `(reserva_id, E4)`. Si la fianza ya se envió por separado antes de aprobar la liquidación, `AprobarYEnviarLiquidacionUseCase` incluye solo la factura de liquidación en E4 y no sobreescribe `fianza_status = 'recibo_enviado'` (ya establecido).

#### Módulo backend (extensión del módulo `facturacion`)

```
apps/api/src/facturacion/
  application/
    aprobar-enviar-liquidacion.use-case.ts   Atomicidad D-1
    enviar-recibo-fianza.use-case.ts          D-3
    reenviar-liquidacion.use-case.ts          D-4
  infrastructure/
    (6 nuevos adaptadores de infraestructura de facturación)
```

**Regla de dependencia hexagonal:** el dominio no importa el SDK del proveedor de email ni Prisma. El motor `DespacharEmailService` de US-045 se invoca en modo síncrono; el transport (real/fake) se inyecta.

#### Actualización de DT-EMAIL-02 (E4 — RESUELTA)

E4 pasa de "diseñada/inactiva" a activa con US-028. El trigger se cablea en `AprobarYEnviarLiquidacionUseCase` (modo síncrono con confirmación). Pendientes: E3→US-023, E5→US-034, E8→US-035. Ver `§2.9 DT-EMAIL-02`.

#### Sin migración de FACTURA ni de RESERVA

US-028 no añade columnas a `FACTURA` ni a `RESERVA`. Las únicas mutaciones de esquema son:
1. **Campo `esReenvio`** en `COMUNICACION` (`Boolean @default(false)`).
2. **Actualización del predicado** del índice UNIQUE parcial de `COMUNICACION` (añadido `AND es_reenvio = false`).

---

### 2.16 Módulo M — Dashboard Operativo: agregación de lectura pura (US-044 / UC-34)

El módulo `dashboards` entrega una **vista agregada del estado operativo del tenant** en una única llamada a la API. Es lectura pura: no muta ninguna entidad ni tabla; lee `RESERVA` y `FECHA_BLOQUEADA` existentes. Complementa al módulo `calendario` (§2.11) ofreciendo una perspectiva orientada a acciones pendientes y alertas, en lugar de una vista por fecha de calendario.

#### Endpoint

`GET /dashboard` — sin parámetros de query. El backend agrega los 7 widgets para el tenant del JWT y responde con `DashboardResponse`. Requiere JWT válido; sin parámetros de paginación (el dashboard es un resumen, no un listado).

Respuestas: `200` (`DashboardResponse`), `401` (sin sesión válida).

#### Los 7 widgets (`DashboardResponse`)

| Widget (clave camelCase) | Descripción |
|---|---|
| `hoyManana` | Eventos del día actual y del día siguiente |
| `pipeline` | Consultas por sub-estado, pre-reservas y reservas confirmadas |
| `subProcesosCriticos` | Reservas con pre-evento, liquidación o fianza atrasada |
| `pendientes` | Pagos vencidos y TTLs próximos a expirar |
| `consultasEnCola` | Leads en espera agrupados por fecha bloqueada |
| `visitasProgramadas` | Próximas visitas ordenadas por fecha ascendente |
| `proximos30Dias` | Eventos y bloqueos en los próximos 30 días |

Cada widget devuelve `{ total: number, items: DashboardItem[] }`. El campo `fechaEvento` en `DashboardItem` es **nullable** (`string | null`): consultas sin fecha asignada (sub-estado `2a`) no tienen `fechaEvento`.

#### Arquitectura interna (hexagonal)

```
apps/api/src/dashboards/
  domain/
    dashboard.types.ts            Tipos de dominio: DashboardItem, DashboardResponse, los 7 widgets
    dashboard-query.port.ts       Puerto de consulta (interfaz pura — sin NestJS ni Prisma)
    clock.port.ts                 Puerto de reloj (inyectable para tests deterministas)
    color-dashboard.ts            Función pura de derivación de color (tabla de datos, mismo patrón que derivarColor en calendario/)
  application/
    consultar-dashboard.use-case.ts  Agrega los 7 widgets invocando el puerto de consulta
  infrastructure/
    dashboard-query.prisma.adapter.ts  Adaptador Prisma con filtro por tenant_id + RLS
    clock.adapter.ts                   Adaptador de reloj real (Date.now())
  interface/
    dashboard.controller.ts       GET /dashboard (JWT guard, mapeo 200/401)
    dashboard.dto.ts              DTO de respuesta OpenAPI
  dashboards.module.ts
  dashboards.tokens.ts            Símbolos de inyección de dependencias
```

**Regla de dependencia hexagonal:** `domain/` no importa Prisma ni NestJS. El puerto `ClockPort` hace el use-case testeable con relojes inyectados sin depender de `Date.now()` real en los tests.

#### `fechaEvento` nullable — alineación contrato + SDK + backend + frontend

`DashboardItem.fechaEvento` es `string | null` en todos los niveles: contrato OpenAPI, SDK generado, adaptador Prisma y componentes React. Las consultas en sub-estado `2a` (exploratorias, sin fecha asignada) tienen `fechaEvento = null`; el frontend lo maneja mostrando "–" o "Sin fecha" según el widget.

#### Frontend

Feature `apps/web/src/features/dashboard/` (Bulletproof React: `api/ components/ lib/ model/ pages/` + barrel `index.ts`). El `DashboardPage` realiza una única llamada `GET /dashboard` vía `useDashboard` (TanStack Query). Ramas de estado: `isLoading` → `DashboardSkeleton`; `error` → `DashboardError` con reintento; datos → parrilla responsive de 7 `WidgetCard`. Layout mobile-first (1 columna móvil, 2 en `md`, 3 en `lg`/`xl`). El Dashboard es la entrada en posición 1 del sidebar; la landing post-login sigue siendo `/calendario`.

#### Multi-tenancy y RLS

La query filtra siempre por `tenant_id` del JWT, reforzado por RLS activo en PostgreSQL. Ningún dato de otro tenant es alcanzable aunque el filtro de aplicación fallara.

#### Sin migración de esquema

US-044 no añade ninguna entidad nueva ni modifica columnas: lee `RESERVA` y `FECHA_BLOQUEADA` (existentes desde US-000/US-040), y `FICHA_OPERATIVA` (existente desde US-021). No hay script de migración Prisma asociado a este change.

---

### 2.17 Capability `pipeline` — Listado de Reservas Activas (US-049 / UC-37 / UC-38)

La capability `pipeline` expone el endpoint `GET /reservas` (`operationId: listarReservas`) que devuelve la lista paginada de reservas **activas** del tenant con los campos de progreso y nombre ya derivados, para alimentar el Kanban (UC-37 / US-050) y el Listado (UC-38 / US-050) de la pantalla de Reservas sin múltiples llamadas adicionales. Es una **operación de lectura pura**: no muta ninguna entidad, no produce bloqueos y no tiene concurrencia mutante. La capability `consultas` sigue siendo dueña del ciclo de vida y las transiciones del agregado `RESERVA`; `pipeline` solo lo lee.

#### Endpoint

`GET /reservas` — query params heredados del contrato ya declarado: `estado`, `subEstado`, `fechaDesde`, `fechaHasta`, `search`, `page` (≥1), `limit` (1-100; default 20). El filtro de exclusión de terminales y el aislamiento por `tenant_id` se aplican **siempre**, con independencia de los demás filtros. Las reservas se devuelven ordenadas por `fechaCreacion` descendente.

Respuestas: `200` (`ReservaListResponse` = `{ data: Reserva[], metadata: { total, page, limit } }`), `401` (sin JWT válido).

#### Reglas de negocio

| Regla | Detalle |
|-------|---------|
| Estados activos | `2a`, `2b`, `2c`, `2d`, `2v`, `pre_reserva`, `reserva_confirmada`, `evento_en_curso`, `post_evento` |
| Estados excluidos siempre | `2x`, `2y`, `2z`, `reserva_completada`, `reserva_cancelada` |
| `nombreEvento` | `{CLIENTE.nombre} {CLIENTE.apellidos}`; fallback a `RESERVA.codigo` si no hay cliente resoluble |
| `progressLogistica` | Entero 0/50/100 derivado de `pre_evento_status`: `pendiente=0`, `en_curso=50`, `cerrado=100`. Vale `0` para consultas y `pre_reserva`. |
| `progressLiquidacion` | Entero 0/50/100 derivado de `liquidacion_status`: `pendiente=0`, `facturada=50`, `cobrada=100`. Vale `0` para consultas y `pre_reserva`. |
| Multi-tenancy | `tenant_id` extraído del JWT, nunca configurable por el usuario; reforzado por RLS en PostgreSQL. |

#### Cambio aditivo al schema `Reserva` del contrato

Los tres campos (`nombreEvento: string`, `progressLogistica: integer`, `progressLiquidacion: integer`) se añaden como **opcionales** al schema `Reserva` de `docs/api-spec.yml`. No están en `required`; no rompen `ReservaDetalle`, `CreateReservaResponse` ni `FichaConsulta`. SDK del frontend regenerado (`apps/web/src/api-client/`), nunca editado a mano.

#### Arquitectura interna (hexagonal)

```
apps/api/src/reservas/
  domain/
    listar-reservas.port.ts              Puerto de consulta (interfaz pura — sin NestJS ni Prisma)
    [funciones puras de derivación]       progressLogistica/Liquidacion y nombreEvento como mapas declarativos
  application/
    listar-reservas.use-case.ts          Orquesta la consulta de activas; proyecta cada RESERVA con los tres campos derivados. Sin efectos de escritura.
  infrastructure/
    listar-reservas.prisma.adapter.ts    Query de activas con JOIN a CLIENTE, filtro por tenant_id + RLS, ORDER BY fechaCreacion DESC, paginación, filtros de query
  interface/
    listar-reservas.controller.ts        GET /reservas (JwtAuthGuard, mapeo 200/401); tenant_id inyectado desde el JWT
```

**Regla de dependencia hexagonal:** `domain/` no importa Prisma ni NestJS. La derivación de progreso y de `nombreEvento` son **funciones puras de dominio** (mapas declarativos estado→valor, mismo patrón que `derivarColor` en `calendario/` y `resolverExpiracionTtl` en `cron/`). Cambiar la lógica de derivación solo requiere editar los mapas.

#### Multi-tenancy y RLS

La query del adaptador filtra **siempre** por `tenant_id` del JWT. El RLS activo en PostgreSQL actúa como defensa en profundidad: ninguna fila de otro tenant es alcanzable aunque el filtro de aplicación fallara.

#### Sin migración de esquema

US-049 no añade entidades ni columnas nuevas: lee `RESERVA` (con `pre_evento_status` y `liquidacion_status` existentes desde US-000/US-021) y `CLIENTE` (existente desde US-003). Los tres campos derivados se calculan en memoria a partir de datos ya almacenados; no hay script de migración Prisma asociado a este change.

#### Fixes de conformidad del backend (US-050 — sin cambio de contrato ni de esquema)

Durante la implementación del frontend de US-050 se detectaron dos defectos en la implementación de US-049 que impedían el funcionamiento con datos reales. Ambos se corrigieron alineando la implementación al contrato ya congelado:

**Fix 1 — Proyección incompleta (`ReservaPipelineItemDto`):** la proyección emitía `id` en vez de `idReserva` (campo `required` en el schema `Reserva` del contrato) y omitía `fechaEvento`, `numInvitadosFinal`, `numAdultosNinosMayores4`, `numNinosMenores4` y `notas`. Corregido en `interface/listar-reservas.dto.ts`, `application/listar-reservas.use-case.ts` e `interface/listar-reservas.controller.ts`. El contrato (`docs/api-spec.yml`) y el SDK generado no se modificaron: ya eran correctos.

**Fix 2 — Filtro de sub-estado con `NULL` (`listar-reservas.prisma.adapter.ts`):** el constructor `construirWhere()` aplicaba `subEstado: { notIn: [...SUB_ESTADOS_TERMINALES] }`, que en SQL produce `sub_estado NOT IN ('2x','2y','2z')`. Por la lógica ternaria de SQL, `NULL NOT IN (...)` evalúa a NULL (no TRUE), por lo que todas las reservas con `subEstado = null` (`pre_reserva`, `reserva_confirmada`, `evento_en_curso`, `post_evento`) quedaban excluidas. Corregido combinando vía `AND` explícito: `{ OR: [{ subEstado: null }, { subEstado: { notIn: [...] } }] }`, dejando `where.OR` reservado al filtro `search`. El filtro explícito `?subEstado=<valor>` mantiene su rama `equals + notIn` original (no admite NULL: un filtro pide un valor concreto).

#### Capability `pipeline-ui` — Pantalla `/reservas` (US-050 / UC-37 / UC-38)

La pantalla `/reservas` (implementada en US-050) es la capa de presentación de la capability `pipeline`. Consume `GET /reservas` a través del SDK generado sin añadir llamadas adicionales al backend.

**Estructura frontend** (`apps/web/src/features/reservas/` — Bulletproof React):

```
features/reservas/
  api/
    useReservasActivas.ts     Hook TanStack Query sobre el SDK listarReservas (staleTime: 30 s); compartido por ambos tabs
  lib/
    columnasKanban.ts         Mapa declarativo estado/subEstado → columna (5 columnas)
    aforo.ts                  Helper: numInvitadosFinal con fallback a suma adultos/niños
  pages/ReservasPage/
    ReservasPage.tsx          Orquestador de tabs (flujo|listado; flujo activo por defecto)
    KanbanView.tsx            Vista Kanban: 5 columnas por fase
    KanbanColumn.tsx          Cabecera con dot de color + label + count
    ReservaKanbanCard.tsx     Tarjeta: nombre, fecha+pax, barras LOGÍSTICA/LIQUIDACIÓN, nota si existe
    ListadoView.tsx           Tabla en ≥lg; cards apiladas en <lg
    ProgressBar.tsx           Barra de progreso reutilizable
    constants.ts              Tokens Figma (colores de columna, labels)
  index.ts                    Barrel (único punto de import externo)
```

**Agrupación estado → columna Kanban:**

| Columna | Estados / sub-estados |
|---------|----------------------|
| Consulta | `2a`, `2b`, `2c`, `2d`, `2v` |
| Pre-reserva | `pre_reserva` |
| Confirmada | `reserva_confirmada` |
| En Curso | `evento_en_curso` |
| Post-evento | `post_evento` |

**Estados de vista:** skeleton en carga (FA-02), estado vacío con CTA "Nueva Reserva" (FA-01), estado de error con reintento que hace `refetch` (FA-03). Responsive mobile-first (390/768/1280): Kanban con scroll horizontal en `<lg`; Listado en cards apiladas en `<lg`, tabla en `≥lg`. Sin overflow horizontal; objetivos táctiles accesibles.

---

## 3. Arquitectura objetivo de producción (visión a escala)

> **Estado: visión de destino. NO se implementa en el MVP TFM.** Esta sección documenta a dónde evolucionaría Slotify como producto comercial multi-tenant. Cada componente se justifica por una necesidad que aparece *a escala*, y se anota por qué está sobredimensionado en la fase actual.

### 3.1 Resumen

La arquitectura de producción separa la presentación de la lógica de dominio y se despliega sobre AWS. El frontend y el backend de dominio (NestJS) corren como servicios independientes detrás de un Application Load Balancer; el conjunto se sirve por CloudFront y se protege con AWS WAF. La capa de datos combina RDS PostgreSQL Multi-AZ (con RLS multi-tenant y réplica de lectura para el dashboard) y ElastiCache Redis (sesiones y caché). Los ficheros generados se almacenan en S3; el email transaccional se delega en SES; los procesos asíncronos (TTLs, promoción de cola, recordatorios) se ejecutan con Lambda invocado por EventBridge Scheduler. La autenticación la gestiona Cognito, los secretos viven en Secrets Manager y la observabilidad se centraliza en CloudWatch.

### 3.2 Diagrama objetivo de producción

```mermaid
graph TB
    Browser["Gestor (Browser)"]

    subgraph edge["AWS — Edge Layer"]
        R53["Route 53 · DNS"]
        WAF["AWS WAF · Protección perimetral"]
        CF["CloudFront · CDN + reverse proxy"]
    end

    subgraph vpc["AWS — VPC"]
        subgraph public["Subred Pública — AZ-a / AZ-b"]
            ALB["Application Load Balancer"]
        end
        subgraph private["Subred Privada — AZ-a / AZ-b"]
            WEB["ECS Fargate · Frontend"]
            API["ECS Fargate · NestJS API (Dominio · Casos de uso · Prisma)"]
            LAMBDA["Lambda · Jobs asíncronos (TTLs · Cola · Recordatorios)"]
        end
        subgraph datalayer["Capa de Datos — Subredes Privadas"]
            RDS[("RDS PostgreSQL Multi-AZ + réplica de lectura · RLS multi-tenant")]
            REDIS[("ElastiCache Redis · Sesiones + caché")]
        end
    end

    subgraph services["AWS — Servicios Gestionados"]
        S3["S3 · PDFs · Documentos · Imágenes"]
        SES["SES · Email transaccional (E1-E8)"]
        EB["EventBridge Scheduler · Cron"]
        COGNITO["Cognito · Auth + JWT"]
        SM["Secrets Manager"]
        CW["CloudWatch · Logs + alertas"]
    end

    Browser --> R53 --> WAF --> CF
    CF -->|"Dinámico"| ALB
    CF -->|"Estáticos y documentos"| S3
    ALB -->|"/* UI"| WEB
    ALB -->|"/api/* Dominio"| API
    WEB -->|"API"| API
    API --> RDS
    API --> REDIS
    API --> S3
    API --> SES
    API --> SM
    API --> CW
    EB --> LAMBDA
    LAMBDA --> RDS
    LAMBDA --> SES
```

### 3.3 Justificación de cada componente y nota de sobredimensionamiento en MVP

| Componente | Para qué sirve (a escala) | Por qué sobra en el MVP |
|---|---|---|
| **Route 53** | DNS gestionado, health checks, enrutado geográfico | Cualquier DNS (registrador o plataforma de hosting) basta para un dominio |
| **AWS WAF** | Cortafuegos contra OWASP/DDoS en app pública con tráfico hostil | Un piloto con un usuario interno tras login no tiene esa superficie de ataque |
| **CloudFront** | CDN global para audiencia internacional | La audiencia es un gestor local; el hosting ya trae CDN integrado |
| **Application Load Balancer** | Reparte tráfico entre múltiples servicios e instancias | Sólo necesario porque producción separa frontend y backend en servicios distintos; el MVP no los separa físicamente |
| **2× ECS Fargate** | Escalado horizontal independiente de front y back | Dos despliegues, dos imágenes Docker y comunicación por red que no aportan a un piloto y sí consumen tiempo de operación |
| **ElastiCache Redis** | Caché y sesiones distribuidas entre muchas instancias | Con una sola instancia de backend y una sola BD, no hay estado distribuido que coordinar. **Importante: el bloqueo de fecha NO usa Redis ni locks distribuidos; usa UNIQUE + transacción en PostgreSQL** (ver §2.4) |
| **RDS Multi-AZ + réplica lectura** | Alta disponibilidad con SLA y descarga de lecturas pesadas | Un tenant no genera carga de lectura que justifique réplica; HA con SLA no es requisito de un piloto |
| **Lambda + EventBridge** | Jobs serverless que escalan a cero coste | Configurar Lambda + EventBridge + IAM es más costoso que un cron simple para 4-5 jobs sencillos |
| **Cognito** | Gestión de usuarios y federación para muchos tenants | 2-3 usuarios internos no justifican un servicio de identidad completo |
| **S3** | Almacenamiento de objetos escalable | El concepto (almacenar PDFs/justificantes) sí aplica; la pieza concreta se sustituye por el storage del hosting en MVP |
| **SES** | Email transaccional a gran volumen | El concepto aplica; un proveedor de email más ágil de poner en marcha sirve igual en MVP |
| **Secrets Manager** | Rotación y auditoría de secretos | El principio (no hardcodear) aplica; en MVP se cubre con variables de entorno cifradas del hosting |
| **CloudWatch** | Observabilidad integrada en AWS | El concepto aplica; una herramienta de errores más simple cubre el MVP |

**Conclusión de la sección:** la arquitectura de producción es correcta como destino, pero implementarla para un piloto de un tenant es sobreingeniería. El coste real no es el dinero de AWS, sino el **tiempo de operación de infraestructura** (VPC, subredes, security groups, health checks, IAM, orquestación de contenedores), que el desarrollo asistido por IA **no reduce** — la IA acelera el código de aplicación, no la operación de infraestructura distribuida.

---

## 4. Prompts para DiagramsGPT

Dos prompts independientes, uno por cada arquitectura.

### 4.1 Prompt — Arquitectura objetivo de producción (AWS)

```
Draw an AWS cloud architecture diagram for Slotify, a SaaS B2B web application
for managing private event space reservations (wedding venues, farmhouses, villas).
This is the TARGET PRODUCTION architecture for a multi-tenant product at scale.
Do not add components not listed below.

--- COMPONENTS ---

USER:
- Browser (Gestor / Manager)

EDGE LAYER (AWS):
- Route 53: DNS resolution
- AWS WAF: web application firewall, DDoS and OWASP protection
- CloudFront: CDN and reverse proxy; two origins: ALB for dynamic traffic
  and S3 for static assets and documents

APPLICATION LAYER (inside a VPC):
- Application Load Balancer: in public subnets, spans AZ-a and AZ-b;
  path-based routing: /* to the frontend, /api/* to NestJS
- ECS Fargate running the frontend (SPA / SSR), in private subnets
- ECS Fargate running NestJS API: domain logic, use cases, Prisma ORM,
  in private subnets; not directly accessible from the internet
- AWS Lambda: background async jobs (TTL expiration, waiting queue promotion,
  automated reminders), in private subnets, triggered by EventBridge

DATA LAYER (inside VPC, private subnets):
- Amazon RDS PostgreSQL Multi-AZ with read replica: primary database,
  multi-tenant Row-Level Security
- Amazon ElastiCache Redis: user sessions and cache (NOT used for date locking;
  date locking is handled by a UNIQUE constraint in PostgreSQL)

MANAGED SERVICES (outside VPC):
- Amazon S3: storage for PDFs, signed documents, images
- Amazon SES: transactional email (templates E1-E8 and manual emails)
- Amazon EventBridge Scheduler: cron triggers for Lambda jobs
- Amazon Cognito: user authentication and JWT issuance
- AWS Secrets Manager: database credentials and API keys
- Amazon CloudWatch: centralized logging and alerting

--- CONNECTIONS ---
Browser -> Route 53 -> WAF -> CloudFront
CloudFront -> ALB (dynamic requests)
CloudFront -> S3 (static assets and documents)
ALB -> ECS Fargate frontend (path: /*)
ALB -> ECS Fargate NestJS API (path: /api/*)
Frontend -> NestJS API (internal API calls)
NestJS API -> RDS PostgreSQL (read/write)
NestJS API -> ElastiCache Redis (sessions and cache)
NestJS API -> S3 (file uploads)
NestJS API -> SES (send emails)
NestJS API -> Secrets Manager
NestJS API -> CloudWatch (logging)
EventBridge Scheduler -> Lambda (cron trigger)
Lambda -> RDS PostgreSQL (TTL updates, queue promotion)
Lambda -> SES (automated emails)

--- STYLE ---
Use AWS architecture icons and official AWS color palette.
Group services into clearly labeled layers: Edge Layer, VPC (with public and private
subnets), Data Layer, and Managed Services.
Show the VPC boundary and subnet boundaries clearly.
Top-to-bottom flow direction. Label each connection with a short purpose.
Keep the diagram clean — do not add services not listed above.
```

### 4.2 Prompt — Arquitectura de implementación del MVP (monolito)

```
Draw a simple deployment architecture diagram for the MVP of Slotify, a SaaS B2B
web app for managing private event space reservations. This is a cost-optimized
MVP for a single tenant, developed as a final master's project. It is a MODULAR
MONOLITH whose code lives in ONE monorepo but deploys to TWO targets: the frontend
SPA is served as static files from a CDN, and the backend runs as a single live
process against ONE PostgreSQL database.
Do not add cloud-provider-specific services (no AWS/VPC/load balancers).
Do not add components not listed below.

--- COMPONENTS ---

USER:
- Browser (Gestor / Manager)

STATIC HOSTING / CDN:
- Frontend SPA (static files, NOT a live process): Vite + React + React Router +
  TypeScript, Tailwind + shadcn/ui; consumes an OpenAPI-generated client.
  Built from the apps/web folder of the monorepo

BACKEND DEPLOYMENT (live process, e.g. Railway; built from apps/api of the monorepo):
- Backend process: NestJS API with hexagonal architecture and DDD
  (layers: interface, application, domain, infrastructure), Prisma ORM,
  exposes an OpenAPI/Swagger contract
- Simple cron: periodically calls a protected sweep endpoint on the backend
  (TTL expiration, waiting-queue promotion, reminders)

EXTERNAL MANAGED SERVICES:
- PostgreSQL (managed): single database, multi-tenant Row-Level Security,
  UNIQUE(tenant_id, date) constraint for atomic date locking, full-text search
- Object storage (hosting-provided): PDFs, payment receipts, documents
- Email provider (e.g. Resend): transactional emails (templates E1-E8)
- Error monitoring (e.g. Sentry)

--- CONNECTIONS ---
Browser -> Static hosting/CDN (downloads the SPA static files)
Browser -> Backend (HTTP/REST API calls, cross-origin / CORS)
Backend -> PostgreSQL (read/write, transactions, SELECT FOR UPDATE)
Backend -> Object storage (upload/download files)
Backend -> Email provider (send emails)
Backend -> Error monitoring (report errors)
Cron -> Backend (invokes the protected sweep endpoint)
Backend -> PostgreSQL (materializes TTL expirations and queue promotions)

--- STYLE ---
Clean, minimal, provider-agnostic style (boxes and labeled arrows, no cloud icons).
Put the frontend SPA in its own box labeled "Static hosting / CDN" (it is served as
static files, not a live process). Put the backend process and the cron inside a
separate box labeled "Backend deployment (live process)".
Show external managed services (PostgreSQL, object storage, email, error monitoring)
as separate boxes.
Top-to-bottom flow. Label each connection with a short purpose. Mark the browser->API
call as cross-origin (CORS).
Emphasize that there is a SINGLE PostgreSQL database (the core of atomic date locking),
and that both the SPA and the backend come from the same monorepo but deploy to
different targets.
Keep it simple — this is intentionally a lightweight MVP, not a distributed system.
```

---

## 5. Análisis de coste del hosting del MVP

El MVP tiene tres piezas, pero solo dos cuestan: el **frontend SPA** se sirve como archivos estáticos desde un CDN gratuito (Cloudflare Pages, Netlify o similar) y no es un proceso vivo, así que su coste tiende a cero; lo que se paga son los dos procesos permanentes, el **backend NestJS** y **PostgreSQL gestionada**. Cifras verificadas en mayo de 2026; conviene confirmarlas en las páginas oficiales antes de contratar.

| Escenario | Composición | Coste | Pega / nota |
|---|---|---|---|
| **A — Coste cero** | Frontend estático gratis (Netlify/Cloudflare Pages/Render static) + backend NestJS en Render free + PostgreSQL en Neon o Supabase free | **0 €/mes** | El backend free de Render se duerme tras inactividad (arranque en frío de segundos en la primera petición). El cron necesita un disparador externo que despierte el endpoint |
| **B — Railway integrado (recomendado)** | Todo en Railway plan Hobby: backend + Postgres + cron always-on | **~5 €/mes** (cuota fija de 5 $ con 5 $ de crédito de uso incluidos) | Sin arranques en frío. La base de datos consume parte del crédito; vigilar el dashboard de uso |
| **C — Railway + BD externa** | Railway Hobby para backend + cron; PostgreSQL gratis en Neon o Supabase | **~5 €/mes** | Aparta la BD del crédito de Railway, dejando más cómputo libre para el backend |

**Recomendación:**
- Si el objetivo es **coste literalmente cero** y se tolera el arranque en frío (aceptable para un piloto y una defensa): **Escenario A (0 €/mes)**.
- Si se quiere experiencia **always-on sin arranques en frío** por ~5 €/mes, con el cron de TTLs funcionando de forma trivial (relevante porque los TTLs son parte del núcleo crítico): **Escenario B o C**.

**Consideración sobre el cron y el núcleo crítico:** en el Escenario A, como el servicio gratuito de Render se duerme, el barrido de TTLs depende de un disparador externo. En Railway el proceso está siempre vivo y el cron es trivial. Dado que los TTLs y la promoción de cola son parte del riesgo crítico, Railway simplifica esta pieza.

**Nota sobre Vercel:** Vercel se descartó como hosting porque está optimizado para Next.js y funciones serverless; el stack actual (Vite+React como SPA + NestJS como backend) requiere un proceso persistente para el backend (cron de TTLs), que encaja mal con su modelo. La SPA estática sí podría servirse desde Vercel/Netlify/Cloudflare Pages gratis, pero el backend persistente es lo que dicta la elección de plataforma.

---

## 6. Trazabilidad de decisiones (MVP frente a objetivo)

| # | Decisión MVP | Diverge de objetivo en | Fundamento |
|---|---|---|---|
| 1 | Monolito modular (un despliegue) | 2× Fargate + ALB | Invariantes transaccionales; microservicios romperían la atomicidad del bloqueo |
| 2 | Frontend SPA (Vite + React) | Frontend con SSR/full-stack | Producto interno sin SEO; backend ya es NestJS; frontera limpia |
| 3 | NestJS como backend (se conserva) | — (igual que objetivo) | Aplica capas + DDD + hexagonal + OpenAPI (temario del máster) |
| 4 | PostgreSQL único, sin Redis | RDS Multi-AZ + ElastiCache | Una BD transaccional da la atomicidad; Redis sería punto de fallo innecesario |
| 5 | Cron simple | Lambda + EventBridge | TTLs = fila + barrido periódico; idempotente y testeable |
| 6 | JWT access+refresh con NestJS+Passport; gestor por seed | Cognito + JWT gestionado | 2-3 usuarios internos; en MVP un único gestor por tenant, sin UI de gestión de usuarios |
| 7 | Storage/email/secretos del hosting | S3 / SES / Secrets Manager | Mismos conceptos, menos integración; principios (no hardcodear) se respetan |
| 8 | Sentry | CloudWatch + WAF | Observabilidad de errores suficiente; sin superficie de ataque pública |

**Principio rector de la divergencia:** se conserva del objetivo todo lo que aporta valor formativo o protege un riesgo crítico (NestJS, hexagonal, DDD, OpenAPI, RLS multi-tenant, atomicidad en BD); se aplaza todo lo que sólo aporta a escala (orquestación de contenedores, coordinación distribuida, alta disponibilidad, infraestructura serverless, protección perimetral).

---

## 7. Resumen ejecutivo

- **Dos niveles, en orden de prioridad:** arquitectura de implementación del MVP (monolito monorepo, §2) primero, arquitectura objetivo de producción (AWS, §3) como visión de destino. Separarlas es la decisión arquitectónica de fondo.
- **MVP:** SPA Vite+React (estáticos en CDN) + backend NestJS (hexagonal/DDD/OpenAPI) como proceso vivo + PostgreSQL única. Un monorepo, dos destinos de despliegue.
- **Núcleo crítico:** bloqueo atómico por `UNIQUE(tenant_id, fecha)` + transacción, sin locks distribuidos. Encapsulado en dos funciones; primera prioridad de TDD.
- **Jobs:** cron simple + barrido idempotente, no serverless.
- **Auth:** JWT access (en memoria) + refresh (cookie httpOnly), NestJS+Passport; nunca localStorage. Tenant y rol en el payload firmado. En MVP, un único gestor por tenant aprovisionado por seed; sin UI de gestión de usuarios. Ver §2.8.
- **Hosting:** 0 €/mes (Render free + Neon/Supabase) o ~5 €/mes (Railway always-on). Ver §5.
- **Razón de la divergencia:** la IA acelera el código de aplicación, no la operación de infraestructura. Para el plazo, el monolito libera tiempo hacia las zonas que defienden la nota; AWS lo consumiría en operación.

---

*Documento de arquitectura v5.1, 07/07/2026. Cambios respecto a v5.0: refleja US-050 — Capability `pipeline-ui` (pantalla `/reservas` Kanban + Listado, UC-37 / UC-38). Añade dentro de §2.17: (a) dos fixes de conformidad del backend sin cambio de contrato ni de esquema — Fix 1: proyección `ReservaPipelineItemDto` corregida para emitir `idReserva` (no `id`) y propagar `fechaEvento`, `numInvitadosFinal`, `numAdultosNinosMayores4`, `numNinosMenores4`, `notas`; Fix 2: `construirWhere()` del adaptador Prisma corregido para admitir `subEstado IS NULL` vía `AND [{ subEstado: null } OR { subEstado: { notIn: [...] } }]`, de modo que `pre_reserva`/`reserva_confirmada`/`evento_en_curso`/`post_evento` aparecen en el pipeline; (b) subsección `Capability pipeline-ui` con la estructura Bulletproof React de `features/reservas/` (hook compartido `useReservasActivas`, mapa declarativo estado→columna, `ReservasPage` con tabs flujo|listado, `KanbanView`/`KanbanColumn`/`ReservaKanbanCard`/`ListadoView`/`ProgressBar`), la tabla de agrupación estado→columna Kanban (5 columnas) y los tres estados de vista (skeleton/vacío+CTA/error+reintento).*

*Documento de arquitectura v5.0, 06/07/2026. Cambios respecto a v4.9: refleja US-049 — Capability `pipeline` (UC-37 / UC-38): añade §2.17 (endpoint `GET /reservas` `operationId: listarReservas`; arquitectura hexagonal interna — `domain/` con puerto de consulta + funciones puras de derivación de progreso/nombre, `application/` `listar-reservas.use-case.ts`, `infrastructure/` adaptador Prisma con join a CLIENTE + filtro tenant_id + RLS + ORDER BY fechaCreacion DESC + paginación, `interface/` controller con JwtAuthGuard; tabla de reglas de negocio: estados activos vs excluidos, derivación `progressLogistica`/`progressLiquidacion` (0/50/100) desde `pre_evento_status`/`liquidacion_status`, derivación `nombreEvento` con fallback a `codigo`; cambio aditivo al schema `Reserva` del contrato — tres campos opcionales sin romper consumidores; sin migración de esquema; lectura pura sin mutación).*

*Documento de arquitectura v4.9, 06/07/2026. Cambios respecto a v4.8: refleja US-044 — Dashboard Operativo (UC-34): añade §2.16 (módulo `dashboards` — endpoint `GET /dashboard`; 7 widgets agregados `hoyManana`, `pipeline`, `subProcesosCriticos`, `pendientes`, `consultasEnCola`, `visitasProgramadas`, `proximos30Dias`; `DashboardItem.fechaEvento` nullable en contrato + SDK + backend + frontend; arquitectura hexagonal interna — `domain/` con `ClockPort` inyectable + función pura `color-dashboard.ts`, `application/` use-case `ConsultarDashboardUseCase`, `infrastructure/` adaptador Prisma + adaptador de reloj real, `interface/` controller + DTO; frontend `apps/web/src/features/dashboard/` Bulletproof React con `useDashboard`, `DashboardPage`, `WidgetCard`, `DashboardSkeleton`, `DashboardError` — responsive 1/2/3 columnas móvil/md/lg; Dashboard en posición 1 del sidebar, landing post-login sigue siendo `/calendario`; lectura pura sin migración de esquema).*

*Documento de arquitectura v4.8, 04/07/2026. Cambios respecto a v4.7: refleja US-026 — Cierre Automático de Ficha Operativa en T-1d (automatización A10): amplía §2.5 (Procesos asíncronos) con el segundo barrido periódico concreto (`POST /cron/barrido?tarea=fichas`, auth `X-Cron-Token`/`CronTokenGuard` diario 01:00, selección cross-tenant por `date(fecha_evento) = date(hoy)+1` de calendario, mutaciones bajo `SET LOCAL app.tenant_id`, `SELECT … FOR UPDATE` + re-evaluación de guarda por RESERVA, triplete `FICHA_OPERATIVA.ficha_cerrada=true + fecha_cierre + RESERVA.pre_evento_status→cerrado`, `AUDIT_LOG usuario_id=NULL causa=A10`, fallo aislado por RESERVA, resumen `{ fichas: { candidatas, fichasCerradas, fallos } }`, idempotencia, sin email al cliente, sin migración de esquema, coordinación con cierre manual US-025 por `SELECT … FOR UPDATE` endurecido en el UoW manual).*

*Documento de arquitectura v4.7, 04/07/2026. Cambios respecto a v4.6: refleja US-028 — Gestor Aprueba y Envía la Factura de Liquidación (UC-21 / UC-22): añade §2.15 (capability M12 Facturación — emisión atómica de liquidación y fianza) documentando: tres nuevos use cases (`AprobarYEnviarLiquidacionUseCase`, `EnviarReciboFianzaUseCase`, `ReenviarLiquidacionUseCase`) con sus endpoints bajo `/reservas/{id}/facturas/`; patrón D-1 de atomicidad síncrona estado↔E4 como excepción documentada al post-commit de US-045 (rollback total si E4 falla; `FakeEmailAdapter` en test/CI para cubrir la misma semántica sin red); campo `esReenvio Boolean @default(false)` en `Comunicacion` (migración D-4) y actualización del predicado del índice UNIQUE parcial de US-045 (`AND es_reenvio = false`); descuento negociado D-2 (`aplicarDescuentoLiquidacion` en dominio puro, reutiliza `calcularDesgloseFiscal` de US-022, actualiza `RESERVA.importe_liquidacion`); envío separado D-3 (`codigo_email='manual'`, sin colisión con idempotencia E4); regla de no-sobreescritura de `fianza_status` cuando la fianza ya se envió por separado; módulo backend (6 nuevos adaptadores de infraestructura; sin nuevas columnas en FACTURA ni RESERVA). Actualiza §2.9 DT-EMAIL-02: marca E4 como RESUELTA (04/07/2026) con descripción del modo síncrono y los tres endpoints de facturación.*
*Documento de arquitectura v4.6, 04/07/2026. Cambios respecto a v4.5: refleja US-022 — Generar Factura de Señal al Confirmar Reserva (UC-18): añade §2.14 (capability M12 Facturación) documentando: módulo backend `apps/api/src/facturacion/` (hexagonal, domain/application/infrastructure/interface); patrón "efecto post-commit" — la creación de la FACTURA ocurre tras el commit de US-021, fuera de la transacción crítica `FOR UPDATE`, con la misma separación de capabilities que PDF+E2 en US-014; función pura `calcularDesgloseFiscal` (`base = round(total/1.21,2)`; `iva = total − base` por resta sin doble redondeo); numeración `F-YYYY-NNNN` con `MAX(NNNN)+1` y retry-on-conflict ante `P2002` en `UNIQUE(tenant_id, numero_factura)` (nunca locks distribuidos); idempotencia `findByReservaIdAndTipo + UNIQUE(reservaId, tipo)`; adaptador PDF FAKE determinista en MVP; tabla de endpoints (consultar/aprobar/rechazar/regenerar-pdf) con precondiciones y efectos; migración de constraints (sustitución de `@unique` global por `@@unique([tenantId, numeroFactura])` + adición de `@@unique([reservaId, tipo])`); nota de actualización de DT-EMAIL-02 (E3 se cablea en US-023, no en US-022).*
*Documento de arquitectura v4.5, 03/07/2026. Cambios respecto a v4.4: refleja US-019 — promoción manual de consulta en cola (UC-12 flujo B): añade bloque `US-019` en §2.4 documentando `PromoverManualEnColaService` (locus de lock sobre `FECHA_BLOQUEADA` a diferencia de US-018; expiración forzosa de la bloqueante `2b/2c/2v → 2x`; re-asignación de la fila por UPDATE respetando `UNIQUE(tenant_id, fecha)`; reordenación por cierre de hueco; endpoint `POST /reservas/{id}/promover` con `{ confirmado: true }`; política de arbitraje FIFO estricto + primer lock, 409 al Gestor si pierde la carrera; sin migración de esquema); actualiza D-6 de US-018 indicando que US-019 ya está implementada y describe su locus de lock propio.*
*Documento de arquitectura v4.4, 01/07/2026. Cambios respecto a v4.3: refleja US-018 — promoción automática de cola (UC-12): añade bloque `US-018` en §2.4 documentando el cierre del seam `PromocionColaPort` (sustitución del stub no-op por `PromocionColaPrismaAdapter`); describe la mecánica A15 en transacción única (lock sobre RESERVA `2d`, guarda "ya promovida", función pura `resolverPromocionCola`, re-bloqueo vía `bloquearFecha()`, reordenación FIFO, alerta interna al gestor); documenta el punto de serialización real (`SELECT … FOR UPDATE` sobre RESERVA `2d`, no sobre `FECHA_BLOQUEADA` que ya no existe); registra D-5 (sin email al cliente; US-044 diferida) y D-6 (FIFO + primer lock; coordinación con US-019 vía la guarda); actualiza el bloque de `liberarFecha()` y §2.12 para reflejar el adaptador real en lugar del stub.*
*Documento de arquitectura v4.3, 01/07/2026. Cambios respecto a v4.2: actualiza §2.12 — scheduler del módulo `cron` pasa de `@Cron('*/5 * * * *')` estático a registro dinámico vía `SchedulerRegistry` en `onModuleInit`; expresión por defecto `'0 * * * *'` (cada hora), configurable con `CRON_BARRIDO_EXPIRACION`; si `CRON_TOKEN` está ausente el disparo automático se desactiva; latencia máxima de liberación de fecha vencida ahora ~1 h; añade tabla de variables de entorno del módulo cron (`CRON_TOKEN`, `CRON_BARRIDO_EXPIRACION`).*
*Documento de arquitectura v4.2, 01/07/2026. Cambios respecto a v4.1: refleja US-012 — barrido de expiración por TTL (UC-09): amplía §2.5 (Procesos asíncronos) con descripción del primer barrido concreto materializado (`POST /cron/barrido-expiracion`, auth `X-Cron-Token`/`CronTokenGuard`, lectura cross-tenant, mutaciones bajo `SET LOCAL app.tenant_id`); añade §2.12 (módulo `cron`: arquitectura hexagonal interna, mapa declarativo `MAPA_EXPIRACION_TTL`/`resolverExpiracionTtl`, transiciones `2b/2c/2v → 2x` y `pre_reserva → reserva_cancelada`, liberación idempotente por `liberarFecha()` causa TTL, seam `PromocionColaPort` exactamente-una-vez stub hasta US-018, idempotencia D-4, fallo aislado por RESERVA, `BarridoExpiracionResponse`, sin migración de esquema).*
*Documento de arquitectura v4.1, 30/06/2026. Cambios respecto a v4.0: añade §2.11 (módulo M2 Calendario — US-039, UC-29): endpoint `GET /calendario` (query `desde`/`hasta`/`vista`; respuesta `CalendarioResponse` con `rango` + `fechas[]` agregadas por fecha ocupada; 401/422); arquitectura interna hexagonal (`domain/` función pura `derivarColor` como tabla de datos + puerto de consulta; `application/` use-case `obtener-calendario`; `infrastructure/` adaptador Prisma con RLS; `interface/` controller); derivación del color canónico (SlotifyGeneralSpecs §11.3) como tabla declarativa; indicador `🔁 N en cola` calculado en backend; multi-tenancy + RLS; frontend `apps/web/src/features/calendario/` con react-big-calendar como página de inicio del App Shell, responsive 390/768/1280; sin migración de esquema (lectura pura de `RESERVA` y `FECHA_BLOQUEADA`).*
*Documento de arquitectura v4.0, 30/06/2026. Cambios respecto a v3.9: refleja US-007 — transición `2.b → 2.c` (UC-06): documenta en §2.4 las extensiones del núcleo crítico: guarda de origen declarativa `{consulta, 2b} → {consulta, 2c}` en `maquina-estados.ts`; extensión atómica del TTL con `resolverPlanBloqueo({ fase: '2.c' })` (UPDATE de `FECHA_BLOQUEADA`, no INSERT); vaciado atómico de la cola A16 (`2.d → 2.y`) en la misma transacción serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante; atomicidad all-or-nothing de las cuatro operaciones; auditoría dual (RESERVA principal + cada descartada); sin migración; gap de spec D-7 (email UC-06 paso 7 sin E-code, fuera de alcance MVP, abierto a decisión del PO); nuevo endpoint `POST /reservas/{id}/pendiente-invitados` (200/409/422/404).*
*Documento de arquitectura v3.9, 29/06/2026. Cambios respecto a v3.8: (1) refleja US-045 — motor de email automático M10 Comunicaciones (UC-35): actualiza §2.3 (fila Email) con motor hexagonal `DespacharEmailService`, adaptadores `ResendEmailAdapter`/`FakeEmailAdapter`, catálogo de plantillas y variables de entorno (`EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SANDBOX`); marca DT-EMAIL-01 como RESUELTA en §2.9 (cableado E1 real, regresión cero US-003/004); añade DT-EMAIL-02 en §2.9 (deuda de cableado E2–E8 con mapa E→US: E2→US-014, E3→US-021/022/023, E4→US-027/028, E5→US-034, E6→US-008, E7→US-009, E8→US-035; adjuntos PDF, recordatorios y envío manual US-046 diferidos); añade §2.10 (módulo M10 Comunicaciones: arquitectura interna, flujo del motor, integración E1, catálogo+i18n, variables de entorno, idempotencia + migración índice UNIQUE parcial `20260628120000_us045_comunicacion_idempotencia_indice`). (2) Endurecimiento del default de `EMAIL_SANDBOX` (Bj3 resuelta): unset → sandbox activo; solo `EMAIL_SANDBOX=false` explícito habilita el envío real; actualiza fila `EMAIL_SANDBOX` en §2.10 con el default seguro y la dirección de prueba `delivered@resend.dev`; añade Bj3 como RESUELTA en §2.9 (doble barrera: zod env-validation + wiring de módulo; 3 tests nuevos). Integración del motor con el alta US-003/US-004: la fila COMUNICACION E1 nace en `borrador` dentro de la transacción del alta y se promueve post-commit vía `DespacharEmailService.finalizarEnvio`, incorporando la tarifa estimada de US-004 en el cuerpo.*
*Documento de arquitectura v3.8, 28/06/2026. Cambios respecto a v3.7: refleja US-004 — alta de consulta con fecha (UC-03): documenta en §2.4 las extensiones del núcleo crítico: `bloquearEnTx` (atomicidad RESERVA+FECHA_BLOQUEADA), `determinarAltaConFecha` (tabla declarativa en máquina de estados, entradas `2b`/`2d`), `TarifaEstimadaPort` (tolerante a errores, no persistida), concurrencia D4 (retry + SELECT FOR UPDATE + índice UNIQUE parcial D-8), y divergencia intencional `fecha_evento > hoy` (Gate 1, decisión A) con trazabilidad a `design.md §D-1`.*
*Documento de arquitectura v3.7, 28/06/2026. Cambios respecto a v3.6: añade DT-CODIGO-01 en §2.9 (deuda resuelta: generación atómica del `codigo` correlativo con retry-on-conflict en `UnidadDeTrabajoPrismaAdapter`; 409 propagado vía `HttpExceptionFilter` global para toda colisión UNIQUE, incluido `reserva_codigo_key`; controlador ya no enmascara errores como 500). v3.6: refleja US-003 — alta de consulta exploratoria (UC-03): actualiza §2.3 (fila Email) para documentar `EnviarEmailPort` en `comunicaciones/domain/` con adaptador stub activo desde US-003 y transporte real diferido a US-045; añade DT-EMAIL-01 en §2.9 (adaptador stub no-op, diferido a US-045). v3.5: actualiza §2.8 con la implementación real de US-001 (módulo auth hexagonal — domain/application/infrastructure/interface; puertos consolidados en application/; argon2; anti-enumeration 401 genérico uniforme sin auditar fallos; throttler self-contained en memoria 5/60s sin `@nestjs/throttler`; `AuditLogPort` compartido en `shared/audit/`; cookie refresh con atributos condicionales prod/dev); añade §2.9 con la tabla de deuda técnica registrada (DT-AUTH-01 refresh stateless, DT-AUTH-02 multi-device diferido, DT-AUTH-03 throttler por proceso, DT-AUTH-04 codegen .d.ts). v3.4 documentó US-041 en §2.4 (`liberarFecha()`). v3.3 documentó US-040 en §2.4: mapa canónico fase→(tipo,TTL,modo) declarativo, check constraints `chk_firme_sin_ttl`/`chk_blando_con_ttl`, errores de dominio tipados en español y decisión D-7. v3.2 cerró el diseño de autenticación (JWT access+refresh, §2.8) y los dos niveles de administración. v3.1 separó monorepo de despliegue. v3.0 invirtió el orden y añadió prompts y análisis de coste. v2.0 reclasificó la arquitectura AWS como objetivo de producción.*
*Documento de arquitectura v3.6, 28/06/2026. Cambios respecto a v3.5: refleja US-002 en §2.8 — marca la implementación como "US-001 y US-002 completadas"; documenta `POST /auth/logout` con comportamiento final (`@Public()`, cookie opcional, idempotente, auditoría condicional con `AUDIT_LOG accion=logout`, no-anonimato, acceso 200/204 siempre sin 401); añade bloque "Cierre de sesión en el shell" (US-002: botón en pie del sidebar/drawer `<lg`, modo degradado ante error de red); actualiza DT-AUTH-01 en §2.9 reflejando que US-002 ratificó el enfoque stateless/best-effort y la invalidación real queda diferida post-MVP. v3.5 actualizó §2.8 con la implementación real de US-001 y añadió §2.9 con la tabla de deuda técnica. v3.4 documentó US-041 en §2.4 (`liberarFecha()`). v3.3 documentó US-040 en §2.4. v3.2 cerró el diseño de autenticación (JWT access+refresh, §2.8) y los dos niveles de administración. v3.1 separó monorepo de despliegue. v3.0 invirtió el orden y añadió prompts y análisis de coste. v2.0 reclasificó la arquitectura AWS como objetivo de producción.*
