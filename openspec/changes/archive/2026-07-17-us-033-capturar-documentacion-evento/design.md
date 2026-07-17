# Design — us-033-capturar-documentacion-evento (US-033)

Decisiones técnicas no triviales de la captura de la documentación obligatoria del evento.
Cada decisión cita el código/spec vivos que la fundamentan. Todas las funciones nombradas se
escriben como **arrow functions** (regla dura). El dominio no importa framework/infra (hook
`no-infra-in-domain`).

## Grounding del código/modelo actual (verificado)

- **Enum `TipoDocumento`** (`schema.prisma` ~L139) **ya incluye** `dni_anverso`,
  `dni_reverso`, `clausula_responsabilidad` (además de `condiciones_particulares`,
  `justificante_pago`, `presupuesto`, `factura`, `otro`). **No hay migración de enum.**
- **Modelo `Documento`** (`schema.prisma` ~L603) ya tiene todos los campos:
  `idDocumento`, `tenantId`, `reservaId?`, `tipo`, `nombreArchivo`, `url`, `mimeType`,
  `tamanoBytes?`, `fechaCreacion`, con relaciones a `Tenant` y `Reserva`. **No hay migración
  de tabla.** La tabla **no** impone unicidad por `(reserva_id, tipo)` → conviven múltiples
  documentos del mismo tipo (base de la no-idempotencia, N3).
- **Patrón multipart vivo (US-021)**: `POST /reservas/{id}/confirmar-senal`
  (`apps/api/src/confirmacion/interface/confirmar-pago-senal.controller.ts`) usa
  `FileInterceptor`, `@ApiConsumes('multipart/form-data')`, mapea el fichero multer a un VO de
  dominio, valida mime whitelist `{image/jpeg, image/png, application/pdf}` / tamaño / fichero
  ausente en el use-case, y crea `DOCUMENTO` en la misma tx. Errores de dominio:
  `FormatoNoPermitidoError`, `TamanoExcedidoError`, `JustificanteRequeridoError`, etc.,
  mapeados a 422.
