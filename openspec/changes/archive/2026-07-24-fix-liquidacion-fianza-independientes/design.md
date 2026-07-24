# Design — fix-liquidacion-fianza-independientes

> Decisiones técnicas del desacople liquidación/fianza y de la simplificación de la fianza y la
> devolución. Aprobadas por el usuario en el Gate previo (plan `fix-liquidacion-fianza-
> independientes`). Este documento guía contrato + implementación posteriores; no se implementa
> código aquí.

## Contexto y objetivo

Hoy liquidación y fianza están acoplados en un único flujo de emisión (E4 = liquidación + recibo de
fianza, US-028), la fianza se modela como FACTURA que se emite y se cobra por PAGO (US-027/US-030) y
es precondición dura del inicio del evento, y la devolución permite retención parcial con captura de
IBAN (E5/E8, US-035/US-036) pero no confirma la devolución al cliente. El objetivo es desacoplar y
simplificar hacia el modo real de trabajo de la Masia.

## D-1 — Liquidación standalone (flujo espejo de la señal)

- El borrador de liquidación se sigue generando en `borrador` al confirmar la señal (US-027), **sin**
  la fianza.
- La emisión pasa de la acción combinada "Aprobar y enviar" con **atomicidad estado↔E4 conjunta
  liquidación+fianza** (US-028) a un **flujo standalone espejo de la señal** (US-023): un use-case
  `enviar-factura-liquidacion` que emite la liquidación (asigna `numero_factura`, `fecha_emision`,
  `estado = 'enviada'`, marca `RESERVA_EXTRA`, `liquidacion_status = 'facturada'`) **solo si E4 se
  confirma**, y un use-case `reenviar-liquidacion` dedicado que crea una nueva `COMUNICACION` E4 sin
  reasignar número ni estado.
- **E4 = solo liquidación**, con el texto bilingüe nuevo (plan §Email copy). No adjunta ni emite
  fianza; no toca `fianza_status`.
- **UI**: `FacturaLiquidacionCard` espejo de `FacturaSenalCard`, con banner permanente "enviada el
  {fecha/hora}" (`formatearFechaHora(fecha_emision)`) y acción de reenvío.
- **Se conservan sin cambios**: numeración `F-YYYY-NNNN` (`UNIQUE(tenant_id, numero_factura)` +
  reintento ante `P2002`, nunca locks distribuidos), desglose fiscal (base por resta, IVA 21 %,
  redondeo contable), cálculo del total de liquidación (`calculo-total-liquidacion.ts`).

## D-2 — Fianza pasiva (comprobante), espejo de condiciones firmadas

- La fianza deja de ser una FACTURA. `fianza_status = 'cobrada'` pasa a significar **"comprobante
  recibido"** y se establece al subir el comprobante.
- Use-case `subir-comprobante-fianza` **espejo de `registrar-firma-condiciones`** (US-024): en una
  transacción atómica sube el fichero, crea `DOCUMENTO tipo = 'comprobante_fianza'`, marca
  `fianza_status = 'cobrada'`, `fianza_cobrada_fecha = now()` y `fianza_comprobante_fecha = now()`, y
  audita `accion = 'actualizar'`. Es opcional, re-subible (histórico conservado), y **no bloquea**
  ninguna transición.
- Validación de fichero: `mime_type ∈ {image/jpeg, image/png, application/pdf}`, ≤ 10 MB, autoritativa
  en servidor.
- **UI**: `FianzaComprobanteCard` espejo de `CondicionesFirmadasCard`.

## D-3 — Devolución completa + email nuevo post-commit best-effort

- Use-case `devolver-fianza`: precondición `estado = 'post_evento'` **Y** `fianza_status = 'cobrada'`
  (sin IBAN). En una transacción atómica bajo `SELECT ... FOR UPDATE` sobre la RESERVA (guarda contra
  doble registro, serialización por el motor SQL, nunca locks distribuidos): `fianza_status =
  'devuelta'`, `fianza_devuelta_fecha = now()` (importe implícito = `fianza_eur`, no se persiste
  importe parcial), y `AUDIT_LOG accion = 'actualizar'`.
- **Email de "fianza devuelta"** disparado como efecto **posterior al commit** y **best-effort**,
  siguiendo exactamente el patrón de `disparar-e8.adapter.ts` (post-commit, fallo no revierte, deja
  `COMUNICACION` en `fallido`, reintentable). **Deliberadamente distinto** de la atomicidad de E4:
  aquí el email no condiciona el registro.
