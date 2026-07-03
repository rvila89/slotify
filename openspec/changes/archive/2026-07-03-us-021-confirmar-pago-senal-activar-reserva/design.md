# Design — us-021-confirmar-pago-senal-activar-reserva

> Decisiones técnicas no triviales de la confirmación del pago de la señal (transición
> `pre_reserva → reserva_confirmada`). Todas quedan **abiertas hasta el OK del Gate SDD**.
> Trazabilidad: US-021, UC-17; `er-diagram.md`; `CLAUDE.md`.

## Contexto

US-021 cierra el tramo previo al evento: eleva la RESERVA de `pre_reserva` a
`reserva_confirmada`, convierte el bloqueo blando en **firme sin TTL**, congela los
importes de señal/liquidación e inicializa los agregados operativos (DOCUMENTO
justificante + FICHA_OPERATIVA + tres sub-procesos). El cimiento ya está en `master` (mapa
canónico de bloqueo con fase `reserva_confirmada`, máquina de estados declarativa,
`importe_total` fijado en US-014); este change **reutiliza** esas primitivas y añade el
use-case orquestador.

## D-1 — Nueva capability `confirmacion` vs extender `consultas`

**Decisión (recomendada): crear la capability `confirmacion`.** Los agregados DOCUMENTO
(gestión documental polimórfica) y FICHA_OPERATIVA (1:1 con la RESERVA, datos operativos
del evento) son un **dominio propio** que crecerá con UC-18 (factura de señal), UC-19
(condiciones particulares) y UC-20/21/22 (sub-procesos operativos). Mantenerlo separado de
`consultas` (ciclo de vida del lead/RESERVA) preserva la cohesión y evita sobredimensionar
`consultas`, exactamente como US-014 separó `presupuestos`. La **transición de estado** de
la RESERVA (agregado RESERVA) permanece en `consultas`.

- **Alternativa descartada**: meter todo en `consultas`. Rompería la cohesión y mezclaría
  el ciclo de vida del lead con la gestión documental/operativa.
- **Coordinación**: ambos deltas (`consultas` + `confirmacion`) se ejecutan en **una sola
  transacción** en el use-case de UC-17 (`ConfirmarPagoSenalUseCase`). El módulo backend
  puede ser `apps/api/src/confirmacion/**` o un par `documentos/` + `fichas-operativas/`;
  la ubicación exacta se decide en la fase de implementación respetando la arquitectura
  hexagonal (dominio sin infraestructura).

## D-2 — Upgrade a firme reutilizando `bloquearFecha(fase='reserva_confirmada')`

**Decisión: reutilizar la primitiva atómica de US-040, no reimplementar el bloqueo.** El
mapa canónico de `bloqueo-fecha` ya declara `reserva_confirmada → {tipo_bloqueo = 'firme',
ttl_expiracion = NULL, modo = upgrade}`, y la spec de esa capability ya cubre el requisito
"Upgrade de bloqueo blando a firme al confirmar" (UPDATE de la fila existente, sin alterar
`reserva_id`), su idempotencia por `reserva_id` y las race conditions. Por eso **no se crea
delta de `bloqueo-fecha`**.

- El upgrade es un **UPDATE** (`tipo_bloqueo = 'firme'`, `ttl_expiracion = NULL`), **nunca
  `DELETE + INSERT`** (`er-diagram.md §upgrade blando→firme`), para conservar la identidad
  de la fila y su `reserva_id`.
- Los constraints de BD `chk_firme_sin_ttl` (firme ⟹ ttl NULL) y `chk_blando_con_ttl` son
  la red de seguridad; el use-case no debe poder dejar una fila firme con TTL.
- **Regla dura**: la serialización es de PostgreSQL (`SELECT … FOR UPDATE` +
  `UNIQUE(tenant_id, fecha)`). **Nunca Redis/Redlock** (hook `no-distributed-lock`).

## D-3 — Cálculo y congelado de importes

**Decisión: `importe_senal = round(importe_total × pct_senal / 100, 2)` y
`importe_liquidacion = importe_total − importe_senal`.** Calcular la liquidación como el
**complemento** (resta) en lugar de `× (100 − pct_senal)` garantiza que
`importe_senal + importe_liquidacion = importe_total` **exactamente**, sin desajuste de
céntimos por redondeo doble.

- `pct_senal` se lee de `TENANT_SETTINGS` en el momento de confirmar (**nunca
  hardcodeado**; 40,00 en MVP). El desglose 40/60 del ejemplo (3.000 → 1.200/1.800) es
  consecuencia del setting, no una constante.
- El cálculo usa `RESERVA.importe_total` fijado en la pre-reserva (US-014). No se recalcula
  tarifa (el presupuesto ya está congelado).
- Precondición `importe_total > 0`: si fuera 0/NULL, la confirmación se rechaza (no hay
  presupuesto aceptado válido).

## D-4 — Idempotencia de FICHA_OPERATIVA

**Decisión: idempotencia por `reserva_id @unique` + guarda "si existe, no crear" dentro de
la transacción.** La relación 1:1 la impone el índice único (`er-diagram.md §3.14`). El
use-case comprueba la existencia (`findByReservaId`) antes de insertar; el índice único es
la red de seguridad ante carreras. Un reintento o un estado inconsistente previo **no
duplica** la ficha y **no aborta** la transición.