- **Almacén de documentos durable (épico #6)**: `AlmacenDocumentosPort.subir(bytes, clave)` /
  `obtener(clave)` / `urlPublica(clave)` en `apps/api/src/documentos/domain/
  almacen-documentos.port.ts`; adaptador `local` **durable a disco**
  (`almacen-documentos-local.adapter.ts`) seleccionable por env `ALMACEN_PROVIDER`, clave con
  `tenant_id`, sin credenciales cloud en tests.
- **Repositorio de `DOCUMENTO` (US-023)**: `apps/api/src/documentos/domain/
  documento.repository.port.ts` con `buscarPorReservaYTipo` (idempotencia) + `crear`, **pero
  hoy está tipado SOLO para `tipo: 'condiciones_particulares'`** (literal en la interfaz).
- **`AUDIT_LOG`**: patrón `accion / entidad / datos_anteriores / datos_nuevos` con el usuario
  del Gestor.
- **Máquina de estados (US-006, US-024)**: precedente vivo de operaciones que mutan/crean
  entidades **sin transicionar** `estado`, gobernadas por una **guarda de precondición
  declarativa** por estado (no una transición del grafo).

---

## D-capability — Capability nueva `documentacion-evento`

**Decisión: el spec-delta vive en una capability NUEVA `documentacion-evento`, no en
`documentos`, `ficha-operativa` ni `confirmacion`.**

- **Por qué no `documentos`**: esa capability modela la **generación** de PDFs por tenant
  (plantilla react-pdf, config del tenant, condicions particulars, facturas) y el **puerto de
  almacén**. US-033 es **captura/subida** de documentos del cliente asociados a una reserva y
  su checklist — otro dominio. Sí **reutiliza** el puerto de almacén de `documentos`, pero no
  amplía sus requirements (el contrato del puerto no cambia).
- **Por qué no `ficha-operativa`**: aunque US-033 pertenece al módulo M7 (Slotify Brief), la
  capability `ficha-operativa` modela la entidad `FICHA_OPERATIVA` (campos de contenido,
  cierre, `ficha_cerrada`). La documentación del evento son filas `DOCUMENTO`, no campos de la
  ficha; mezclarlas acoplaría dos ciclos de vida distintos. Se mantiene separada y coherente
  con cómo US-024 alojó su flujo en su propia capability de flujo (`confirmacion`) en vez de
  en `documentos`.
- **Por qué no `confirmacion`**: `confirmacion` gira alrededor de la señal y el paso
  `pre_reserva → reserva_confirmada`. US-033 ocurre en `evento_en_curso` y es semánticamente
  distinta.
- **Consecuencia**: `documentacion-evento` es el hogar del concepto "documentación obligatoria
  del evento + checklist". Futuras USs (p. ej. la advertencia de US-034 al finalizar) pueden
  referenciar su señal de checklist sin re-modelarla.

**Alternativa descartada**: añadir requirements a `ficha-operativa`. Rechazada por acoplar la
entidad FICHA_OPERATIVA (contenido/cierre) con las filas DOCUMENTO del evento, dos ciclos de
vida y dos guardas de estado distintas (`{reserva_confirmada, evento_en_curso, post_evento}`
para la ficha vs. solo `evento_en_curso` para la subida).

---

## D-endpoints — Endpoints dedicados de subida y de checklist

**Decisión: dos endpoints nuevos y dedicados bajo `/reservas/{id}/documentos-evento`, sin
reutilizar `confirmar-senal` ni el update genérico de la reserva.**

- **Subida**: `POST /reservas/{id}/documentos-evento` (multipart/form-data, `@Roles('gestor')`,
  `@HttpCode(201)`) con un campo binario obligatorio (`archivo`) y un campo `tipo`
  (`dni_anverso` | `dni_reverso` | `clausula_responsabilidad`). Coherente con el patrón de
  `confirmar-senal` (controller traduce el fichero multer a un VO de dominio; el use-case
  valida). Respuestas: **201** (DOCUMENTO creado + checklist actualizado); 400 forma;
  401/403 auth; 404 reserva inexistente/cross-tenant; **422** estado no permitido / tipo no
  permitido / fichero ausente / formato no permitido / archivo vacío o corrupto / tamaño
  excedido.
- **Checklist**: `GET /reservas/{id}/documentos-evento/checklist` (`@Roles('gestor')`) → 200
  con `{ items: [{ tipo, completado, documento? }] }`. Consultable para pintar el estado en
  tiempo real.
- **Por qué 201 en la subida** (no 200 como `confirmar-senal`): `confirmar-senal` **actualiza**
  la reserva (transición); aquí se **crea** un recurso `DOCUMENTO` nuevo → 201 es el código
  semánticamente correcto para creación. El cuerpo incluye el checklist para ahorrar un
  round-trip en el frontend.
- **Naming de ruta**: `documentos-evento` (plural del recurso) coherente con
  `/reservas/{id}/...` de acción/recurso del proyecto (`confirmar-senal`,
  `condiciones-firmadas`). El sufijo `/checklist` sobre el mismo recurso expresa la proyección
  agregada.

**Alternativa descartada**: `PATCH /reservas/{id}` con el fichero en el cuerpo. Rechazada por
mezclar una acción de negocio con efectos/auditoría propios con el update genérico; el proyecto
usa endpoints de acción/recurso dedicados.

**Alternativa descartada**: un endpoint por tipo (`.../dni-anverso`, etc.). Rechazada por
triplicar rutas equivalentes; el `tipo` como campo del multipart es más simple y el contrato
lo valida por enum.

---

## D-documento-repo — Generalizar el `DocumentoRepositoryPort` vs. crear uno propio

**Decisión: GENERALIZAR el puerto de dominio de persistencia de `DOCUMENTO` existente
(`documentos`, US-023) para que `tipo` admita el enum completo `TipoDocumento` en vez del
literal `'condiciones_particulares'`; NO se crea un puerto paralelo.**

- **Estado actual**: `DocumentoRepositoryPort.crear` y `buscarPorReservaYTipo` y la proyección
  `DocumentoPersistido` tipan `tipo` como el **literal** `'condiciones_particulares'`. US-033
  necesita `crear` con `tipo ∈ {dni_anverso, dni_reverso, clausula_responsabilidad}` y una
  operación de **listado por reserva** para el checklist.
- **Qué se generaliza (compatible hacia atrás)**:
  - Ampliar el tipo de `tipo` de un literal a un **union type de dominio** (declarado en
    `documentos`, alineado con `TipoDocumento` de Prisma pero **sin importar Prisma** en el
    puerto): p. ej. `TipoDocumentoDominio`. US-023 sigue pasando
    `'condiciones_particulares'` (subconjunto válido); no rompe.
  - Añadir un método de **listado** `listarPorReservaYTipos({ reservaId, tenantId, tipos })`
    (o `listarPorReserva`) que devuelva las filas ordenadas por `fechaCreacion` desc, para
    construir el checklist (el más reciente por tipo + existencia). RLS por `tenant_id`.
  - `crear` deja de forzar el literal; el resto de su firma se mantiene.
- **Por qué generalizar y no un puerto nuevo**: evita duplicar dos adaptadores Prisma casi
  idénticos sobre la misma tabla `documento`; mantiene un único punto de verdad de persistencia
  de DOCUMENTO en la capability `documentos`. El cambio es **aditivo/relajante** de tipos: no
  altera el comportamiento idempotente que US-023 usa (US-023 seguirá llamando primero a
  `buscarPorReservaYTipo`; US-033 **no** lo llama).
- **No-idempotencia de US-033**: US-033 invoca directamente `crear(...)` sin
  `buscarPorReservaYTipo` (a diferencia de US-023). La idempotencia de US-023 es una **decisión
  del use-case** (buscar-antes-de-crear), no una restricción del puerto ni de la tabla; por eso
  generalizar el puerto no compromete la unicidad del documento de condiciones.
- **Hexagonal**: el puerto sigue **PURO** (sin `@nestjs`, sin Prisma). El union type de dominio
  se declara en `documentos/domain`. El adaptador Prisma (infra) mapea al enum de Prisma.

**Alternativa descartada**: crear un `DocumentoEventoRepositoryPort` propio en
`documentacion-evento`. Rechazada por duplicar adaptador y consultas sobre la misma tabla; la
generalización es de bajo riesgo (relajación de tipos + un método de lectura aditivo) y deja un
único repositorio de DOCUMENTO reutilizable.

> **Nota de guardarraíl (memoria del proyecto):** el hook `require-tests-first` obliga a
> escribir primero los tests de `domain/`/`application/`. La generalización del puerto y el
> use-case nuevos entran en TDD-RED antes de tocar implementación.

---

## D-checklist — Semántica del checklist (existencia ≥ 1 por tipo, más reciente como referencia)

**Decisión: el checklist se calcula por lectura, no se materializa.**

- Para cada uno de los tres tipos obligatorios, `completado = existe ≥ 1 DOCUMENTO de ese
  `tipo` + `reservaId` bajo RLS`. `documento` (opcional) es el **más reciente** por
  `fechaCreacion` (referencia para mostrar/descargar).
- No se persiste ningún estado de checklist agregado en la reserva: se **deriva** de las filas
  `DOCUMENTO` en cada lectura (N2) y se devuelve también en la respuesta de la subida (N1) para
  refresco en tiempo real. Esto evita un campo redundante que podría desincronizarse con las
  filas.
- Consecuencia de la no-idempotencia (N3/D-no-idempotencia): re-subir el mismo tipo no cambia
  `completado` (ya era `true`) pero sí cambia el `documento` de referencia al más reciente.

---

## D-no-idempotencia — Re-subida crea fila nueva, conserva histórico

**Decisión: cada subida crea una fila `DOCUMENTO` nueva; NO se busca-antes-de-crear ni se
sobrescribe.**

- La US exige explícitamente conservar el histórico ("el registro anterior se conserva en la
  tabla DOCUMENTO — trazabilidad"). Por eso US-033 llama a `crear(...)` directamente, sin
  `buscarPorReservaYTipo`.
- **Contraste con US-023**: el DOCUMENTO de condiciones es único por reserva (idempotente,
  busca-antes-de-crear en el use-case); el DOCUMENTO de evento es versionable (no idempotente).
  Conviven porque la tabla no impone unicidad por `(reserva_id, tipo)`.

---

## D-almacenamiento — Clave de almacén por reserva + tipo + versión (durable)

**Decisión: los bytes se persisten por el `AlmacenDocumentosPort` (adaptador durable `local`
por env), con una clave que admite múltiples versiones y aísla por tenant.**

- Propuesta de clave: **`documentos-evento/{tenantId}/{reservaId}/{tipo}/{uuid}.{ext}`**
  (extensión derivada del mime). Incluye `tenant_id` (aislamiento), `reserva_id` y `tipo`
  (agrupación), y un discriminador `uuid` para no sobrescribir versiones anteriores (histórico
  de binarios preservado, coherente con D-no-idempotencia).
- La `url` almacenada en `DOCUMENTO.url` es la que devuelve `subir`. Se usa el adaptador
  **durable a disco** (no el fake efímero del justificante), preferible para documentación
  legal.

**Alternativa descartada**: clave fija por reserva+tipo sobrescribible. Rechazada porque
perdería el binario de las versiones anteriores que la US pide conservar.

---

## D-no-transicion — La subida no transiciona estado; guarda de precondición por estado

**Decisión: la subida es una `accion='crear'` de un DOCUMENTO, NO una transición de la máquina
de estados; `RESERVA.estado` y los sub-procesos permanecen intactos.**

- La única guarda de estado es de **disponibilidad**: la subida solo se admite en
  `estado = evento_en_curso` (a diferencia de US-024, que aceptaba tres estados). Se implementa
  como **guarda de precondición declarativa** (p. ej.
  `esEstadoQuePermiteDocumentacionEvento(estado)`), análoga a las de US-006/US-024, no como una
  transición del grafo de `maquina-estados.ts`.
- El **checklist (GET)** es más permisivo: se puede consultar aunque la reserva ya esté en
  `post_evento` (para mostrar pendientes tras finalizar, FA-01). Solo la **escritura** exige
  `evento_en_curso`.
- `AUDIT_LOG accion='crear'`, `entidad='DOCUMENTO'` (nunca `'transicion'`).

**Alternativa descartada**: añadir una transición no-op a `maquina-estados.ts`. Rechazada por
ensuciar el grafo con transiciones ficticias sin cambio de estado.

---

## D-fa01-alcance — Documentación incompleta no bloquea; sin cron

**Decisión: US-033 entrega la señal consultable (checklist), pero NO la transición a
`post_evento` ni la advertencia al finalizar el evento ni ningún cron.**

- El checklist (N2) expone los pendientes; el frontend puede mostrar una alerta **informativa
  no bloqueante**. La documentación incompleta **no** impide la transición a `post_evento`.
- La transición a `post_evento` y su advertencia de documentación pendiente son de **US-034**
  (finalizar evento), fuera de este lote. No se crea ningún endpoint `/cron/...` ni barrido
  (coherente con la nota del proyecto "barridos nuevos → endpoint dedicado": aquí no toca).

---

## D-validacion-servidor — Validación autoritativa en servidor (formato + tamaño + vacío)

**Decisión: aunque el frontend valida el formato antes de enviar (UX), el servidor **repite y
es autoritativo**.**

- `mimeType ∈ {image/jpeg, image/png, application/pdf}`; rechazo con
  `FormatoNoPermitidoError` → 422.
- `tamanoBytes > 0` (rechazar vacío/corrupto en servidor) y ≤ 10 MB → error específico → 422.
- Fichero ausente → error específico → 422.
- El `tipo` recibido debe pertenecer al enum de tipos obligatorios → 422 si no.
- En cualquier rechazo: **no** se sube al almacén, **no** se crea `DOCUMENTO`, **no** se
  registra `AUDIT_LOG`.

---

## Hexagonal / guardrails

- El dominio (use-case de subida, guarda de precondición, puertos, VO del fichero) NO importa
  Prisma ni `@nestjs/*` (hook `no-infra-in-domain`). Adaptadores en `infrastructure/`.
- **Sin locks distribuidos** (no aplica bloqueo de fecha; no toca `FECHA_BLOQUEADA`; hook
  `no-distributed-lock`).
- **RLS multi-tenant**: la reserva se carga bajo RLS (404 cross-tenant); `DOCUMENTO.tenant_id`
  y la clave de almacén incluyen el tenant activo del JWT; el checklist filtra por `tenant_id`.
- El **cliente HTTP del frontend se regenera** desde el contrato; nunca se edita a mano
  (hook `protect-generated-client`). Los endpoints nuevos los añade `contract-engineer`.
- **Frontend responsive** mobile-first (regla dura); checklist y subida funcionan en
  390 / 768 / 1280; navegación colapsa a drawer en `<lg`; estructura por dominio
  (`features/<dominio>/`, barrel), `components/` solo `.tsx`.
- **Arrow functions** en todo el código nombrado.

---

## Cuestiones para el Gate 1 (a confirmar por el humano)

1. **Capability nueva `documentacion-evento`** (D-capability): ¿conforme con abrir una
   capability propia en vez de ampliar `ficha-operativa`?
2. **Generalizar `DocumentoRepositoryPort`** (D-documento-repo): ¿conforme con relajar el
   literal `'condiciones_particulares'` a un union de dominio y añadir un método de listado,
   en vez de crear un repositorio paralelo?
3. **201 vs 200 en la subida** (D-endpoints): propuesto **201** (creación de recurso). ¿OK, o
   se prefiere 200 por consistencia estética con `confirmar-senal`?
4. **Naming de ruta y campos** (D-endpoints): propuestos
   `POST /reservas/{id}/documentos-evento` (campos multipart `archivo` + `tipo`) y
   `GET /reservas/{id}/documentos-evento/checklist`. ¿Otro naming preferido?
5. **Alcance del estado del checklist GET** (D-no-transicion): el GET es consultable también en
   `post_evento` (para mostrar pendientes tras finalizar). ¿Se restringe solo a
   `evento_en_curso`?