- Estado `devuelta` es **final e irreversible** en MVP.

## D-4 — Precondición de evento_en_curso reducida (quita fianza)

- La guarda `reserva_confirmada → evento_en_curso` (US-031, aún no implementada como spec; hoy solo
  referenciada en `ficha-operativa`) pasa de **tres** precondiciones a **dos**: `pre_evento_status =
  'cerrado'` **Y** `liquidacion_status = 'cobrada'`. Se elimina `fianza_status = 'cobrada'`.
- La máquina de estados se mantiene modelada como **estructura de datos** (skill `state-machine`); la
  guarda deja de leer `fianza_status`.
- **Nota de reconciliación de specs**: no existe todavía un requisito vivo que modele la transición
  US-031; las dos referencias a la "precondición triple" que sí existen viven en la capability
  `ficha-operativa` (cierre manual y cierre automático T-1d). El delta de máquina de estados se aplica
  ahí (no en `confirmacion`, que solo inicializa los sub-procesos). El requisito eliminado de
  `facturacion` "El cobro de la fianza habilita la tercera precondición…" desaparece con el cobro de
  fianza.

## D-5 — Modelo de datos (Prisma + er-diagram)

- `TipoFactura`: eliminar `fianza` → `senal | liquidacion | complementaria`.
- `FianzaStatus`: reducir de `pendiente | recibo_enviado | cobrada | devuelta | retenida_parcial` a
  `pendiente | cobrada | devuelta`. `cobrada` = comprobante recibido.
- `RESERVA`: eliminar `motivo_retencion` y `fianza_devuelta_eur` (devolución siempre completa =
  `fianza_eur`); conservar `fianza_eur`, `fianza_cobrada_fecha`, `fianza_devuelta_fecha`; añadir
  `fianza_comprobante_fecha` (análogo a `cond_part_firmadas_fecha`) o referencia al `DOCUMENTO`
  comprobante.
- `CLIENTE.iban_devolucion`: eliminar.
- `DOCUMENTO`: nuevo `tipo = 'comprobante_fianza'` en el enum polimórfico.
- **Idempotencia** de facturación: `UNIQUE(reserva_id, tipo)` deja de cubrir el tipo `fianza`; sigue
  garantizando una única `senal` y una única `liquidacion` por reserva.
- **Migración**: la migración de enums en PostgreSQL requiere recrear/alterar el tipo; validar que no
  quedan filas con `TipoFactura.fianza` ni `FianzaStatus ∈ {recibo_enviado, retenida_parcial}` (en
  dev/piloto no debería haberlas; si las hubiera, decidir backfill en implementación). RLS/tenant se
  respetan; el filtro `tenant_id` en el WHERE sigue siendo el aislamiento real (RLS bypass por
  superuser en dev/test, memoria conocida).

## Atomicidad, multi-tenancy y bloqueo

- **Atomicidad E4 (liquidación)**: se conserva "consolidar solo si E4 se confirma" (rollback total).
  No sostiene el `FOR UPDATE` del bloqueo de fecha ni usa locks distribuidos.
- **Email de devolución**: post-commit best-effort (no atómico), patrón `disparar-e8`.
- **Guardas de estado** (`devolver-fianza`, doble comprobante si aplicara): `SELECT ... FOR UPDATE`
  sobre la fila de RESERVA dentro de la transacción; serialización del motor SQL, **nunca**
  Redis/Redlock (regla dura `CLAUDE.md`).
- **Multi-tenancy/RLS**: toda operación bajo el `tenant_id` del JWT; una reserva de otro tenant no es
  visible (404) ni operable.

## Contrato OpenAPI (post-gate, dueño contract-engineer)

- **Añadir**: `POST /reservas/{id}/facturas/liquidacion/enviar`, `POST
  /reservas/{id}/facturas/liquidacion/reenviar`, `POST /reservas/{id}/fianza/comprobante` (multipart),
  `POST /reservas/{id}/fianza/devolver` (cuerpo vacío).
- **Eliminar**: `.../facturas/liquidacion/aprobar-enviar` (combinado), `.../facturas/fianza/enviar`,
  el cobro de fianza, `registrar-iban-devolucion`, y la variante de devolución con retención/importe.