- La ficha se crea **vacía**: todos los campos de contenido a `NULL`, `ficha_cerrada =
  false`. El checklist pre-evento y el llenado de la ficha son de UC-20 (fuera de alcance).

## D-5 — Subida y almacenamiento del justificante

**Decisión: validación en servidor de `mime_type ∈ {image/jpeg, image/png,
application/pdf}` y tamaño ≤ 10 MB antes de persistir; almacenar y guardar
`DOCUMENTO.url` + `mime_type`.** La validación de formato/tamaño se hace también en cliente
(UX), pero la **autoritativa es la del servidor**. El fichero se sube por `multipart/
form-data`; el proveedor de almacenamiento (mismo que el resto de DOCUMENTO del proyecto)
devuelve la `url` que se persiste.

- El DOCUMENTO se crea en la **misma transacción** que la transición (all-or-nothing): si
  la transición falla, no queda un justificante huérfano. La subida física del binario al
  almacenamiento puede ocurrir antes del commit de BD; en caso de rollback, se acepta un
  fichero huérfano en el bucket (limpiable por barrido), pero **nunca** una fila DOCUMENTO
  sin RESERVA confirmada.

## D-6 — Endpoint e input para la fase de contrato

**Previsto (input al `contract-engineer`, post-gate; NO se toca `docs/api-spec.yml` en este
change de spec):**
- `POST /reservas/{id}/confirmar-senal` — `multipart/form-data` con el fichero justificante.
  Respuesta: la RESERVA en `reserva_confirmada` con `importe_senal`/`importe_liquidacion`,
  los sub-procesos en `pendiente`, y referencia a la factura de señal en borrador (US-022).
- Errores mapeados: `409`/`422` "La reserva no está en estado pre_reserva"; `422` "Es
  obligatorio adjuntar el justificante de pago" / formato / tamaño; `409` "La reserva ya ha
  sido confirmada" (concurrencia); `409` "Fecha no disponible" (`P2002`).

El cliente HTTP del frontend se **genera** desde el contrato, nunca se edita a mano (hook
`protect-generated-client`).

## D-7 — Migración

**A confirmar en implementación.** Todo lo necesario ya está en el modelo: estado
`reserva_confirmada`, enums de sub-procesos, `importe_senal`/`importe_liquidacion`,
`TENANT_SETTINGS.pct_senal`, `DOCUMENTO.tipo = 'justificante_pago'` y FICHA_OPERATIVA
(`er-diagram.md §RESERVA, §3.14, §3.15, §TENANT_SETTINGS`) y la fase `reserva_confirmada`
en el mapa canónico de US-040. En principio **no se prevé migración estructural**; si
faltara alguna columna o el seed de `pct_senal` en `prisma/schema.prisma` de `master`, será
la única migración.

## D-8 — Concurrencia: "ya confirmada" vs "Fecha no disponible"

**Decisión: distinguir los dos escenarios de carrera por su causa.**
- **Doble clic / dos sesiones sobre la MISMA RESERVA**: ambas apuntan a la misma fila de
  `FECHA_BLOQUEADA`. La primera transacción hace el `SELECT … FOR UPDATE`, upgrade a firme y
  transición, y commitea. La segunda se **bloquea** hasta que la primera libera el lock;
  entonces lee la RESERVA, la ve ya en `reserva_confirmada` y **aborta con "La reserva ya ha
  sido confirmada"**, sin crear segundo DOCUMENTO ni segunda FICHA_OPERATIVA (idempotencia
  D-4).
- **Confirmar sobre una fecha ya en firme de OTRA RESERVA**: escenario de fallo de
  integridad. El intento de fijar el bloqueo choca con `UNIQUE(tenant_id, fecha)` (`P2002`)
  **antes** de mutar la segunda RESERVA; se devuelve **"Fecha no disponible"**, sin doble
  reserva confirmada (D4).

Esta zona crítica se cubre con **tests de concurrencia reales** (skill
`concurrency-locking`) en TDD-RED, antes de implementar: dos transacciones simultáneas y
verificación de que exactamente una gana y el estado final es coherente
(una sola fila de `FECHA_BLOQUEADA` firme, un solo DOCUMENTO, una sola FICHA_OPERATIVA, una
sola entrada de transición en `AUDIT_LOG`).

## Riesgos y mitigaciones

- **Fichero huérfano en almacenamiento tras rollback** (D-5): mitigado con barrido de
  ficheros sin DOCUMENTO asociado; nunca deja fila DOCUMENTO sin RESERVA confirmada.
- **Desajuste de céntimos en importes** (D-3): mitigado calculando la liquidación como
  complemento (resta), no como segundo porcentaje.
- **Doble FICHA_OPERATIVA/DOCUMENTO por carrera** (D-4/D-8): mitigado por `reserva_id
  @unique`, guarda de existencia y serialización por `SELECT … FOR UPDATE`.
- **Fase `reserva_confirmada` no soportada por la primitiva** (D-2): descartado — ya está
  en el mapa canónico y en la spec de `bloqueo-fecha`.
