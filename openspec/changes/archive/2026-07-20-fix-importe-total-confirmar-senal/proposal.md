# Change: fix-importe-total-confirmar-senal

## Why

El endpoint `POST /reservas/{id}/confirmar-senal` (US-021, UC-17) **devuelve
siempre HTTP 422** con `ImporteTotalInvalidoError` — *"El importe total de la
reserva no es válido (no hay presupuesto aceptado)"* — haciendo **imposible
confirmar el pago de la señal** de cualquier reserva. Es un bug bloqueante del
flujo crítico de confirmación (D4: sin confirmación no hay bloqueo firme).

### Causa raíz (confirmada por trazado de código)

1. `ConfirmarPagoSenalUseCase.ejecutar()` valida `reserva.importeTotal > 0`
   antes de confirmar (guard `validarImporteTotal`,
   `apps/api/src/confirmacion/application/confirmar-pago-senal.use-case.ts:432,560`).
2. **Ningún código de producción escribe nunca `RESERVA.importe_total`.** El
   total del presupuesto vive solo en `PRESUPUESTO.total`
   (`generar-presupuesto.use-case.ts:622`); `transicionarAPrereserva()` solo
   escribe `estado`/`sub_estado`/`ttl_expiracion`
   (`activar-prereserva-uow.prisma.adapter.ts:139-146`). En BD real,
   `reserva.importe_total` queda **NULL** → la guarda falla → **422 siempre**,
   con cualquier fichero justificante válido.
3. **No existe ningún paso "aceptar presupuesto":** el PRESUPUESTO se queda en
   `estado = 'enviado'` para siempre; nadie lo promueve a `'aceptado'`.
4. **Bug latente acoplado en facturación.** El post-commit de confirmar-señal
   (generación de facturas, US-022/US-027) une `PRESUPUESTO(estado='aceptado')`
   en tres adaptadores (`cargar-datos-documento-factura.prisma.adapter.ts:111`,
   `lecturas-borradores.prisma.adapter.ts:41`,
   `lecturas-facturacion.prisma.adapter.ts:41`) con fallback *"sin presupuesto
   aceptado → CON IVA por defecto"*. Como nadie marca `aceptado`, las facturas
   pierden el número y el régimen fiscal del presupuesto.

La US-021 asumía (`§Supuestos`, `§Dependencias US-014`) que *"el presupuesto ya
fue aceptado en `pre_reserva` y `RESERVA.importe_total` está fijado"*. Ese
supuesto **nunca se cumplió** en la implementación real: no hay paso de
aceptación ni escritura de `importe_total`. Este change corrige el
comportamiento para que ese supuesto se materialice **en el momento correcto**.

### Decisión de producto (acordada)

El fix ocurre **EN el momento de confirmar el pago de la señal** (no en la
generación del presupuesto de US-014). Al confirmar, el caso de uso lee el total
del **presupuesto vigente**, lo **congela** en `RESERVA.importe_total` y marca
ese presupuesto como `aceptado`, todo dentro de la misma transacción atómica de
la confirmación. Así el `importe_total` refleja siempre la última versión del
presupuesto en el instante de la confirmación (coherente con las ediciones de
US-015), y la facturación posterior encuentra el `PRESUPUESTO(estado='aceptado')`
que esperaba.

## What Changes

### Comportamiento nuevo dentro de la transacción de `confirmar-pago-senal`

`ConfirmarPagoSenalUseCase.ejecutar()`, **dentro de su transacción atómica**
(bajo `SELECT ... FOR UPDATE` sobre `FECHA_BLOQUEADA` y contexto RLS del
tenant), y **antes** de calcular los importes de señal/liquidación:

1. **Obtiene el total del PRESUPUESTO VIGENTE** de la reserva: el de mayor
   `version` (`MAX(version)`) con `estado = 'enviado'` (vigencia derivada, no
   almacenada; `er-diagram §3.12`).
2. **Valida `total > 0`**. Si no hay presupuesto vigente válido (inexistente, o
   `total ≤ 0`), lanza el **mismo** `ImporteTotalInvalidoError` → HTTP 422
   `IMPORTE_TOTAL_INVALIDO` **sin efectos** (ahora el mensaje es literalmente
   cierto: no hay presupuesto vigente que aceptar). La guarda deja de leer un
   `RESERVA.importe_total` que nunca se poblaba y pasa a leer la fuente real.