- Regenerar el SDK (`sdk-codegen`); **nunca** editar el cliente generado a mano (hook
  `protect-generated-client`). Verificar que la clave de matching contrato↔backend usa el payload real
  del SDK (memoria `contract-matching-key-mismatch`).

## Removal surface (representativa; §5/§7 del plan)

- **Backend eliminar**: `aprobar-y-enviar-liquidacion` (combinado), `registrar-cobro-fianza.*`,
  `registrar-iban-devolucion.*`, `disparar-e8.adapter.ts`, `cargar-reserva-iban-devolucion.*`, las
  partes de retención/IBAN de `registrar-devolucion-fianza.*` (`validar-devolucion-fianza`,
  `derivar-estado-fianza-devolucion`, `puede-registrar-devolucion`), plantillas E5/E8 del catálogo.
- **Backend modificar**: `generar-borradores-liquidacion-fianza.use-case.ts` → solo liquidación (y
  renombrar si procede); `pdf-factura.real.adapter.ts` + plantilla (concepto/subtítulo/condicions/pie
  fieles a la referencia); `catalogo-plantillas.ts` (E4 = solo liquidación CA/ES + nueva plantilla
  "fianza devuelta" CA/ES); `emision-email.adapter.ts` (E4 solo liquidación); máquina de estados
  (guarda `evento_en_curso` sin fianza).
- **Backend añadir**: `enviar-factura-liquidacion.use-case.ts` + `reenviar-liquidacion` standalone;
  `subir-comprobante-fianza.use-case.ts`; `devolver-fianza.use-case.ts` + adapter de email
  post-commit best-effort.
- **Frontend eliminar**: `DocumentosLiquidacionFianza.tsx`, `AccionesFacturacion.tsx`,
  `AprobarEnviarLiquidacionDialog.tsx`, `RegistrarCobroFianzaDialog.tsx`, `IbanDevolucionCard.tsx` + su
  hook; simplificar/retirar la parte de retención/IBAN de `RegistrarDevolucionFianzaDialog.tsx` /
  `DevolucionFianzaCard.tsx`.
- **Frontend añadir**: `FacturaLiquidacionCard.tsx` (espejo de `FacturaSenalCard.tsx`),
  `FianzaComprobanteCard.tsx` (espejo de `CondicionesFirmadasCard.tsx`), botón "Devolver fianza" +
  hooks `useEnviarFacturaLiquidacion`, `useReenviarLiquidacion`, `useSubirComprobanteFianza`,
  `useDevolverFianza`.
- **Frontend modificar**: `SeccionesFicha.tsx` — orden **señal → liquidación (debajo) → operativa →
  condiciones → fianza (comprobante + devolución) → comunicaciones**. Reglas duras: mobile-first
  (390/768/1280), estructura Bulletproof por dominio, `components/` solo `.tsx` (helpers → `lib/`),
  barrels.

## PDF de liquidación fiel a la referencia

- Reutilizar los componentes de `documentos/presentation/componentes/` (`Cabecera`, `BloqueCliente`,
  `BloqueTitulo`, `TablaConcepto`, `BloqueTotales`, `BloqueCondicions`, `PieBancario`).
- Variante liquidación: concepto "Gestió ús espai de Masia l'Encís per esdeveniment", subtítulo
  "*60% de l'import restant del pressupost núm. {n}", fila de condicions "A l'arribada · {fianzaEur}€ ·
  Fiança" + nota de comprobante + IBAN, IVA 21 %, pie bancario. Bilingüe CA/ES vía
  `etiquetas-por-idioma.ts`.
- Memoria `react-pdf-esm-suite-flakiness`: verificar las suites react-pdf en aislamiento.

## Anti-scope / riesgos

- No se reintroduce retención parcial, captura de IBAN ni cobro de fianza por PAGO.
- No se toca señal (US-022/US-023) ni cobro de liquidación (US-029).
- Riesgo de enhebrado incompleto del read path al añadir `fianza_comprobante_fecha` / cambiar enums
  (memoria `columna-nueva-read-path-completo`): asegurar projection→listItem→DTO→contrato→frontend y
  verificar con E2E HTTP real, no solo SQL crudo.
- Tests de integración/concurrencia se lanzan desde la sesión principal (los subagentes QA no tienen
  Postgres, memorias `subagentes-sin-docker-postgres`, `worktree-test-db-necesita-seed`).
