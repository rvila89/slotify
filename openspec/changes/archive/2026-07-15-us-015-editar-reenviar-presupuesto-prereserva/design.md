# Design — us-015-editar-reenviar-presupuesto-prereserva

> Decisiones técnicas no triviales de US-015. Las tres marcadas **⏸ REQUIERE VISTO
> BUENO** se elevan al gate de revisión humana SDD antes de implementar.

## Contexto reutilizado (ya en la capability `presupuestos`)

- `GenerarPresupuestoUseCase` (US-014): `preview`/`confirmar`/`reenviarE2`, motor de
  tarifa delegado, desglose fiscal por régimen (`calcularDesgloseFiscal`,
  `calcularReparto`), congelado de tarifa, numeración `AAAANNN` de doble secuencia
  (`siguienteNumeroPresupuesto` + reintento `P2002` por `meta.target`).
- `DispararE2Adapter` (post-commit, idempotente por `(reserva, E2)`), motor de email
  US-045 (`DespacharEmailService`).
- Máquina de estados declarativa en `reservas/domain/maquina-estados.ts` (guardas de
  origen como estructura de datos).
- Patrón de **reenvío** con `es_reenvio = true` (US-023 `ReenviarE3UseCase`, US-028
  `ReenviarLiquidacionUseCase`): nueva `COMUNICACION` fuera del índice UNIQUE parcial.

## D1 — Gap de spec E2 para el reenvío (UC-15) ⏸ REQUIERE VISTO BUENO

**Problema.** `docs §9.3` define el email **E2** con trigger "Gestor activa
pre-reserva" (US-014). UC-15 (editar/reenviar estando **ya** en pre_reserva) **no
tiene un código E propio** asignado. La US-015 (`§Email relacionado`) indica reutilizar
E2 como reenvío, pero lo marca **"Pendiente de confirmar con product owner"**.

**Opciones.**
- **Opción A (propuesta):** reutilizar el template **E2** para el reenvío de la edición,
  registrando la `COMUNICACION` con `codigo_email = 'E2'` y `es_reenvio = true`. Encaja
  con el enum `CodigoEmail` actual (no hay valor nuevo), con el índice UNIQUE parcial
  `(reserva_id, codigo_email) WHERE es_reenvio = false` (permite N reenvíos) y con el
  precedente US-023/US-028. Sin migración de enum.
- **Opción B:** crear un código nuevo (p. ej. `E2b`/`E9`) para "presupuesto
  actualizado". Requiere migración del enum `CodigoEmail`, plantilla nueva y más
  superficie. Mayor trazabilidad documental, más coste.

**Recomendación:** Opción A (E2 + `es_reenvio=true`), consistente con el patrón vivo.
**Decisión pendiente del PO/humano:** ¿confirmamos reutilizar E2, o se desea un código
E propio para "presupuesto actualizado"?

## D2 — Modelo de versionado del PRESUPUESTO ⏸ REQUIERE VISTO BUENO

**Contexto.** El esquema ya tiene `Presupuesto.version` y `@@unique([reservaId,
version])`. US-014 crea siempre `version = 1`. US-015 introduce versiones sucesivas.

**Decisiones de modelo:**

1. **Nueva fila por versión (inmutable), no update in-place.** Cada edición confirmada
   inserta un `Presupuesto` nuevo con `version = MAX(version de la reserva) + 1`; los
   anteriores quedan intactos como historial. (Alineado con `US-015 §Reglas de negocio`
   "el anterior queda como historial".)
2. **"Presupuesto vigente" = el de mayor `version`.** Las precondiciones y el reenvío
   operan sobre el de `version` máxima. No se añade una columna `es_vigente` (se deriva
   por `MAX(version)`); a confirmar si se prefiere una bandera explícita para lecturas.
3. **Numeración `numero_presupuesto` por versión — a decidir.** ¿Cada versión nueva
   consume un `AAAANNN` de la secuencia (como una emisión nueva) o **hereda** el número
   de la v1 y solo cambia `version`? El Excel numera por documento emitido; una edición
   enviada es un documento nuevo. **Propuesta:** cada **envío** de una versión nueva
   consume un `AAAANNN` de la secuencia del régimen (reutiliza `siguienteNumeroPresupuesto`
   + reintento `P2002`); un **borrador** (no enviado) queda con `numero_presupuesto =
   null` hasta que se envíe (los NULL no colisionan). El **reenvío sin cambios** (D2.4)
   NO consume número (reusa el de la versión vigente).
4. **Reenvío sin cambios NO versiona.** No crea `Presupuesto`; solo `COMUNICACION` +
   `AUDIT_LOG` (patrón US-023/US-028).
5. **Concurrencia (optimistic).** `US-015 §Concurrencia` no la marca zona crítica (no
   toca `FECHA_BLOQUEADA`). El riesgo es doble edición simultánea del mismo gestor. El
   `@@unique([reservaId, version])` ya **serializa**: dos confirmaciones que calculan la
   misma `version` colisionan (`P2002`) y la perdedora reintenta recalculando `MAX+1`
   (mismo patrón acotado que la numeración de US-014). **No** se añaden tests de
   concurrencia con hilos reales (heurística de la spec), pero sí un test unitario del
   reintento `P2002` sobre `(reservaId, version)`.

**Decisión pendiente del humano:** (a) ¿deriva la vigencia por `MAX(version)` o se
quiere una bandera `es_vigente`? (b) ¿cada envío de versión consume un `AAAANNN` nuevo
(propuesta) o la edición hereda el número de la v1?