3. **Congela `RESERVA.importe_total = presupuesto.total`** (además de los ya
   existentes `importe_senal`/`importe_liquidacion`, que se derivan de ese total
   con `TENANT_SETTINGS.pct_senal` — comportamiento ya especificado, sin cambio).
4. **Marca ese PRESUPUESTO como `estado = 'aceptado'`**, dejando de una vez el
   presupuesto vigente en el estado que la facturación posterior
   (US-022/US-027) espera para tomar número y régimen fiscal.

### Lo que NO cambia

- **El endpoint, el DTO de entrada (multipart justificante) y la respuesta HTTP
  NO cambian.** La respuesta sigue devolviendo `importeSenal`/`importeLiquidacion`.
- **El contrato OpenAPI (`docs/api-spec.yml`) NO cambia** → no hay regeneración
  de SDK ni cambio en el frontend.
- **El bloqueo atómico de fecha** (`FECHA_BLOQUEADA` firme, `SELECT ... FOR
  UPDATE`), la creación del DOCUMENTO justificante, la FICHA_OPERATIVA
  idempotente, la inicialización de los tres sub-procesos y los disparos
  post-commit (US-022/US-027) **no cambian**.
- **US-014 / generar-presupuesto NO cambia**: el presupuesto sigue naciendo en
  `estado = 'enviado'`; la aceptación se realiza al confirmar la señal.

## Impact

- **Specs afectadas**:
  - `specs/confirmacion/spec.md` — **MODIFIED** el requirement *"Congelado de
    importes de señal y liquidación al confirmar"*: ahora el `importe_total` se
    **obtiene del presupuesto vigente** al confirmar (no se asume prefijado), se
    **congela** en la RESERVA y el presupuesto vigente pasa a `aceptado`; si no
    hay presupuesto vigente válido → 422 `IMPORTE_TOTAL_INVALIDO` sin efectos.
- **US relacionadas**:
  - **US-021 / UC-17** — historia dueña del flujo de confirmación (se corrige su
    supuesto no cumplido de `importe_total` prefijado).
  - **US-014 / UC-14** — genera el presupuesto vigente (`estado='enviado'`) que
    ahora se acepta al confirmar; no se modifica.
  - **US-015 / UC-15** — las ediciones del presupuesto crean versiones nuevas;
    tomar `MAX(version)` al confirmar respeta la última edición.
  - **US-022 (factura de señal) / US-027 (liquidación + fianza)** — **se
    benefician**: dejan de caer en el fallback "sin presupuesto aceptado → CON
    IVA por defecto"; ahora encuentran `PRESUPUESTO(estado='aceptado')` con su
    número y régimen fiscal.
- **Código afectado (tras el gate; NO en este change)**:
  - Backend: `ConfirmarPagoSenalUseCase.ejecutar()` (lectura del presupuesto
    vigente, congelado de `importe_total`, marcado `aceptado`) y su
    puerto/adaptador de unit-of-work (`confirmar-pago-senal-uow.prisma.adapter`
    / repositorio de presupuesto), todo dentro de la transacción existente y con
    RLS por tenant. La guarda `validarImporteTotal` pasa a validar el total del
    presupuesto vigente.
- **NO reimplementa**: el bloqueo atómico de fecha, la máquina de estados, el
  contrato OpenAPI, el SDK, el frontend, ni la generación del presupuesto
  (US-014).
- **Riesgo principal**: **medio-alto**. El congelado de `importe_total` y el
  marcado `aceptado` ocurren dentro de la transacción crítica de confirmación
  (bloqueo firme + FICHA_OPERATIVA idempotente + sub-procesos). Debe preservarse
  la atomicidad all-or-nothing, la idempotencia ante double-click (una segunda
  confirmación no debe re-aceptar ni re-congelar de forma incoherente) y la RLS
  por tenant → **TDD del caso de uso primero** (incluida concurrencia) y QA con
  BD real (el bug solo se reproduce contra Postgres, no con adaptadores
  mockeados — ver MEMORY "backend nunca probado contra BD real").