## D3 — Primera persistencia real de `RESERVA_EXTRA` ⏸ REQUIERE VISTO BUENO

**Hallazgo (investigación del código).** US-014 **nunca** persiste filas de
`RESERVA_EXTRA`: los extras del preview/confirmar se pasan **solo** al motor de tarifa
para el cálculo (`activar-prereserva-uow` no crea filas; comprobado: 0 referencias). En
cambio, el adaptador del PDF (`cargar-datos-documento-presupuesto`) **lee**
`reserva.reservaExtras` para pintar los sub-conceptos → hoy esa lista está vacía salvo
seed. US-015 es la **primera** historia que crea líneas `RESERVA_EXTRA` reales.

**Implicaciones a decidir:**

1. **US-015 pasa a ser dueña de la persistencia de `RESERVA_EXTRA`.** Al confirmar la
   edición se materializan las líneas (añadir/quitar/modificar) con `precio_unitario`
   congelado, `origen`, `subtotal`, `factura_id = null`. Encaja con el esquema actual
   (sin migración).
2. **¿Las líneas se ligan a la RESERVA o a la versión del PRESUPUESTO?** El esquema
   actual liga `RESERVA_EXTRA.reserva_id` a la RESERVA (no hay FK a `presupuesto`). Si
   queremos que **cada versión** tenga su propio conjunto de extras (para reproducir el
   histórico fielmente), habría que **añadir** `presupuesto_id` a `RESERVA_EXTRA`
   (migración aditiva) o versionar por snapshot. **Propuesta MVP:** mantener las líneas
   ligadas a la RESERVA (conjunto "vivo") y reflejar en el PDF de cada versión el estado
   de extras **en el momento de esa emisión** (el desglose congelado del PRESUPUESTO ya
   guarda `base_imponible`/`total`, que es el dato fiscal firme; las líneas
   `RESERVA_EXTRA` reflejan el conjunto actual). Alternativa más fiel (con migración
   `presupuesto_id`) queda como opción si el PO exige histórico de extras por versión.
3. **`origen`.** Las líneas añadidas tras activar la pre_reserva usan
   `origen = 'anadido_post_confirmacion'` (enum existente); si en el futuro US-015
   editara extras de la fase de presupuesto original se usaría `presupuesto`.
4. **Alcance de este SDD.** Si se opta por la propuesta MVP (sin `presupuesto_id`), **no
   hay migración**. Si el gate elige histórico por versión, se añade una migración
   aditiva de `presupuesto_id` en `RESERVA_EXTRA` (nullable + backfill null).

**Decisión pendiente del humano:** ¿líneas de extras ligadas a la RESERVA (conjunto
vivo, sin migración) o histórico por versión con `presupuesto_id` (migración aditiva)?

## D4 — Endpoints y forma del contrato (lo cierra `contract-engineer` post-gate)

- `POST /reservas/{id}/presupuesto/edicion/preview` → 200 (recalcula, no persiste).
- `POST /reservas/{id}/presupuesto/edicion` → 201 (crea versión; `enviar: boolean`
  decide `enviado` vs `borrador`).
- `POST /reservas/{id}/presupuesto/reenvio` → 200 (reenvío sin cambios).
- **DTO de edición** (borrador): `numAdultosNinosMayores4?`, `duracionHoras?`,
  `extras: [{ extra_id?, concepto_libre?, cantidad, /* precio congelado en server */ }]`
  (server congela `precio_unitario`; el body **no** dicta el precio de líneas nuevas),
  `descuentoEur?`, `descuentoMotivo?`, `precioManualEur?`, `metodoPago` (régimen), y en
  confirmar `enviar: boolean`. Mapeo de errores igual que US-014 (409 origen inválido /
  presupuesto aceptado; 422 validación/precio manual/datos fiscales; 404 no encontrada).
- `tenant_id`/`usuario_id` **siempre** del JWT (`@CurrentUser`), nunca del body/path.
- Rol `gestor` (guard existente).

## D5 — Hexagonal / guardas

- Nuevo use-case de aplicación `EditarPresupuestoUseCase` (o extensión del existente),
  depende **solo** de puertos inyectados (hook `no-infra-in-domain`); reutiliza el
  motor, el desglose y la numeración.
- Ninguna dependencia de Redis/locks distribuidos (no aplica: la historia no toca el
  bloqueo atómico de fecha).
- La guarda de precondición (pre_reserva + presupuesto no aceptado) se modela como
  estructura declarativa en la máquina de estados, no como `if` dispersos.

## Resumen de decisiones al gate — RESUELTAS (gate humano 2026-07-15)

| ID | Decisión | RESOLUCIÓN aprobada |
|----|----------|---------------------|
| D1 | Código de email del reenvío | ✅ **Reutilizar E2** + `es_reenvio=true` (sin migración de enum) |
| D2 | Modelo de versionado / numeración | ✅ Fila nueva por versión (inmutable); vigente = `MAX(version)`; **cada envío consume un `AAAANNN` nuevo**; borrador no enviado `numero_presupuesto = null`; reenvío sin cambios NO versiona ni consume número |
| D3 | Persistencia de `RESERVA_EXTRA` | ✅ **Líneas ligadas a la RESERVA** (conjunto vivo, MVP **sin migración**); dato fiscal firme por versión vía desglose congelado (`base_imponible`/`total`) |
| D4 | Endpoints y DTOs | 3 endpoints (preview/edicion/reenvio) — lo cierra `contract-engineer` |
| D5 | Hexagonal / sin bloqueo distribuido | Use-case con puertos; sin `FECHA_BLOQUEADA` |
