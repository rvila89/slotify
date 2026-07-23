# facturacion Specification

## Purpose
Gobierna la generación y el ciclo de vida de la FACTURA como agregado raíz de facturación,
comenzando por la **factura de señal** (`tipo = 'senal'`): su creación automática en `borrador`
como efecto post-commit de la confirmación de la reserva (US-021/US-022), el desglose fiscal
(base + IVA 21 % con redondeo contable), la numeración `F-YYYY-NNNN` secuencial y única por
`tenant_id` + año, la idempotencia (una factura de señal por reserva), la generación del PDF con
datos fiscales de emisor y receptor, el borrador inválido por datos incompletos, el reintento
ante fallo de PDF, y la aprobación (borrador → enviada) y el rechazo por el Gestor. La
serialización de la numeración se resuelve con `UNIQUE(tenant_id, numero_factura)` + reintento
aplicativo, nunca con locks distribuidos. Fuente: US-022, UC-18; `er-diagram.md §3.12 FACTURA`.
## Requirements
### Requirement: Generación automática de la factura de señal en borrador al confirmar la reserva

El sistema SHALL (DEBE), como efecto **posterior al commit** de la transición de la RESERVA a
`reserva_confirmada` (US-021), crear **una** FACTURA con `tipo = 'senal'`, `estado =
'borrador'`, `reserva_id` de la RESERVA confirmada, `tenant_id` correcto y `total =
RESERVA.importe_senal` (congelado en US-021 como `round(importe_total × pct_senal / 100, 2)`,
40 % en MVP, **derivado del setting, nunca hardcodeado**). El sistema NO recalcula el
porcentaje ni la tarifa. El fallo de esta generación NO revierte la confirmación ya realizada:
la RESERVA permanece en `reserva_confirmada`. (Fuente: `US-022 §Historia`, `§Happy Path`,
`§Reglas de negocio`; UC-18; `er-diagram.md §3.12 FACTURA`, `§TENANT_SETTINGS pct_senal`.)

#### Scenario: Confirmar una reserva de 3.000 € genera la factura de señal de 1.200 € en borrador

- **GIVEN** una RESERVA que ha transitado a `reserva_confirmada` con `importe_total =
  3.000,00 €`, `TENANT_SETTINGS.pct_senal = 40,00` y `RESERVA.importe_senal = 1.200,00 €`
- **WHEN** el sistema genera la factura de señal tras el commit de la confirmación
- **THEN** se crea una FACTURA con `tipo = 'senal'`, `estado = 'borrador'`, `total =
  1.200,00 €`, `reserva_id` de la RESERVA y `tenant_id` correcto

#### Scenario: El porcentaje de la señal se deriva del setting, no se recalcula

- **GIVEN** una RESERVA `reserva_confirmada` con `RESERVA.importe_senal = 1.000,00 €`
  (congelado con `pct_senal = 50,00` en US-021)
- **WHEN** el sistema genera la factura de señal
- **THEN** `FACTURA.total = 1.000,00 €`, tomado de `RESERVA.importe_senal` sin recalcular
  tarifa ni porcentaje

### Requirement: Desglose fiscal de la factura según régimen IVA y redondeo contable

El sistema SHALL (DEBE) calcular el desglose fiscal de la factura derivando los campos del
total y del **régimen IVA** (`regimenIva`) del presupuesto aceptado de la reserva:

- **CON IVA** (`regimenIva = 'con_iva'`): `iva_porcentaje = 21,00`; `base_imponible =
  round(total / 1,21, 2)`; `iva_importe = total − base_imponible`. El redondeo es **contable
  a 2 decimales (mitad hacia arriba)** y el `iva_importe` se obtiene **por resta** del total,
  de modo que `base_imponible + iva_importe = total` **exactamente**, sin desajuste de céntimos
  por doble redondeo.
- **SIN IVA** (`regimenIva = 'sin_iva'`): `iva_porcentaje = 0,00`; `iva_importe = 0,00`;
  `base_imponible = total` (el total ya es la base neta, sin impuesto). En este régimen,
  `base_imponible + iva_importe = total` se cumple trivialmente.

El cálculo del desglose es lógica de **dominio puro** (función `calcularDesgloseFactura(total,
regimenIva)` en `calculo-factura.ts`). El `regimenIva` se obtiene del presupuesto aceptado de
la reserva (a través de `ReservaFacturable.regimenIva`, populado por el adapter que lee
`Presupuesto WHERE reservaId AND estado = 'aceptado'`). (Fuente: `US-022 §Happy Path`
`base = 991,74`, `iva = 208,26`, `§Reglas de Validación` redondeo contable; épico #6 rebanada
6.3 `documentos-facturas-pdf`; `er-diagram.md §3.12` base/iva derivados.)

#### Scenario: 1.200 € CON IVA desglosa 991,74 base + 208,26 IVA

- **GIVEN** una factura de señal con `total = 1.200,00 €` y `regimenIva = 'con_iva'`
- **WHEN** el sistema calcula el desglose fiscal
- **THEN** `iva_porcentaje = 21,00`, `base_imponible = 991,74 €`, `iva_importe = 208,26 €`
- **AND** `base_imponible + iva_importe = total` exactamente

#### Scenario: 1.200 € SIN IVA — base igual al total, IVA cero

- **GIVEN** una factura de señal con `total = 1.200,00 €` y `regimenIva = 'sin_iva'`
- **WHEN** el sistema calcula el desglose fiscal
- **THEN** `iva_porcentaje = 0,00`, `base_imponible = 1.200,00 €`, `iva_importe = 0,00 €`
- **AND** `base_imponible + iva_importe = total` exactamente

### Requirement: Numeración secuencial única por tenant y año (F-YYYY-NNNN)

El sistema SHALL (DEBE) asignar a la factura un `numero_factura` con formato `F-YYYY-NNNN`,
donde `YYYY` es el año de emisión y `NNNN` una secuencia de 4 dígitos con relleno de ceros,
**reiniciada por año** y **secuencial y única por `tenant_id` + año**. La unicidad la garantiza
la restricción de BD `UNIQUE(tenant_id, numero_factura)`. Dos tenants distintos PUEDEN tener el
mismo `numero_factura`; un mismo tenant NUNCA repite un `numero_factura`. (Fuente: `US-022
§Reglas de negocio` formato `F-YYYY-NNNN` secuencial por tenant+año, `§Reglas de Validación`
UK; `er-diagram.md §3.12` `numero_factura UK`, `§4.1` índices únicos.)

#### Scenario: La primera factura de señal del tenant en el año recibe F-YYYY-0001

- **GIVEN** un `tenant_id` sin ninguna factura en el año en curso
- **WHEN** el sistema genera su primera factura de señal
- **THEN** `numero_factura = 'F-{año}-0001'`, único para ese `tenant_id`

#### Scenario: La numeración es independiente entre tenants distintos

- **GIVEN** dos tenants distintos, cada uno sin facturas en el año
- **WHEN** cada uno genera su primera factura de señal
- **THEN** ambas pueden ser `F-{año}-0001` sin colisión, por ser la unicidad `(tenant_id,
  numero_factura)`

### Requirement: Idempotencia — una única factura de señal por reserva

El sistema SHALL (DEBE) garantizar que exista **como máximo una** FACTURA con `tipo = 'senal'`
por `reserva_id`. Antes de crear, el sistema comprueba si ya existe una factura de señal para
la reserva; si existe, **NO crea un duplicado** y **devuelve la existente**, registrando el
intento de duplicado en `AUDIT_LOG`. La unicidad la refuerza en BD la restricción
`UNIQUE(reserva_id, tipo)`. (Fuente: `US-022 §Factura de señal ya existente (idempotencia)`,
`§Reglas de Validación`.)

#### Scenario: Reinvocación del trigger no duplica la factura de señal

- **GIVEN** una RESERVA que ya tiene una FACTURA con `tipo = 'senal'`
- **WHEN** el sistema intenta generar una segunda factura de señal para la misma reserva
- **THEN** detecta la existente, **no** crea un duplicado y devuelve la factura ya creada
- **AND** registra el intento de duplicado en `AUDIT_LOG`

### Requirement: Generación del PDF de la factura con datos fiscales de emisor y receptor

El sistema SHALL (DEBE), tras crear la factura en `borrador`, generar el PDF vía el puerto de
dominio `GenerarPdfFacturaPort` (adaptador real en rebanada 6.3, `PdfFacturaRealAdapter`) con
`@react-pdf/renderer`, reutilizando la capa de plantilla compartida de `documentos/presentation/`
(introducida en rebanadas 6.1b/6.2). Los datos del **emisor** provienen de
`PlantillaDocumentoTenant` (rebanada 6.1a: `razonSocialFiscal`, `nif`, `nombreComercial`, `iban`,
`direccionFiscal`); los datos del **receptor** del `CLIENTE` (`nombre`, `apellidos`, `dniNif`,
`direccion`, `codigoPostal`, `poblacion`, `provincia`); el **concepto** referencia el número de
presupuesto aceptado de la reserva (ver rebanada 6.3 `design.md §D2`). El PDF generado se sube
mediante `AlmacenDocumentosPort` y la URL resultante se almacena como `FACTURA.pdf_url`. La
generación es **posterior al commit** de la creación y el guardado de `pdf_url` es **idempotente**.
Al crear la factura, el sistema DEBE registrar `AUDIT_LOG` con `accion = 'crear'`, `entidad =
'FACTURA'` y el `entidad_id` de la factura creada.

El PDF adopta la **variante CON IVA o SIN IVA** según `Factura.ivaPorcentaje`:
- **CON IVA** (ivaPorcentaje > 0): cabecera con razón social fiscal + NIF; totales con base
  imponible + IVA + total; pie de datos bancarios presente.
- **SIN IVA** (ivaPorcentaje = 0): cabecera sin identidad fiscal (solo nombre comercial);
  totales solo con el total neto (sin base/IVA); sin pie bancario.

(Fuente: `US-022 §Happy Path` PDF + `pdf_url` + `AUDIT_LOG`; épico #6 rebanadas 6.1a, 6.1b,
6.2, 6.3 `documentos-facturas-pdf`; `er-diagram.md §3.12 pdf_url`.)

#### Scenario: La factura válida obtiene su PDF y pdf_url

- **GIVEN** una factura de señal en `borrador` cuyo CLIENTE tiene todos los datos fiscales
  completos y cuyo TENANT tiene `nombre`, `nif`, `iban` y `direccion` informados
- **WHEN** el sistema genera el PDF de la factura
- **THEN** se genera el PDF con los datos del emisor y del receptor y se almacena `pdf_url`
- **AND** `AUDIT_LOG` registra `accion = 'crear'`, `entidad = 'FACTURA'` con el id de la
  factura

### Requirement: Borrador inválido por datos fiscales del cliente incompletos

El sistema SHALL (DEBE), si al generar el PDF el `CLIENTE.dni_nif` o cualquier campo de
dirección fiscal (`direccion`, `codigo_postal`, `poblacion`, `provincia`) es nulo, crear la
FACTURA en `estado = 'borrador'` pero marcarla como **inválida** con la alerta "Datos fiscales
incompletos", **NO generar el PDF** (`pdf_url = null`), notificar al Gestor para que complete
los datos del cliente y **bloquear la aprobación** (y por tanto E3) hasta que los datos estén
completos. El borrador inválido no puede aprobarse. (Fuente: `US-022 §Datos fiscales del
cliente incompletos`, `§Reglas de Validación`.)

#### Scenario: Cliente sin dni_nif deja la factura en borrador inválido sin PDF

- **GIVEN** una factura de señal a generar cuyo `CLIENTE.dni_nif` es nulo
- **WHEN** el sistema intenta generar el PDF
- **THEN** la FACTURA queda en `borrador` con `pdf_url = null`, marcada inválida ("Datos
  fiscales incompletos")
- **AND** la aprobación queda bloqueada y E3 no puede dispararse hasta completar los datos

### Requirement: Error temporal de generación del PDF con reintento automático

El sistema SHALL (DEBE), si el servicio de generación del PDF no está disponible temporalmente,
dejar la FACTURA en `estado = 'borrador'` con `pdf_url = null`, registrar la incidencia,
notificar al Gestor ("PDF pendiente de regenerar"), **reintentar la generación del PDF de forma
automática** y **bloquear la aprobación** del borrador hasta que el PDF esté disponible. El
guardado de `pdf_url` al completar el reintento es idempotente. (Fuente: `US-022 §Error de
generación del PDF`.)

#### Scenario: Fallo transitorio del PDF deja la factura en borrador y reintenta

- **GIVEN** una factura de señal en `borrador` cuyos datos fiscales son válidos pero el
  servicio de PDF falla temporalmente
- **WHEN** el sistema intenta generar el PDF
- **THEN** la FACTURA queda en `borrador` con `pdf_url = null` y se registra "PDF pendiente de
  regenerar"
- **AND** el sistema reintenta la generación automáticamente y la aprobación permanece
  bloqueada hasta que `pdf_url` esté disponible

### Requirement: Aprobación del borrador por el Gestor (borrador → enviada)

El sistema SHALL (DEBE) permitir al Gestor **aprobar** la factura de señal en `borrador` solo
si el PDF está disponible y los datos fiscales son válidos. Al aprobar, `FACTURA.estado →
'enviada'`, se fija `FACTURA.fecha_emision` con el timestamp actual y la factura queda **lista
para adjuntarse en E3**. El Gestor **NO puede modificar** importes ni datos fiscales del
borrador (provienen de RESERVA y CLIENTE). El sistema DEBE registrar `AUDIT_LOG` con `accion =
'actualizar'`, `datos_anteriores.estado = 'borrador'`, `datos_nuevos.estado = 'enviada'`. El
envío del email E3 NO ocurre en este change. (Fuente: `US-022 §Happy Path` aprobación,
`§Reglas de negocio`, `§Email relacionado`.)

#### Scenario: Aprobar un borrador válido lo pasa a enviada con fecha_emision

- **GIVEN** una factura de señal en `borrador` con PDF disponible y datos fiscales válidos
- **WHEN** el Gestor pulsa "Aprobar factura"
- **THEN** `FACTURA.estado = 'enviada'` y `FACTURA.fecha_emision` queda con el timestamp actual
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado =
  'borrador'` y `datos_nuevos.estado = 'enviada'`

#### Scenario: No se puede aprobar un borrador inválido o sin PDF

- **GIVEN** una factura de señal en `borrador` marcada inválida o con `pdf_url = null`
- **WHEN** el Gestor intenta aprobarla
- **THEN** el sistema rechaza la aprobación indicando el motivo del bloqueo (datos fiscales
  incompletos / PDF pendiente) y la factura permanece en `borrador`

### Requirement: Rechazo del borrador por el Gestor

El sistema SHALL (DEBE) permitir al Gestor **rechazar** el borrador de la factura de señal
indicando un motivo. Al rechazar, `FACTURA.estado` **permanece en `'borrador'`**, el motivo se
registra en `AUDIT_LOG` y **E3 queda bloqueado**; el Gestor puede resolver la incidencia (p. ej.
corregir los datos del tenant en configuración) y **regenerar el PDF** para volver a revisar.
(Fuente: `US-022 §Gestor rechaza el borrador`.)

#### Scenario: Rechazar el borrador lo mantiene en borrador y registra el motivo

- **GIVEN** una factura de señal en `borrador` que el Gestor considera incorrecta (p. ej. datos
  del tenant erróneos)
- **WHEN** el Gestor pulsa "Rechazar borrador" e indica el motivo
- **THEN** `FACTURA.estado` permanece en `'borrador'`, el motivo se registra en `AUDIT_LOG` y
  E3 queda bloqueado
- **AND** el Gestor puede corregir la incidencia y regenerar el PDF para volver a revisar

### Requirement: Concurrencia de la numeración — colisión resuelta por UNIQUE + reintento

El sistema SHALL (DEBE) resolver la colisión de `numero_factura` entre dos facturas de señal de
**reservas distintas del mismo `tenant_id`** generadas de forma concurrente mediante la
restricción `UNIQUE(tenant_id, numero_factura)` de BD y un **reintento aplicativo con el
siguiente número disponible**: cuando dos transacciones calculan el mismo `NNNN`, una inserción
falla (`P2002`), el sistema recalcula el siguiente número y reintenta; ambas facturas quedan
con números consecutivos, **sin duplicados y sin ninguna factura sin número**. La serialización
es del motor SQL (constraint + reintento), **nunca** mediante locks distribuidos (Redis/Redlock).
(Fuente: `US-022 §Concurrencia / Race Conditions`; `CLAUDE.md §Regla crítica: bloqueo atómico`;
`er-diagram.md §4.1`.)

#### Scenario: Dos reservas del mismo tenant confirmadas a la vez no duplican el número

- **GIVEN** dos RESERVAS distintas del mismo `tenant_id` que se confirman de forma concurrente
  y generan su factura de señal en el mismo instante
- **WHEN** ambas intentan asignar el siguiente `numero_factura` `F-YYYY-NNNN`
- **THEN** la restricción `UNIQUE(tenant_id, numero_factura)` hace fallar una inserción; el
  sistema reintenta con el siguiente número disponible
- **AND** ambas facturas quedan con números únicos y consecutivos, sin ninguna sin número ni
  con número repetido

### Requirement: Generación automática de la factura de liquidación en borrador al activar los sub-procesos

El sistema SHALL (DEBE), como efecto **posterior al commit** de la transición de la RESERVA a
`reserva_confirmada` y de la activación de sus sub-procesos (US-021), cuando `RESERVA.estado =
'reserva_confirmada'` Y `RESERVA.liquidacion_status = 'pendiente'`, crear **una** FACTURA con
`tipo = 'liquidacion'`, `estado = 'borrador'`, `reserva_id` de la RESERVA, `tenant_id` correcto,
`numero_factura = NULL` y `total = RESERVA.importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE
factura_id IS NULL)` de esa reserva. `RESERVA.importe_liquidacion` viene **congelado** de US-021
(`importe_total − importe_senal`, 60 % MVP): el sistema NO recalcula el porcentaje ni la tarifa,
y **suma** los `subtotal` ya congelados por línea sin recalcularlos. El sistema NO marca los
`RESERVA_EXTRA` con `factura_id` en la fase de borrador (ese marcado ocurre al emitir, US-028).
El fallo de esta generación NO revierte la confirmación ya realizada. (Fuente: `US-027 §Historia`,
`§Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`; UC-21; `er-diagram.md §3.12 FACTURA`,
`§3.10 RESERVA_EXTRA`.)

#### Scenario: Liquidación con extras pendientes suma el 60 % y los extras con factura_id nulo

- **GIVEN** una RESERVA que ha transitado a `reserva_confirmada` con `importe_liquidacion =
  3.600,00 €` y dos `RESERVA_EXTRA` con `factura_id IS NULL` de subtotales `300,00 €` y `200,00 €`
- **WHEN** el sistema genera la factura de liquidación al activar los sub-procesos
- **THEN** se crea una FACTURA con `tipo = 'liquidacion'`, `estado = 'borrador'`, `numero_factura
  = NULL`, `total = 4.100,00 €`, `reserva_id` de la RESERVA y `tenant_id` correcto

#### Scenario: Liquidación sin extras pendientes es solo el 60 %

- **GIVEN** una RESERVA `reserva_confirmada` con `importe_liquidacion = 3.600,00 €` sin ningún
  `RESERVA_EXTRA` con `factura_id IS NULL`
- **WHEN** el sistema genera la factura de liquidación
- **THEN** la FACTURA de liquidación tiene `total = 3.600,00 €` (solo el 60 % sin extras)

### Requirement: Desglose fiscal de la factura de liquidación con IVA 21 % y redondeo contable

El sistema SHALL (DEBE) calcular el desglose fiscal de la factura de liquidación derivando la base
del total, con el **mismo criterio** que la factura de señal (US-022): `iva_porcentaje = 21,00`;
`base_imponible = round(total / 1,21, 2)`; `iva_importe = total − base_imponible`. El redondeo es
**contable a 2 decimales (mitad hacia arriba)** y el `iva_importe` se obtiene **por resta** del
total, de modo que `base_imponible + iva_importe = total` **exactamente**. El cálculo del desglose
es lógica de **dominio puro** y **reutiliza** la función ya existente de `facturacion`. (Fuente:
`US-027 §Happy Path` `base = (3.600 + 500) / 1,21 ≈ 3.388,43`, `iva ≈ 711,57`, `§Reglas de
Validación` IVA 21 %; `er-diagram.md §3.12` base/iva derivados.)

#### Scenario: 4.100 € de total desglosa 3.388,43 base + 711,57 IVA

- **GIVEN** una factura de liquidación con `total = 4.100,00 €`
- **WHEN** el sistema calcula el desglose fiscal
- **THEN** `iva_porcentaje = 21,00`, `base_imponible = 3.388,43 €`, `iva_importe = 711,57 €`
- **AND** `base_imponible + iva_importe = total` exactamente

### Requirement: Generación automática del recibo de fianza en borrador

El sistema SHALL (DEBE), al activar los sub-procesos de una RESERVA `reserva_confirmada` con
`fianza_status = 'pendiente'` y `TENANT_SETTINGS.fianza_default_eur > 0`, crear **una** FACTURA
con `tipo = 'fianza'`, `estado = 'borrador'`, `reserva_id`, `tenant_id`, `numero_factura = NULL`
y `total = TENANT_SETTINGS.fianza_default_eur`. La generación del recibo de fianza es
**independiente** de la de la factura de liquidación: la ausencia de una no impide la otra.
(Fuente: `US-027 §Happy Path`, `§Reglas de negocio`; `er-diagram.md §TENANT_SETTINGS
fianza_default_eur`.)

#### Scenario: Recibo de fianza en borrador por el importe por defecto del tenant

- **GIVEN** una RESERVA `reserva_confirmada` con `fianza_status = 'pendiente'` y
  `TENANT_SETTINGS.fianza_default_eur = 1.000,00 €`
- **WHEN** el sistema activa los sub-procesos
- **THEN** se crea una FACTURA con `tipo = 'fianza'`, `estado = 'borrador'`, `numero_factura =
  NULL` y `total = 1.000,00 €`

### Requirement: Omisión del recibo de fianza cuando el importe por defecto es cero

El sistema SHALL (DEBE), si `TENANT_SETTINGS.fianza_default_eur = 0`, **NO generar** la FACTURA
de tipo `fianza`; `RESERVA.fianza_status` **permanece `pendiente`** (no se marca como facturado
ni se crea documento) y la alerta al Gestor menciona **solo** la factura de liquidación. El
Gestor podrá generar el recibo manualmente con un importe negociado en una US posterior. La
factura de liquidación se genera igualmente. (Fuente: `US-027 §TENANT_SETTINGS.fianza_default_eur
= 0`.)

#### Scenario: Fianza por defecto cero no genera recibo y deja fianza_status pendiente

- **GIVEN** una RESERVA `reserva_confirmada` con `TENANT_SETTINGS.fianza_default_eur = 0`
- **WHEN** el sistema activa los sub-procesos
- **THEN** NO se crea ninguna FACTURA de tipo `fianza`
- **AND** `RESERVA.fianza_status` permanece `pendiente` y la alerta al Gestor menciona solo la
  factura de liquidación

### Requirement: Numeración diferida a la emisión — numero_factura nulo en borrador

El sistema SHALL (DEBE) crear los borradores de liquidación y de fianza con `numero_factura =
NULL`. La asignación del `numero_factura` con formato `F-YYYY-NNNN` (secuencial y único por
`tenant_id` + año) se produce **solo al emitir/enviar** el documento (US-028), reutilizando la
numeración ya definida en `facturacion` (US-022). En borrador, la ausencia de `numero_factura`
NO viola la unicidad `UNIQUE(tenant_id, numero_factura)`, que solo aplica a valores no nulos.
(Fuente: `US-027 §Reglas de negocio` `numero_factura` no se asigna en borrador, `§Reglas de
Validación`.)

#### Scenario: Los borradores de liquidación y fianza no llevan número de factura

- **GIVEN** una RESERVA `reserva_confirmada` para la que se generan los borradores de liquidación
  y fianza
- **WHEN** el sistema crea ambas FACTURA en `borrador`
- **THEN** ambas tienen `numero_factura = NULL` y solo recibirán `F-YYYY-NNNN` al emitirse (US-028)

### Requirement: Idempotencia — una única liquidación y un único recibo de fianza por reserva

El sistema SHALL (DEBE) garantizar que exista **como máximo una** FACTURA con `tipo =
'liquidacion'` y **como máximo una** con `tipo = 'fianza'` por `reserva_id` en estado `borrador`
o `enviada`. Antes de crear cada documento, el sistema comprueba si ya existe una FACTURA con ese
`reserva_id` y ese `tipo`; si existe, **NO crea un duplicado** (operación idempotente, sin efecto
secundario). La unicidad la refuerza en BD la restricción `UNIQUE(reserva_id, tipo)` ya
introducida en US-022 (cubre `senal`, `liquidacion` y `fianza`): una reinvocación concurrente del
trigger que sortee la guarda aborta por `P2002` y recupera la existente. (Fuente: `US-027
§Idempotencia — trigger duplicado`, `§Reglas de Validación`.)

#### Scenario: Reinvocación del trigger no duplica los borradores de liquidación ni de fianza

- **GIVEN** una RESERVA que ya tiene una FACTURA `tipo = 'liquidacion'` y una `tipo = 'fianza'`
  en `borrador`
- **WHEN** el trigger de activación de sub-procesos se ejecuta de nuevo para esa RESERVA
- **THEN** el sistema detecta los borradores existentes y **no** crea documentos duplicados
- **AND** la operación no tiene efecto secundario (idempotente)

### Requirement: Alerta al Gestor de documentos pendientes de revisión

El sistema SHALL (DEBE), tras generar los borradores, alertar al Gestor en la UI con el texto
"Documentos de liquidación y fianza pendientes de revisión". Si el recibo de fianza se omitió
por `fianza_default_eur = 0`, la alerta menciona **solo** la factura de liquidación. La alerta es
una señal de UI (no un email: E4 se dispara en US-028 tras la aprobación del Gestor). (Fuente:
`US-027 §Happy Path`, `§TENANT_SETTINGS.fianza_default_eur = 0`, `§Email relacionado`.)

#### Scenario: Con liquidación y fianza generadas, la alerta cita ambos documentos

- **GIVEN** una RESERVA para la que se han generado el borrador de liquidación y el de fianza
- **WHEN** el sistema completa la generación
- **THEN** el Gestor recibe la alerta "Documentos de liquidación y fianza pendientes de revisión"

#### Scenario: Con la fianza omitida, la alerta cita solo la liquidación

- **GIVEN** una RESERVA con `fianza_default_eur = 0` para la que solo se generó el borrador de
  liquidación
- **WHEN** el sistema completa la generación
- **THEN** la alerta al Gestor menciona solo la factura de liquidación

### Requirement: Auditoría de la creación de los borradores de liquidación y fianza

El sistema SHALL (DEBE) registrar en `AUDIT_LOG` una entrada con `accion = 'crear'`, `entidad =
'FACTURA'` y el `entidad_id` de la factura creada por **cada** documento generado (liquidación y,
si procede, fianza). Si el recibo de fianza se omitió (`fianza_default_eur = 0`), solo se registra
la creación de la liquidación. (Fuente: `US-027 §Happy Path` "ambas acciones quedan registradas en
AUDIT_LOG con accion = crear".)

#### Scenario: Crear cada borrador registra un AUDIT_LOG de creación

- **GIVEN** una RESERVA para la que se generan los borradores de liquidación y fianza
- **WHEN** el sistema crea ambas FACTURA
- **THEN** `AUDIT_LOG` registra dos entradas con `accion = 'crear'`, `entidad = 'FACTURA'`, cada
  una con el `entidad_id` de la factura correspondiente

### Requirement: Emisión de la factura de liquidación al aprobar y enviar (borrador → enviada con número asignado)

El sistema SHALL (DEBE), cuando el Gestor pulsa "Aprobar y enviar" sobre una FACTURA con `tipo =
'liquidacion'` en `estado = 'borrador'` y `RESERVA.liquidacion_status = 'pendiente'`, **emitir**
la factura: asignar `numero_factura` con formato `F-YYYY-NNNN` (secuencial y único por
`tenant_id` + año, **reutilizando la numeración de US-022** con `UNIQUE(tenant_id,
numero_factura)` + reintento aplicativo ante `P2002`, **nunca** locks distribuidos) **en el
momento de la emisión** (nunca en borrador), fijar `fecha_emision` con el timestamp actual,
pasar `FACTURA.estado = 'enviada'`, marcar los `RESERVA_EXTRA` de la reserva que se sumaron al
borrador con el `factura_id` de la liquidación emitida, y transicionar `RESERVA.liquidacion_status
= 'facturada'`. Todo ello ocurre solo si el envío del email E4 se confirma (ver atomicidad). El
sistema DEBE registrar `AUDIT_LOG` con `accion = 'actualizar'`, `datos_anteriores.estado =
'borrador'` y `datos_nuevos.estado = 'enviada'`. (Fuente: `US-028 §Happy Path`, `§Reglas de
negocio`, `§Reglas de Validación`; UC-21 pasos 3–6; `er-diagram.md §3.12 FACTURA`, `§3.10
RESERVA_EXTRA`.)

### Requirement: Nomenclatura personalizada de los adjuntos PDF de factura (E4 y envío separado)

El sistema SHALL (DEBE) nombrar los ficheros adjuntos de los emails de facturación con el
**número de factura** y el **nombre del cliente**, siguiendo el patrón
`{numeroFactura} {clienteNombre} {clienteApellidos}.pdf`. Cuando `numero_factura` sea `null`
(caso inesperado / borrador histórico), el prefijo SHALL ser el tipo de documento en español
(`Liquidación`, `Fianza`). Esta nomenclatura aplica a:
- Adjunto de **liquidación** en E4: `F-YYYY-NNNN {nombre} {apellidos}.pdf`
  (p. ej. `F-2026-0042 Mercè Escribano.pdf`)
- Adjunto de **recibo de fianza** en E4 y en el envío separado:
  `F-YYYY-NNNN {nombre} {apellidos}.pdf` (p. ej. `F-2026-0009 Mercè Escribano.pdf`)
- Adjunto de **señal** en E3 y su reenvío: ya implementado con el mismo patrón
  (change `factura-senal-pdf-idioma-email-ux`)

#### Scenario: El adjunto de liquidación lleva el número y el nombre del cliente

- **GIVEN** una emisión de liquidación con `numero_factura = 'F-2026-0042'` y un cliente
  con nombre `Mercè` y apellidos `Escribano`
- **WHEN** se envía el E4
- **THEN** el adjunto de liquidación tiene `nombre = 'F-2026-0042 Mercè Escribano.pdf'`

#### Scenario: El adjunto de fianza lleva su propio número y el nombre del cliente

- **GIVEN** un recibo de fianza con `numero_factura = 'F-2026-0043'` y el mismo cliente
- **WHEN** se envía el E4 (o el envío separado del recibo)
- **THEN** el adjunto de fianza tiene `nombre = 'F-2026-0043 Mercè Escribano.pdf'`

#### Scenario: Aprobar y enviar emite la liquidación con número y la deja enviada

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'borrador'` con `numero_factura =
  NULL`, PDF disponible y datos fiscales válidos, y `RESERVA.liquidacion_status = 'pendiente'`
- **WHEN** el Gestor pulsa "Aprobar y enviar" y el envío de E4 se confirma
- **THEN** `FACTURA.estado = 'enviada'`, `numero_factura = 'F-{año}-NNNN'` (secuencial, único
  por `tenant_id` + año), `fecha_emision` con el timestamp actual
- **AND** `RESERVA.liquidacion_status = 'facturada'` y los `RESERVA_EXTRA` sumados al borrador
  quedan marcados con el `factura_id` de la liquidación
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado = 'borrador'`
  y `datos_nuevos.estado = 'enviada'`

#### Scenario: El número de factura se asigna solo en la emisión, nunca en borrador

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `borrador` con `numero_factura = NULL`
- **WHEN** el Gestor todavía no ha aprobado
- **THEN** `numero_factura` permanece `NULL`
- **AND** solo al emitir (aprobar y enviar con E4 confirmado) recibe su `F-{año}-NNNN`

### Requirement: Atomicidad entre la transición de estado y el envío de E4 (rollback ante fallo)

El sistema SHALL (DEBE) hacer **atómicos** la transición de estado de la emisión y el envío del
email E4: la asignación de `numero_factura`, `FACTURA (liquidacion).estado = 'enviada'`,
`RESERVA.liquidacion_status = 'facturada'`, el marcado de los `RESERVA_EXTRA`, la emisión del
recibo de fianza (`FACTURA (fianza).estado = 'enviada'`, `RESERVA.fianza_status =
'recibo_enviado'`) y el registro de `COMUNICACION` E4 se consolidan **solo si el envío de E4 se
confirma**. Si la **generación del PDF** de cualquiera de los adjuntos o el **envío de E4**
falla, el sistema DEBE hacer **rollback** de todos los cambios de estado: ambas FACTURA
**permanecen en `borrador`**, `numero_factura` **NO se asigna** (permanece `NULL`),
`RESERVA.liquidacion_status` permanece `pendiente`, los `RESERVA_EXTRA` **no** se marcan; el
sistema muestra un **error recuperable** y el Gestor puede **reintentar**. Esta atomicidad
**invierte** deliberadamente el patrón "post-commit, fallo no revierte" de E2/E6/E7 (US-045),
porque US-028 exige que si E4 falla los estados no cambien. (Fuente: `US-028 §Reglas de negocio`
atomicidad, `§Fallo en la generación del PDF o en el envío del email`, `§Reglas de Validación`;
`design.md §D-1`.)

#### Scenario: Fallo del PDF o del email deja todo en borrador y permite reintento

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `borrador` y una `tipo = 'fianza'` en
  `borrador`, con `RESERVA.liquidacion_status = 'pendiente'`
- **WHEN** el Gestor pulsa "Aprobar y enviar" pero la generación del PDF del adjunto o el envío
  de E4 falla
- **THEN** ambas FACTURA permanecen en `estado = 'borrador'` con `numero_factura = NULL`
- **AND** `RESERVA.liquidacion_status` permanece `pendiente` y los `RESERVA_EXTRA` siguen sin
  `factura_id`
- **AND** el sistema muestra un error recuperable y el Gestor puede reintentar

#### Scenario: Solo con E4 confirmado se consolidan los cambios de estado

- **GIVEN** una emisión de liquidación en curso cuyo envío de E4 aún no se ha confirmado
- **WHEN** el proveedor de email confirma el envío de E4
- **THEN** se consolidan `estado = 'enviada'`, `numero_factura`, `liquidacion_status =
  'facturada'`, la emisión de la fianza y el `COMUNICACION` E4
- **AND** si el proveedor no confirma, no se consolida ninguno de esos cambios

### Requirement: Ajuste del importe (descuento negociado) antes de aprobar

El sistema SHALL (DEBE) permitir al Gestor **ajustar** el borrador de la factura de liquidación
(aplicar un descuento negociado o corregir extras) **mientras la FACTURA sigue en `borrador`**.
Al aplicar el ajuste, el sistema **recalcula el `total`** y su **desglose fiscal reutilizando la
función de dominio puro ya existente de `facturacion`** (US-022: `base_imponible = round(total /
1,21, 2)`, `iva_importe = total − base_imponible`, `iva_porcentaje = 21,00`, con `base + iva =
total` exacto). Al emitir con el ajuste, `RESERVA.importe_liquidacion` se **actualiza** con el
nuevo importe y el **descuento** (importe/motivo) queda registrado en `AUDIT_LOG`. El ajuste es
**manual del Gestor**: el sistema NO recalcula tarifa ni porcentaje. (Fuente: `US-028 §Gestor
ajusta el importe antes de aprobar`; `design.md §D-2`.)

#### Scenario: Un descuento de 200 € emite la factura por 3.900 € con desglose recalculado

- **GIVEN** un borrador de liquidación con `total = 4.100,00 €` y el Gestor aplica un descuento
  de 200,00 €
- **WHEN** el Gestor modifica el descuento y pulsa "Aprobar y enviar"
- **THEN** la FACTURA se emite con `total = 3.900,00 €`, `base_imponible = 3.223,14 €`,
  `iva_importe = 676,86 €` (`base + iva = total` exacto)
- **AND** `RESERVA.importe_liquidacion` se actualiza a 3.900,00 € y el descuento queda en
  `AUDIT_LOG`

### Requirement: Emisión del recibo de fianza como efecto del envío de E4

El sistema SHALL (DEBE), como **efecto del envío de E4** (que adjunta el recibo de fianza junto
con la factura de liquidación), emitir el recibo de fianza en la **misma operación atómica**:
`FACTURA (fianza).estado = 'enviada'` y `RESERVA.fianza_status = 'recibo_enviado'`. Si el recibo
de fianza ya fue enviado por separado previamente (ver requisito de envío separado), E4 **no**
vuelve a cambiar `fianza_status` ni el estado de la fianza (ya `enviada`/`recibo_enviado`), y su
adjunto en E4 puede omitirse. (Fuente: `US-028 §Happy Path`, `§Envío del recibo de fianza por
separado`; `design.md §D-3`.)

#### Scenario: Aprobar y enviar deja el recibo de fianza enviado

- **GIVEN** una emisión de liquidación cuyo envío de E4 se confirma, con la FACTURA `tipo =
  'fianza'` en `borrador` y `RESERVA.fianza_status = 'pendiente'`
- **WHEN** se consolida la emisión (E4 confirmado)
- **THEN** `FACTURA (fianza).estado = 'enviada'` y `RESERVA.fianza_status = 'recibo_enviado'`

#### Scenario: Fianza ya enviada por separado no se re-emite con E4

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` (recibo ya enviado por separado)
- **WHEN** el Gestor aprueba y envía la liquidación (E4)
- **THEN** `fianza_status` permanece `recibo_enviado` y el estado de la fianza no cambia
- **AND** E4 incluye solo la factura de liquidación

### Requirement: Envío del recibo de fianza por separado (sin la liquidación)

El sistema SHALL (DEBE) permitir al Gestor enviar el **recibo de fianza por separado** desde la
ficha de la reserva, con solo el recibo de fianza adjunto. Al hacerlo, `FACTURA (fianza).estado
= 'enviada'` y `RESERVA.fianza_status = 'recibo_enviado'`; `RESERVA.liquidacion_status` **no
cambia**. Este envío se trata como **email manual SIN código E** (no usa E4); su registro en
`COMUNICACION` usa `codigo_email = 'manual'` (ver delta de `comunicaciones`). (Fuente: `US-028
§Envío del recibo de fianza por separado`; `design.md §D-3`.)

#### Scenario: El envío separado marca la fianza sin tocar la liquidación

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'` y `liquidacion_status = 'pendiente'`,
  con el recibo de fianza en `borrador`
- **WHEN** el Gestor selecciona "Enviar recibo de fianza por separado"
- **THEN** `FACTURA (fianza).estado = 'enviada'` y `RESERVA.fianza_status = 'recibo_enviado'`
- **AND** `RESERVA.liquidacion_status` permanece `pendiente` (la liquidación no se ve afectada)

### Requirement: Reenvío de la factura de liquidación ya emitida sin reasignar número ni estado

El sistema SHALL (DEBE), cuando `FACTURA (liquidacion).estado = 'enviada'` y el Gestor pulsa
"Reenviar factura de liquidación", **reenviar el PDF ya emitido** al email del cliente **sin
modificar** el `numero_factura` ni el `estado` de la factura y **sin** cambiar los status de la
RESERVA. Cada reenvío crea un **nuevo** registro `COMUNICACION` con `codigo_email = 'E4'` (ver
delta de `comunicaciones`). (Fuente: `US-028 §Factura ya enviada (reenvío)`; `design.md §D-4`.)

#### Scenario: El reenvío no reasigna ni modifica la factura emitida

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'enviada'` con `numero_factura =
  'F-{año}-NNNN'`
- **WHEN** el Gestor pulsa "Reenviar factura de liquidación"
- **THEN** el sistema reenvía el PDF ya emitido al email del cliente
- **AND** `numero_factura` y `estado` permanecen sin cambios y no se modifican los status de la
  reserva

### Requirement: Solo se puede aprobar y enviar desde borrador; el estado facturada no retrocede

El sistema SHALL (DEBE) permitir la acción "Aprobar y enviar" **solo si** `FACTURA
(liquidacion).estado = 'borrador'`. Si la factura ya está `enviada`, el sistema DEBE **rechazar**
una nueva aprobación (la vía disponible es el reenvío, que no reasigna nada). El sistema NO DEBE
permitir el retroceso de `RESERVA.liquidacion_status` de `facturada` a `pendiente` (no modelado
en MVP). (Fuente: `US-028 §Reglas de Validación`.)

#### Scenario: No se puede aprobar una factura que ya está enviada

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'enviada'`
- **WHEN** el Gestor intenta "Aprobar y enviar" de nuevo
- **THEN** el sistema rechaza la acción indicando que ya está emitida
- **AND** no reasigna `numero_factura` ni cambia el estado

#### Scenario: liquidacion_status no retrocede de facturada a pendiente

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'`
- **WHEN** ocurre cualquier flujo del sistema en el MVP
- **THEN** `liquidacion_status` no retrocede a `pendiente` (no hay transición inversa modelada)

### Requirement: Registro del cobro de la liquidación (creación de PAGO y transición a cobrada)

El sistema SHALL (DEBE), cuando el Gestor registra el cobro de la liquidación sobre una RESERVA con
`liquidacion_status = 'facturada'` y su `FACTURA (tipo = 'liquidacion')` en `estado = 'enviada'`, en una
**única unidad transaccional atómica**: crear un registro `PAGO` con `factura_id` de la factura de
liquidación, `importe` (el importe real cobrado), `fecha_cobro` y, si el Gestor adjunta un justificante,
`justificante_doc_id`; transicionar `FACTURA (liquidacion).estado = 'cobrada'`; y transicionar
`RESERVA.liquidacion_status = 'cobrada'`. El sistema DEBE registrar `AUDIT_LOG` con `accion = 'crear'`
para el `PAGO` (y para el `DOCUMENTO` del justificante si se adjunta) y con `accion = 'actualizar'` para
la transición de estados de la FACTURA y de la RESERVA. El `PAGO` NO recalcula el desglose fiscal de la
factura (inmutable desde la emisión). (Fuente: `US-029 §Happy Path`, `§Reglas de negocio`; UC-21 pasos
7–10; `er-diagram.md §3.13 PAGO`, `§3.12 FACTURA`.)

#### Scenario: Registrar el cobro con justificante deja la liquidación cobrada

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'` y una `FACTURA (tipo = 'liquidacion')` en
  `estado = 'enviada'` con `total = 4.100,00 €`
- **WHEN** el Gestor registra el cobro con `fecha_cobro = 2026-06-15`, `importe = 4.100,00 €` y adjunta el
  justificante de transferencia (PDF)
- **THEN** se crea un `PAGO` con `factura_id` de la factura de liquidación, `importe = 4.100,00 €`,
  `fecha_cobro = 2026-06-15`
- **AND** el justificante se almacena como `DOCUMENTO (tipo = 'justificante_pago')` y
  `PAGO.justificante_doc_id` referencia su `id_documento`
- **AND** `FACTURA (liquidacion).estado = 'cobrada'` y `RESERVA.liquidacion_status = 'cobrada'`
- **AND** `AUDIT_LOG` registra la creación del `PAGO` y la transición de estados

### Requirement: El justificante de pago es opcional

El sistema SHALL (DEBE) permitir registrar el cobro **sin** adjuntar justificante. En ese caso el `PAGO`
se crea con `justificante_doc_id = NULL` y el estado avanza igualmente a `cobrada`
(`FACTURA (liquidacion).estado = 'cobrada'`, `RESERVA.liquidacion_status = 'cobrada'`). El cobro es
válido sin justificante; el Gestor podrá adjuntar el justificante en un momento posterior (funcionalidad
diferida a una US posterior). (Fuente: `US-029 §Cobro registrado sin justificante`, `§Reglas de negocio`.)

#### Scenario: Cobro sin justificante avanza igualmente a cobrada

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'` y su factura de liquidación en `enviada`,
  y el Gestor no dispone del justificante en este momento
- **WHEN** el Gestor registra el cobro sin adjuntar ningún documento
- **THEN** se crea el `PAGO` con `justificante_doc_id = NULL`
- **AND** `FACTURA (liquidacion).estado = 'cobrada'` y `RESERVA.liquidacion_status = 'cobrada'`

### Requirement: Discrepancia de importe alerta pero no bloquea el cobro

El sistema SHALL (DEBE), si el `importe` introducido difiere del `FACTURA (liquidacion).total`,
**crear igualmente el `PAGO`** con el importe real introducido y **avanzar** el estado a `cobrada`, sin
bloquear el registro. El sistema DEBE devolver una **alerta informativa de discrepancia** (importe
facturado, importe cobrado y diferencia) para que el Gestor la concilie, y DEBE registrar la discrepancia
en `AUDIT_LOG`. El sistema NO ajusta la factura ni genera nota de crédito: la conciliación se **delega al
Gestor**. (Fuente: `US-029 §Importe cobrado diferente al facturado`, `§Reglas de negocio`.)

#### Scenario: Importe cobrado menor al facturado crea el PAGO y alerta sin bloquear

- **GIVEN** una `FACTURA (liquidacion)` por `4.100,00 €` con `RESERVA.liquidacion_status = 'facturada'`
- **WHEN** el Gestor registra el cobro con `importe = 4.000,00 €` y confirma
- **THEN** se crea el `PAGO` con `importe = 4.000,00 €` (el importe real) y el estado avanza a `cobrada`
- **AND** el sistema devuelve una alerta de discrepancia (facturado `4.100,00 €`, cobrado `4.000,00 €`,
  diferencia `100,00 €`) sin bloquear el registro
- **AND** la discrepancia queda registrada en `AUDIT_LOG`

### Requirement: Guarda contra el doble cobro de la liquidación

El sistema SHALL (DEBE), si `RESERVA.liquidacion_status = 'cobrada'` (el cobro ya fue registrado),
**rechazar** un nuevo intento de registrar el cobro con un error informativo ("La liquidación ya está
marcada como cobrada") y **NO crear ningún `PAGO` adicional**. La guarda se evalúa **dentro de la
transacción** releyendo el estado de la RESERVA con bloqueo de fila (`SELECT ... FOR UPDATE`) de
PostgreSQL, de modo que dos peticiones concurrentes se serializan y solo la primera registra el cobro; la
segunda ve `cobrada` y aborta. La serialización es del motor SQL (lock de fila), **nunca** mediante locks
distribuidos (Redis/Redlock). (Fuente: `US-029 §Intento de doble cobro`, `§Reglas de Validación`;
`CLAUDE.md §Regla crítica: bloqueo atómico`; `design.md §D-2`.)

#### Scenario: Segundo intento de cobro sobre liquidación ya cobrada se rechaza

- **GIVEN** una RESERVA con `liquidacion_status = 'cobrada'` (el cobro ya fue registrado con su `PAGO`)
- **WHEN** el Gestor intenta registrar otro cobro de liquidación
- **THEN** el sistema rechaza la acción con "La liquidación ya está marcada como cobrada"
- **AND** no se crea ningún `PAGO` adicional

#### Scenario: Dos registros de cobro concurrentes solo crean un PAGO

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'` sobre la que llegan dos peticiones de
  registro de cobro concurrentes
- **WHEN** ambas transacciones intentan registrar el cobro a la vez
- **THEN** el bloqueo de fila (`SELECT ... FOR UPDATE`) serializa las transacciones: la primera crea el
  `PAGO` y deja `liquidacion_status = 'cobrada'`; la segunda ve `cobrada` y aborta
- **AND** existe **un único** `PAGO` para la liquidación, sin doble cobro

### Requirement: Precondición de estado — solo se cobra desde facturada

El sistema SHALL (DEBE) permitir el registro del cobro **solo si** `RESERVA.liquidacion_status =
'facturada'`. Si `liquidacion_status = 'pendiente'` (la factura de liquidación aún no fue enviada,
US-028 no ejecutada), el sistema DEBE **bloquear** la acción con el mensaje "La factura de liquidación
debe estar enviada antes de registrar su cobro" y NO crear `PAGO`. `FACTURA (liquidacion).estado` solo
pasa a `cobrada` cuando se crea el `PAGO` correspondiente (en la misma transacción). (Fuente: `US-029
§liquidacion_status = pendiente`, `§Reglas de Validación`.)

#### Scenario: Registrar cobro con liquidacion_status pendiente se bloquea

- **GIVEN** una RESERVA con `liquidacion_status = 'pendiente'` (la factura de liquidación aún no fue
  enviada)
- **WHEN** el Gestor intenta registrar el cobro de liquidación
- **THEN** el sistema bloquea la acción con "La factura de liquidación debe estar enviada antes de
  registrar su cobro"
- **AND** no se crea ningún `PAGO` y el estado no cambia

### Requirement: Validación de fecha de cobro no futura e importe positivo

El sistema SHALL (DEBE) validar, antes de crear el `PAGO`, que `PAGO.fecha_cobro` sea una fecha válida
**≤ hoy** (no futura) y que `PAGO.importe` sea **> 0**. Si alguna validación falla, el sistema DEBE
**rechazar** el registro sin crear `PAGO` ni cambiar el estado, devolviendo un error de validación. Estas
validaciones son lógica de **dominio puro**. (Fuente: `US-029 §Reglas de Validación`; `design.md §D-2`.)

#### Scenario: Fecha de cobro futura se rechaza

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'`
- **WHEN** el Gestor introduce una `fecha_cobro` posterior a hoy
- **THEN** el sistema rechaza el registro con un error de validación y no crea `PAGO` ni cambia el estado

#### Scenario: Importe no positivo se rechaza

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'`
- **WHEN** el Gestor introduce `importe = 0` (o negativo)
- **THEN** el sistema rechaza el registro con un error de validación y no crea `PAGO` ni cambia el estado

### Requirement: El cobro habilita una precondición del inicio del evento sin transicionar la reserva

El sistema SHALL (DEBE), al dejar `RESERVA.liquidacion_status = 'cobrada'`, habilitar **una de las tres
precondiciones** de la futura transición `reserva_confirmada → evento_en_curso` (las otras dos son
`pre_evento_status = 'cerrado'` y `fianza_status = 'cobrada'`, US-031). Este requisito **NO** transiciona
por sí mismo el `RESERVA.estado` a `evento_en_curso` ni evalúa las otras precondiciones: la transición se
modela en US-031. (Fuente: `US-029 §Reglas de negocio`; `er-diagram.md §guarda evento_en_curso`.)

#### Scenario: Tras el cobro, el estado de la reserva no avanza a evento_en_curso

- **GIVEN** una RESERVA `reserva_confirmada` cuyo cobro de liquidación se acaba de registrar
  (`liquidacion_status = 'cobrada'`)
- **WHEN** el sistema completa el registro del cobro
- **THEN** `RESERVA.liquidacion_status = 'cobrada'` queda disponible como precondición del inicio del
  evento
- **AND** `RESERVA.estado` permanece `reserva_confirmada` (la transición a `evento_en_curso` es de US-031)

### Requirement: Registro del cobro de la fianza (creación de PAGO y transición a cobrada)

El sistema SHALL (DEBE), cuando el Gestor registra el cobro de la fianza sobre una RESERVA con
`fianza_status = 'recibo_enviado'` y su `FACTURA (tipo = 'fianza')` en `estado = 'enviada'`, en una
**única unidad transaccional atómica**: crear un registro `PAGO` con `factura_id` del recibo de fianza,
`importe` (el importe real cobrado), `fecha_cobro` y, si el Gestor adjunta un justificante,
`justificante_doc_id`; establecer `RESERVA.fianza_eur = importe` cobrado y `RESERVA.fianza_cobrada_fecha
= fecha_cobro`; transicionar `FACTURA (fianza).estado = 'cobrada'`; y transicionar `RESERVA.fianza_status
= 'cobrada'`. El sistema DEBE registrar `AUDIT_LOG` con `accion = 'crear'` para el `PAGO` (y para el
`DOCUMENTO` del justificante si se adjunta) y con `accion = 'actualizar'` para la transición de estados
de la FACTURA y de la RESERVA (incluidos `fianza_eur` y `fianza_cobrada_fecha`). El `PAGO` NO recalcula
el desglose fiscal de la factura (inmutable desde la emisión). (Fuente: `US-030 §Happy Path`, `§Reglas de
negocio`; UC-22 pasos 5–9; `er-diagram.md §3.13 PAGO`, `§3.12 FACTURA`.)

#### Scenario: Registrar el cobro con justificante deja la fianza cobrada

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'`, `fecha_evento = 2026-07-12` y una
  `FACTURA (tipo = 'fianza')` en `estado = 'enviada'`
- **WHEN** el Gestor registra el cobro con `fecha_cobro = 2026-07-10` (dos días antes del evento),
  `importe = 1.000,00 €` y adjunta el justificante de transferencia (PDF)
- **THEN** se crea un `PAGO` con `factura_id` del recibo de fianza, `importe = 1.000,00 €`, `fecha_cobro
  = 2026-07-10`
- **AND** el justificante se almacena como `DOCUMENTO (tipo = 'justificante_pago')` y
  `PAGO.justificante_doc_id` referencia su `id_documento`
- **AND** `RESERVA.fianza_eur = 1000.00` y `RESERVA.fianza_cobrada_fecha = 2026-07-10`
- **AND** `FACTURA (fianza).estado = 'cobrada'` y `RESERVA.fianza_status = 'cobrada'`
- **AND** `AUDIT_LOG` registra la creación del `PAGO` y la transición de estados

### Requirement: El justificante de pago de la fianza es opcional

El sistema SHALL (DEBE) permitir registrar el cobro de la fianza **sin** adjuntar justificante (por
ejemplo, cuando el Gestor recibe la fianza en efectivo el día del evento). En ese caso el `PAGO` se crea
con `justificante_doc_id = NULL` y el estado avanza igualmente a `cobrada` (`FACTURA (fianza).estado =
'cobrada'`, `RESERVA.fianza_status = 'cobrada'`, con `fianza_eur` y `fianza_cobrada_fecha` actualizados).
El cobro es válido sin justificante. (Fuente: `US-030 §Cobro sin justificante`, `§Reglas de negocio`.)

#### Scenario: Cobro de fianza sin justificante avanza igualmente a cobrada

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` y su recibo de fianza en `enviada`, y el
  Gestor recibe la fianza en efectivo sin justificante digital
- **WHEN** el Gestor registra el cobro sin adjuntar ningún documento
- **THEN** se crea el `PAGO` con `justificante_doc_id = NULL`
- **AND** `FACTURA (fianza).estado = 'cobrada'`, `RESERVA.fianza_status = 'cobrada'`, y `fianza_eur` /
  `fianza_cobrada_fecha` quedan registrados

### Requirement: El cobro de la fianza se admite en cualquier fecha hasta el día del evento

El sistema SHALL (DEBE) admitir el registro del cobro de la fianza en cualquier momento **antes o el
mismo día del evento**, sin fecha mínima: cualquier `fecha_cobro ≤ RESERVA.fecha_evento` es válida,
incluida `fecha_cobro = fecha_evento` (cobro en T-0), que se procesa **sin diferencia** respecto al
happy path. (Fuente: `US-030 §Cobro el mismo día del evento (T-0)`, `§Reglas de Validación`.)

#### Scenario: Cobro el mismo día del evento (T-0) se acepta como el happy path

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` y `fecha_evento = hoy`
- **WHEN** el Gestor registra el cobro con `fecha_cobro = hoy` (T-0)
- **THEN** el sistema acepta el cobro sin diferencia respecto al happy path
- **AND** `FACTURA (fianza).estado = 'cobrada'` y `RESERVA.fianza_status = 'cobrada'`

### Requirement: Guarda contra el doble cobro de la fianza

El sistema SHALL (DEBE), si `RESERVA.fianza_status = 'cobrada'` (el cobro ya fue registrado), **rechazar**
un nuevo intento de registrar el cobro de fianza con un error informativo ("La fianza ya está marcada como
cobrada") y **NO crear ningún `PAGO` adicional**. La guarda se evalúa **dentro de la transacción**
releyendo el estado de la RESERVA con bloqueo de fila (`SELECT ... FOR UPDATE`) de PostgreSQL, de modo que
dos peticiones concurrentes se serializan y solo la primera registra el cobro; la segunda ve `cobrada` y
aborta. La serialización es del motor SQL (lock de fila), **nunca** mediante locks distribuidos
(Redis/Redlock). (Fuente: `US-030 §Intento de doble cobro`, `§Reglas de Validación`; `CLAUDE.md §Regla
crítica: bloqueo atómico`; `design.md §D-1`.)

#### Scenario: Segundo intento de cobro sobre fianza ya cobrada se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'cobrada'` (el cobro ya fue registrado con su `PAGO`)
- **WHEN** el Gestor intenta registrar otro cobro de fianza
- **THEN** el sistema rechaza la acción con "La fianza ya está marcada como cobrada"
- **AND** no se crea ningún `PAGO` adicional

#### Scenario: Dos registros de cobro de fianza concurrentes solo crean un PAGO

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` sobre la que llegan dos peticiones de
  registro de cobro de fianza concurrentes
- **WHEN** ambas transacciones intentan registrar el cobro a la vez
- **THEN** el bloqueo de fila (`SELECT ... FOR UPDATE`) serializa las transacciones: la primera crea el
  `PAGO` y deja `fianza_status = 'cobrada'`; la segunda ve `cobrada` y aborta
- **AND** existe **un único** `PAGO` para la fianza, sin doble cobro

### Requirement: Política "Negociable" — el cobro con fianza pendiente avisa pero no bloquea

El sistema SHALL (DEBE), si `RESERVA.fianza_status = 'pendiente'` (el recibo de fianza nunca fue enviado
al cliente), **NO bloquear de forma dura** el registro del cobro, sino aplicar la política **"Negociable"**:
emitir un **aviso** ("El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro
igualmente?") y requerir una **confirmación explícita** del Gestor. Si el Gestor **confirma**, el cobro se
registra igualmente (crea el `PAGO`, avanza `FACTURA (fianza).estado = 'cobrada'` y `RESERVA.fianza_status
= 'cobrada'`, actualiza `fianza_eur`/`fianza_cobrada_fecha`) y el flujo excepcional queda **trazado en
`AUDIT_LOG`** (cobro registrado sobre fianza no enviada). Si el Gestor **cancela**, el sistema **no
realiza ninguna acción** (no crea `PAGO` ni cambia el estado). Este comportamiento **diverge** del de la
liquidación (US-029), donde el estado `pendiente` bloquea de forma dura.

En el flujo "Negociable" confirmado (`confirmarSinRecibo = true` sobre `fianza_status = 'pendiente'`), el
tratamiento de la `FACTURA (tipo = 'fianza')` queda **RESUELTO por la decisión humana D-2(b)** (Gate SDD
aprobado), sin depender de que el recibo se haya emitido:

1. **Si existe una `FACTURA (fianza)` en `estado = 'borrador'`** (recibo generado pero nunca emitido,
   `fianza_status = 'pendiente'`): el cobro confirmado la lleva **DIRECTAMENTE a `cobrada`**
   (`borrador → cobrada`, sin pasar por `enviada`), y el sistema DEBE documentar en `AUDIT_LOG` el **salto
   de estado** de la FACTURA (`borrador → cobrada`) además de la traza del cobro sobre fianza no enviada.
2. **Si NO existe ninguna `FACTURA (fianza)`** (fianza omitida porque `RESERVA.fianza_default_eur = 0`):
   el sistema DEBE **crear al vuelo** una `FACTURA (tipo = 'fianza')` para la reserva y marcarla
   directamente `estado = 'cobrada'`, dejando la correspondiente traza de **creación** de la FACTURA en
   `AUDIT_LOG` (además de la del cobro sobre fianza no enviada).

En ambos casos el resto del cobro es idéntico al happy path (se crea el `PAGO` conciliado contra esa
FACTURA(fianza), `RESERVA.fianza_status = 'cobrada'`, `fianza_eur = importe`, `fianza_cobrada_fecha =
fecha_cobro`). La ausencia del flag (`confirmarSinRecibo` no presente o `false`) sobre `pendiente` sigue
devolviendo "confirmación requerida" y **NO** crea `PAGO` ni FACTURA. (Fuente: `US-030 §Cobro con
fianza_status = pendiente`; `design.md §D-2` — **decisión D-2(b) aprobada en el Gate SDD**.)

#### Scenario: Cobro con fianza pendiente confirmado por el Gestor se registra con traza

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'` (el recibo de fianza nunca fue enviado)
- **WHEN** el Gestor intenta registrar el cobro y **confirma** el aviso "El recibo de fianza no ha sido
  enviado al cliente. ¿Desea registrar el cobro igualmente?"
- **THEN** el cobro se registra: se crea el `PAGO`, `FACTURA (fianza).estado = 'cobrada'`,
  `RESERVA.fianza_status = 'cobrada'` y `fianza_eur` / `fianza_cobrada_fecha` quedan actualizados
- **AND** `AUDIT_LOG` registra el flujo excepcional (cobro sobre fianza no enviada)

#### Scenario: Cobro con fianza pendiente cancelado por el Gestor no realiza ninguna acción

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'`
- **WHEN** el Gestor recibe el aviso "Negociable" y **cancela** en lugar de confirmar
- **THEN** el sistema no crea ningún `PAGO` y el `fianza_status` permanece `'pendiente'`

#### Scenario: Cobro confirmado con FACTURA(fianza) en borrador salta directamente a cobrada (D-2b)

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'` cuya `FACTURA (tipo = 'fianza')` existe en
  `estado = 'borrador'` (recibo generado pero nunca emitido)
- **WHEN** el Gestor registra el cobro con `confirmarSinRecibo = true`
- **THEN** la `FACTURA (fianza)` transiciona **directamente** `borrador → cobrada` (sin pasar por
  `enviada`), se crea el `PAGO` conciliado contra ella, `RESERVA.fianza_status = 'cobrada'` y
  `fianza_eur` / `fianza_cobrada_fecha` quedan actualizados
- **AND** `AUDIT_LOG` documenta el **salto de estado** de la FACTURA (`borrador → cobrada`) además de la
  traza del cobro sobre fianza no enviada

#### Scenario: Cobro confirmado sin FACTURA(fianza) crea la factura al vuelo y la marca cobrada (D-2b)

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'` y **sin** `FACTURA (tipo = 'fianza')` porque la
  fianza se omitió (`RESERVA.fianza_default_eur = 0`)
- **WHEN** el Gestor registra el cobro con `confirmarSinRecibo = true`
- **THEN** el sistema **crea al vuelo** una `FACTURA (tipo = 'fianza')` para la reserva y la marca
  directamente `estado = 'cobrada'`, crea el `PAGO` conciliado contra ella, `RESERVA.fianza_status =
  'cobrada'` y `fianza_eur` / `fianza_cobrada_fecha` quedan actualizados
- **AND** `AUDIT_LOG` registra la **creación** de la `FACTURA (fianza)` (`accion = 'crear'`) además de la
  traza del cobro sobre fianza no enviada

### Requirement: Validación de fecha de cobro no posterior al evento e importe positivo

El sistema SHALL (DEBE) validar, antes de crear el `PAGO`, que `PAGO.fecha_cobro` sea una fecha válida
**≤ `RESERVA.fecha_evento`** (no se puede registrar el cobro de la fianza después del evento) y que
`PAGO.importe` sea **> 0**. Si alguna validación falla, el sistema DEBE **rechazar** el registro sin crear
`PAGO` ni cambiar el estado, devolviendo un error de validación. `RESERVA.fianza_eur` y
`RESERVA.fianza_cobrada_fecha` se actualizan **simultáneamente** con el `PAGO`; `FACTURA (fianza).estado`
solo pasa a `cobrada` cuando se crea el `PAGO` correspondiente (en la misma transacción). Estas
validaciones son lógica de **dominio puro**. (Fuente: `US-030 §Reglas de Validación`; `design.md §D-1`.)

#### Scenario: Fecha de cobro posterior al evento se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` y `fecha_evento = 2026-07-12`
- **WHEN** el Gestor introduce una `fecha_cobro = 2026-07-13` (posterior al evento)
- **THEN** el sistema rechaza el registro con un error de validación y no crea `PAGO` ni cambia el estado

#### Scenario: Importe de fianza no positivo se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'`
- **WHEN** el Gestor introduce `importe = 0` (o negativo)
- **THEN** el sistema rechaza el registro con un error de validación y no crea `PAGO` ni cambia el estado

### Requirement: El cobro de la fianza habilita la tercera precondición del inicio del evento sin transicionar la reserva

El sistema SHALL (DEBE), al dejar `RESERVA.fianza_status = 'cobrada'`, habilitar la **tercera de las tres
precondiciones** de la futura transición `reserva_confirmada → evento_en_curso` (las otras dos son
`pre_evento_status = 'cerrado'` y `liquidacion_status = 'cobrada'`, US-031). Este requisito **NO**
transiciona por sí mismo el `RESERVA.estado` a `evento_en_curso` ni evalúa las otras precondiciones: la
transición se modela en US-031. Adicionalmente, si en el día del evento `fianza_status ≠ 'cobrada'`, la
política hardcoded "Negociable" implica que la verificación de precondiciones del inicio del evento genera
una **alerta crítica no bloqueante** ("⚠️ Fianza pendiente de cobro. Puede registrarla ahora o proceder
sin ella"): el inicio del evento **no se bloquea** por fianza impagada; el Gestor decide manualmente. La
integración de esa alerta en el flujo de transición pertenece a US-031. (Fuente: `US-030 §Reglas de
negocio`, `§Evento en T-0 con fianza sin cobrar (FA-01)`; `er-diagram.md §guarda evento_en_curso`.)

#### Scenario: Tras el cobro de la fianza, el estado de la reserva no avanza a evento_en_curso

- **GIVEN** una RESERVA `reserva_confirmada` cuyo cobro de fianza se acaba de registrar (`fianza_status =
  'cobrada'`)
- **WHEN** el sistema completa el registro del cobro
- **THEN** `RESERVA.fianza_status = 'cobrada'` queda disponible como la tercera precondición del inicio
  del evento
- **AND** `RESERVA.estado` permanece `reserva_confirmada` (la transición a `evento_en_curso` es de US-031)

#### Scenario: Evento en T-0 con fianza sin cobrar genera alerta no bloqueante (FA-01)

- **GIVEN** una RESERVA con `fecha_evento = hoy` y `fianza_status = 'recibo_enviado'` (fianza no cobrada)
- **WHEN** el sistema verifica las precondiciones para el inicio del evento
- **THEN** el sistema muestra una alerta crítica **no bloqueante** ("⚠️ Fianza pendiente de cobro. Puede
  registrarla ahora o proceder sin ella (política Negociable)")
- **AND** el inicio del evento no se bloquea por la fianza impagada; el Gestor decide manualmente

### Requirement: Registro de la devolución de la fianza con derivación del estado final y auditoría

El sistema SHALL (DEBE) permitir al **Gestor** registrar en Slotify la **devolución de la fianza** que
ha ejecutado externamente en su banca, sobre una RESERVA en `estado = 'post_evento'` con
`fianza_status = 'cobrada'` y `CLIENTE.iban_devolucion IS NOT NULL`, indicando `importe_devuelto` y
`fecha_cobro` (la fecha real del abono). En una **única unidad transaccional atómica**, el sistema
SHALL (DEBE): establecer `RESERVA.fianza_devuelta_eur = importe_devuelto` y
`RESERVA.fianza_devuelta_fecha = fecha_cobro`; **derivar** y establecer el estado final de la fianza
según el importe (`importe_devuelto == fianza_eur` ⇒ `fianza_status = 'devuelta'`; `importe_devuelto <
fianza_eur`, incluido `0,00 €`, ⇒ `fianza_status = 'retenida_parcial'`); y registrar `AUDIT_LOG` con
`accion = 'actualizar'`, `entidad = 'RESERVA'`, `datos_anteriores = {fianza_status: 'cobrada',
fianza_devuelta_eur: null, fianza_devuelta_fecha: null}` y `datos_nuevos = {fianza_status:
<devuelta|retenida_parcial>, fianza_devuelta_eur, fianza_devuelta_fecha}`. La derivación del estado
final es lógica de **dominio puro** y **no** la elige el Gestor. La acción **no** genera ninguna
FACTURA nueva (la FACTURA de tipo `fianza` ya existe desde US-030) y **no** dispara ningún email
automático (no hay código E asignado en §9.3). La acción se ejecuta bajo el contexto RLS del `tenant`
del Gestor autenticado (JWT), nunca cross-tenant. (Fuente: `US-036 §Historia`, `§Happy Path`,
`§Reglas de negocio`, `§Reglas de Validación`; UC-27 pasos 4–8; `er-diagram.md §RESERVA fianza`;
`CLAUDE.md §Multi-tenancy`.)

#### Scenario: Devolución completa deja la fianza en estado devuelta y audita

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = 'cobrada'`, `fianza_eur =
  1000.00`, `fianza_cobrada_fecha = 2026-05-15` y `CLIENTE.iban_devolucion = 'ES9121000418450200051332'`
- **WHEN** el Gestor registra `importe_devuelto = 1000.00` y `fecha_cobro = 2026-06-05`
- **THEN** el sistema deriva `fianza_status = 'devuelta'` (importe igual a la fianza cobrada)
- **AND** establece `RESERVA.fianza_devuelta_eur = 1000.00` y `RESERVA.fianza_devuelta_fecha = 2026-06-05`
- **AND** registra en `AUDIT_LOG` `accion = 'actualizar'`, `entidad = 'RESERVA'`,
  `datos_anteriores = {fianza_status: 'cobrada', fianza_devuelta_eur: null, fianza_devuelta_fecha: null}`,
  `datos_nuevos = {fianza_status: 'devuelta', fianza_devuelta_eur: 1000.00, fianza_devuelta_fecha: 2026-06-05}`

#### Scenario: El estado final se deriva del importe, no lo elige el Gestor

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1500.00`
- **WHEN** el Gestor registra `importe_devuelto = 1500.00`
- **THEN** el sistema deriva `fianza_status = 'devuelta'` sin que el Gestor seleccione el estado
- **AND** cualquier `importe_devuelto < 1500.00` derivaría `fianza_status = 'retenida_parcial'`

### Requirement: Devolución parcial o retención total deja la fianza en retenida_parcial con motivo

El sistema SHALL (DEBE), cuando `importe_devuelto < fianza_eur` (devolución parcial por desperfectos,
FA-01) o `importe_devuelto = 0,00 €` (retención total), derivar `fianza_status = 'retenida_parcial'`,
establecer `RESERVA.fianza_devuelta_eur = importe_devuelto` (`0,00 €` es un valor **válido**) y
`RESERVA.fianza_devuelta_fecha = fecha_cobro`, y **exigir** un **motivo de retención** (texto libre)
que SHALL (DEBE) quedar **persistido en el expediente de la RESERVA** (destino concreto —campo
`notas` vs. campo dedicado— fijado en el gate, `design.md §D-2`) y reflejado en `AUDIT_LOG`. En
`retenida_parcial`, la ausencia del motivo SHALL (DEBE) rechazar el registro con un error de
validación. (Fuente: `US-036 §FA-01`, `§Reglas de negocio` motivo de retención, `§Reglas de
Validación` retención total válida.)

#### Scenario: Devolución parcial por desperfectos deja la fianza en retenida_parcial (FA-01)

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1500.00`
- **WHEN** el Gestor registra `importe_devuelto = 1000.00`, `motivo_retencion = 'Daños en vajilla
  valorados en 500 €'` y `fecha_cobro = 2026-06-06`
- **THEN** el sistema deriva `fianza_status = 'retenida_parcial'`
- **AND** establece `RESERVA.fianza_devuelta_eur = 1000.00` y `RESERVA.fianza_devuelta_fecha = 2026-06-06`
- **AND** el motivo de retención queda persistido en el expediente de la RESERVA
- **AND** `AUDIT_LOG` registra `datos_nuevos = {fianza_status: 'retenida_parcial', fianza_devuelta_eur: 1000.00, ...}`

#### Scenario: Retención total (importe 0,00 €) también deja la fianza en retenida_parcial

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1000.00`
- **WHEN** el Gestor registra `importe_devuelto = 0.00` con un motivo de retención de toda la fianza
- **THEN** el sistema acepta `fianza_devuelta_eur = 0.00` como valor válido
- **AND** deriva `fianza_status = 'retenida_parcial'`

#### Scenario: Devolución parcial sin motivo de retención se rechaza

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1500.00`
- **WHEN** el Gestor registra `importe_devuelto = 1000.00` **sin** indicar un motivo de retención
- **THEN** el sistema rechaza el registro con un error de validación (motivo de retención requerido)
- **AND** no se modifica ningún campo de `RESERVA`

### Requirement: Validación del importe devuelto no superior a la fianza cobrada

El sistema SHALL (DEBE) validar, **antes de cualquier escritura**, que `importe_devuelto ≤
RESERVA.fianza_eur` (no se puede devolver más de lo cobrado) y que `importe_devuelto ≥ 0`. Si la
validación falla, el sistema DEBE **rechazar** el registro con un error de validación ("El importe a
devolver no puede superar la fianza cobrada"), **sin** modificar ningún campo de `RESERVA` y **sin**
crear `DOCUMENTO`. La comparación se realiza con precisión **decimal de 2 posiciones** (no coma
flotante). Esta validación es lógica de **dominio puro**. (Fuente: `US-036 §FA-02`, `§Reglas de
Validación`.)

#### Scenario: Importe superior a la fianza cobrada se rechaza (FA-02)

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1000.00`
- **WHEN** el Gestor introduce `importe_devuelto = 1500.00`
- **THEN** el sistema rechaza el registro con "El importe a devolver (1.500,00 €) no puede superar la
  fianza cobrada (1.000,00 €)"
- **AND** ningún campo de `RESERVA` se modifica y no se crea `DOCUMENTO`

### Requirement: Validación de la fecha de devolución no anterior a la fecha de cobro de la fianza

El sistema SHALL (DEBE) validar, **antes de cualquier escritura**, que `fecha_cobro` (la fecha real
del abono de la devolución) sea **≥ `RESERVA.fianza_cobrada_fecha`** (no se puede devolver antes de
haber cobrado la fianza). `fecha_cobro` es **obligatoria**. Si la validación falla, el sistema DEBE
**rechazar** el registro con un error de validación ("La fecha de devolución no puede ser anterior a
la fecha de cobro de la fianza"), sin modificar `RESERVA` ni crear `DOCUMENTO`. Esta validación es
lógica de **dominio puro**. (Fuente: `US-036 §FA-03`, `§Reglas de Validación`.)

#### Scenario: Fecha de devolución anterior al cobro de la fianza se rechaza (FA-03)

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_cobrada_fecha =
  2026-05-15`
- **WHEN** el Gestor introduce `fecha_cobro = 2026-05-10` (anterior al cobro de la fianza)
- **THEN** el sistema rechaza el registro con "La fecha de devolución no puede ser anterior a la fecha
  de cobro de la fianza (15/05/2026)"
- **AND** ningún campo de `RESERVA` se modifica

### Requirement: El justificante de la devolución es un DOCUMENTO opcional (tipo justificante_pago)

El sistema SHALL (DEBE) permitir adjuntar al registro de la devolución un **justificante** (imagen o
PDF de la transferencia), que se almacena como `DOCUMENTO` con `tipo = 'justificante_pago'`,
`reserva_id` de la RESERVA, `url`, `mime_type`, `nombre_archivo` y `tenant_id` correcto, creado en la
misma transacción y auditado con `accion = 'crear'`. El justificante es **recomendado pero no
bloqueante en MVP** (FA-04): si el Gestor **no** lo adjunta, la devolución se registra **igualmente**
(el `fianza_status` avanza al estado final derivado y los campos `fianza_devuelta_*` se establecen),
**no** se crea `DOCUMENTO`, y el sistema DEBE presentar una advertencia indicando que puede adjuntarse
más tarde desde la ficha de documentos de la RESERVA. (Fuente: `US-036 §Happy Path` documento,
`§FA-04`, `§Reglas de negocio`; reutiliza la entidad `DOCUMENTO` polimórfica de US-024/US-029/US-030.)

#### Scenario: Registro con justificante crea el DOCUMENTO tipo justificante_pago

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1000.00`
- **WHEN** el Gestor registra `importe_devuelto = 1000.00`, `fecha_cobro = 2026-06-05` y adjunta el
  justificante PDF de la transferencia
- **THEN** se crea un `DOCUMENTO` con `tipo = 'justificante_pago'`, `reserva_id = <id>`,
  `mime_type = 'application/pdf'` y `url = <url del PDF subido>`
- **AND** `AUDIT_LOG` registra la creación del `DOCUMENTO`

#### Scenario: Registro sin justificante se permite con advertencia (FA-04)

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y el Gestor no tiene el PDF
  del justificante disponible
- **WHEN** el Gestor completa la devolución sin adjuntar justificante y confirma
- **THEN** el sistema registra la devolución igualmente (`fianza_status` avanza al estado final y
  `fianza_devuelta_eur` / `fianza_devuelta_fecha` quedan establecidos)
- **AND** no se crea ningún `DOCUMENTO`
- **AND** el sistema muestra la advertencia "⚠️ Devolución registrada sin justificante. Puedes
  adjuntarlo más tarde desde la ficha de documentos de la reserva."

### Requirement: Precondición triple de disponibilidad del registro de devolución

El sistema SHALL (DEBE) permitir el registro de la devolución **únicamente** cuando `RESERVA.estado =
'post_evento'` **Y** `RESERVA.fianza_status = 'cobrada'` **Y** `CLIENTE.iban_devolucion IS NOT NULL`.
Si falta cualquiera de las tres condiciones, el backend DEBE **rechazar** la acción con un error de
conflicto de estado (fuera de `post_evento` / fianza no cobrada / sin IBAN de devolución), **sin**
modificar `RESERVA` ni crear `DOCUMENTO`. El backend NO DEBE confiar en que la UI oculte la acción:
DEBE validar la precondición en el servidor. La UI DEBE, de forma complementaria, condicionar la
**visibilidad/habilitación** de la acción a que se cumplan las tres condiciones. (Fuente: `US-036
§Reglas de negocio` disponibilidad, `§Reglas de Validación`; dependencias US-034/US-030/US-035.)

#### Scenario: Fianza no cobrada rechaza el registro de devolución

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_status = 'recibo_enviado'` (fianza aún
  no cobrada)
- **WHEN** se intenta registrar una devolución sobre esa RESERVA
- **THEN** el sistema rechaza la acción como conflicto de estado (fianza no cobrada)
- **AND** ningún campo de `RESERVA` se modifica y no se crea `DOCUMENTO`

#### Scenario: Sin IBAN de devolución rechaza el registro

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `CLIENTE.iban_devolucion IS
  NULL`
- **WHEN** se intenta registrar una devolución sobre esa RESERVA
- **THEN** el sistema rechaza la acción (falta el IBAN de devolución del cliente)
- **AND** ningún campo de `RESERVA` se modifica

#### Scenario: Registro fuera de post_evento se rechaza como conflicto de estado

- **GIVEN** una RESERVA cuyo `estado ≠ 'post_evento'` (p. ej. `evento_en_curso`)
- **WHEN** se intenta registrar una devolución sobre esa RESERVA
- **THEN** el sistema rechaza la acción como conflicto de estado
- **AND** ningún campo de `RESERVA` se modifica

### Requirement: Guarda contra el doble registro de la devolución e irreversibilidad del estado final

El sistema SHALL (DEBE), si `RESERVA.fianza_status ∈ {'devuelta', 'retenida_parcial'}` (la devolución
ya fue registrada), **rechazar** un nuevo intento de registro de devolución con un error informativo
("La devolución de la fianza ya está registrada") y **NO** modificar `RESERVA` ni crear un segundo
`DOCUMENTO`. La guarda se evalúa **dentro de la transacción** releyendo el estado de la RESERVA con
bloqueo de fila (`SELECT ... FOR UPDATE`) de PostgreSQL, de modo que dos peticiones concurrentes se
serializan y solo la primera registra la devolución; la segunda ve el estado final y aborta. La
serialización es del motor SQL (lock de fila), **nunca** mediante locks distribuidos (Redis/Redlock).
Una vez alcanzado `devuelta` o `retenida_parcial`, el estado **es final** y **no retrocede** a
`cobrada`: la acción es **irreversible** en MVP. (Fuente: `US-036 §Reglas de negocio` irreversible,
`§Reglas de Validación`; `CLAUDE.md §Regla crítica: bloqueo atómico`; `design.md §D-4`.)

#### Scenario: Segundo intento de registro sobre fianza ya devuelta se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'devuelta'` (la devolución ya fue registrada)
- **WHEN** el Gestor intenta registrar otra devolución
- **THEN** el sistema rechaza la acción con "La devolución de la fianza ya está registrada"
- **AND** no se modifica `RESERVA` ni se crea ningún `DOCUMENTO` adicional

#### Scenario: Dos registros de devolución concurrentes solo aplican uno

- **GIVEN** una RESERVA con `fianza_status = 'cobrada'` sobre la que llegan dos peticiones de registro
  de devolución concurrentes
- **WHEN** ambas transacciones intentan registrar la devolución a la vez
- **THEN** el bloqueo de fila (`SELECT ... FOR UPDATE`) serializa las transacciones: la primera aplica
  el estado final y la segunda ve un estado final y aborta
- **AND** la RESERVA queda con **un único** registro de devolución, sin doble aplicación

### Requirement: Emisión y envío de la factura de señal al aprobar y enviar E3 (borrador → enviada)

El sistema SHALL (DEBE), cuando el Gestor pulsa "Enviar factura de señal" sobre una
FACTURA con `tipo = 'senal'` en `estado = 'borrador'`, **emitir y enviar** la factura:
pasar `FACTURA(senal).estado = 'enviada'`, fijar `fecha_emision` con el timestamp actual
si era nula, **conservando el `numero_factura` `F-YYYY-NNNN` ya asignado en US-022** (no
se reasigna; si excepcionalmente el borrador no tuviera número, se asigna con la
numeración de US-022, `UNIQUE(tenant_id, numero_factura)` + reintento aplicativo ante
`P2002`, **nunca** locks distribuidos). Todo ello ocurre **solo si el envío del email E3
se confirma** (ver atomicidad). El sistema DEBE registrar `AUDIT_LOG` con `accion =
'actualizar'`, `datos_anteriores.estado = 'borrador'` y `datos_nuevos.estado = 'enviada'`.
(Fuente: `US-023 §Happy Path`, `§Reglas de Validación`; US-022 numeración; UC-19;
`design.md §D-guarda-estado, §D-num`.)

#### Scenario: Enviar factura de señal emite la factura y la deja enviada

- **GIVEN** una FACTURA `tipo = 'senal'` en `estado = 'borrador'` con `numero_factura =
  'F-{año}-NNNN'` (asignado en US-022), PDF disponible, y una RESERVA con
  `cond_part_enviadas_fecha = NULL`
- **WHEN** el Gestor pulsa "Enviar factura de señal" y el envío de E3 se confirma
- **THEN** `FACTURA(senal).estado = 'enviada'`, `fecha_emision` con el timestamp actual y
  `numero_factura` sin cambios
- **AND** `RESERVA.cond_part_enviadas_fecha` queda con el timestamp del envío y
  `RESERVA.cond_part_firmadas = false`
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado =
  'borrador'` y `datos_nuevos.estado = 'enviada'`

### Requirement: Atomicidad entre la emisión de la señal y el envío de E3 (rollback ante fallo)

El sistema SHALL (DEBE) hacer **atómicos** la emisión de la factura de señal y el envío
del email E3: la transición `FACTURA(senal).estado = 'enviada'`, la fijación de
`fecha_emision`, la actualización de `RESERVA.cond_part_enviadas_fecha` /
`cond_part_firmadas` y el registro de `COMUNICACION` E3 se consolidan **solo si el envío
de E3 se confirma**. Si el **PDF de la factura de señal no está disponible** o el **envío
de E3 falla**, el sistema DEBE hacer **rollback** de todos los cambios: la FACTURA
**permanece en `borrador`**, `RESERVA.cond_part_enviadas_fecha` **no** se actualiza; el
sistema muestra un **error recuperable** y el Gestor puede **reintentar**. Esta atomicidad
**invierte** deliberadamente el patrón "post-commit, fallo no revierte" de E2 (US-045),
igual que hizo E4 en US-028. El fallo del adjunto de **condicions particulars** NO tumba
el envío (ver delta `documentos`). (Fuente: `US-023 §Fallo en el envío del email E3`;
`design.md §D-adjunto-condiciones`; patrón `US-028 §atomicidad`.)

#### Scenario: Fallo del envío de E3 deja la factura en borrador y permite reintento

- **GIVEN** una FACTURA `tipo = 'senal'` en `borrador` y `RESERVA.cond_part_enviadas_fecha
  = NULL`
- **WHEN** el Gestor pulsa "Enviar factura de señal" pero el envío de E3 falla en el
  proveedor
- **THEN** la FACTURA permanece en `estado = 'borrador'`
- **AND** `RESERVA.cond_part_enviadas_fecha` permanece `NULL` y no se crea `COMUNICACION`
  E3 en `enviado`
- **AND** el sistema muestra un error recuperable y el Gestor puede reintentar

#### Scenario: El PDF de la señal ausente impide el envío

- **GIVEN** una FACTURA `tipo = 'senal'` en `borrador` con `pdf_url = NULL` (PDF pendiente)
- **WHEN** el Gestor pulsa "Enviar factura de señal"
- **THEN** el sistema no envía E3 y devuelve un error recuperable (el PDF de la señal es
  el adjunto imprescindible)
- **AND** la FACTURA permanece en `borrador` y no se registra `COMUNICACION` E3 `enviado`

### Requirement: Solo se envía desde borrador enviable; el re-disparo tras E3 enviado se rechaza

El sistema SHALL (DEBE) permitir la acción "Enviar factura de señal" **solo si** existe
una `FACTURA(senal)` para la reserva y su estado es **enviable**: `borrador` (camino
feliz), o `enviada` **sin** una `COMUNICACION` E3 `enviado` previa. Si ya existe una
`COMUNICACION` E3 en `estado = 'enviado'` para la reserva, el sistema DEBE **rechazar** el
re-disparo (`E3_YA_ENVIADO`) **sin** re-enviar el email, **sin** duplicar la comunicación y
**sin** regenerar documentos (el **reenvío explícito** de E3 queda fuera de esta rebanada).
Si no existe factura de señal → `FACTURA_SENAL_NO_ENCONTRADA`.

> **Nota de alcance (verificada en QA de integración, 6.4b).** Dos estados que un diseño
> teórico contemplaría **no son alcanzables** con la arquitectura de esta rebanada, por lo
> que la guarda `FACTURA_SENAL_NO_ENVIABLE` es **defensiva** y no tiene escenario
> reproducible:
> - **`rechazada` no existe como estado de FACTURA.** El enum `EstadoFactura` es
>   `borrador | enviada | cobrada`; el rechazo del borrador de señal (US-022) **no
>   transiciona** (permanece `borrador`, solo registra `AUDIT_LOG`). Por tanto una señal
>   "rechazada" seguiría siendo `borrador` y **enviable**; si el producto exige impedirlo,
>   requeriría modelar el rechazo con una marca real (fuera de alcance de 6.4b).
> - **"E3 `fallido` previa → reintento" no se reproduce.** El envío usa el adaptador
>   `EnviarEmailPort` **directo** dentro de la tx con **rollback total** ante fallo, de modo
>   que este flujo **nunca persiste** una `COMUNICACION` E3 `fallido` (solo el motor
>   `DespacharEmailService`, no usado aquí, lo haría). Además el índice único **parcial**
>   `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false` haría
>   colisionar (`P2002`) un segundo `crear` sobre un `fallido` preexistente. Un futuro flujo
>   por motor que pudiera dejar un `fallido` requeriría un `upsert` (deuda anotada).

(Fuente: `US-023 §Reglas de Validación`, `§E3 ya enviado previamente`; `design.md
§D-guarda-estado, §D-idempotencia`; hallazgos de code-review y QA de integración 6.4b.)

#### Scenario: El re-disparo cuando E3 ya fue enviado se rechaza sin duplicar

- **GIVEN** una RESERVA con una `COMUNICACION` `codigo_email = 'E3'` en `estado =
  'enviado'` y la factura de señal ya `enviada`
- **WHEN** el Gestor vuelve a pulsar "Enviar factura de señal"
- **THEN** el sistema rechaza con `E3_YA_ENVIADO`
- **AND** no se re-envía el email, no se crea una segunda `COMUNICACION` E3 `enviado` ni
  se regeneran documentos

#### Scenario: Sin factura de señal la acción no encuentra qué enviar

- **GIVEN** una RESERVA sin `FACTURA` `tipo = 'senal'` (o de otro tenant, RLS)
- **WHEN** el Gestor pulsa "Enviar factura de señal"
- **THEN** el sistema rechaza con `FACTURA_SENAL_NO_ENCONTRADA` y no envía E3

### Requirement: Reenvío manual de E3 sin re-emitir la factura ni duplicar documentos

El sistema SHALL (DEBE) ofrecer al Gestor una acción **dedicada** de "Reenviar E3" sobre una RESERVA
cuya factura de señal ya fue **enviada** (E3 enviado previamente). El reenvío DEBE crear una
**nueva** `COMUNICACION` `codigo_email = 'E3'`, `estado = 'enviado'`, `es_reenvio = true`,
`fecha_envio = now()` (ver delta `comunicaciones`), **reutilizando** el PDF de la factura de señal
ya emitido y el `DOCUMENTO` de condiciones ya persistido (**sin regenerar ni duplicar** ningún
documento). El reenvío DEBE actualizar `RESERVA.cond_part_enviadas_fecha` al nuevo timestamp y NO
DEBE modificar la `FACTURA` (ni `numero_factura` ni `estado`) ni el resto de status de la RESERVA
(no transiciona la máquina de estados). El envío DEBE ser síncrono por el puerto directo y ocurrir
**antes** de tocar la BD (espejo del reenvío de E4 `reenviar-liquidacion`): si el proveedor falla,
el reenvío aborta con un error recuperable y **no crea** la COMUNICACION de reenvío **ni actualiza**
`cond_part_enviadas_fecha` (como el email va primero, no queda estado parcial que revertir). El
acceso DEBE respetar RLS (una reserva de otro tenant → no
encontrada). (Fuente: `US-023 §E3 ya enviado previamente (idempotencia — reenvío)`; patrón US-028
`reenviar-liquidacion`; `design.md §D-reenvio-e3`.)

#### Scenario: El reenvío de E3 crea una nueva comunicación reutilizando los documentos

- **GIVEN** una RESERVA con la factura de señal `enviada`, una `COMUNICACION` E3 `enviado`
  (`es_reenvio = false`) previa y un `DOCUMENTO` de condiciones ya persistido
- **WHEN** el Gestor pulsa "Reenviar E3"
- **THEN** se crea una nueva `COMUNICACION` `codigo_email = 'E3'`, `estado = 'enviado'`,
  `es_reenvio = true`, `fecha_envio` no nulo
- **AND** se reutilizan la factura de señal y el `DOCUMENTO` de condiciones existentes (no se
  regenera ni duplica ningún documento)
- **AND** `RESERVA.cond_part_enviadas_fecha` se actualiza al nuevo timestamp y la `FACTURA` (número
  y estado) no cambia

#### Scenario: Un fallo del proveedor en el reenvío no consolida nada

- **GIVEN** una RESERVA con E3 ya enviado y factura de señal `enviada`
- **WHEN** el Gestor pulsa "Reenviar E3" pero el proveedor de email falla
- **THEN** no se crea la `COMUNICACION` de reenvío y `RESERVA.cond_part_enviadas_fecha` no se
  actualiza (el email va primero: al fallar no se toca la BD)
- **AND** el sistema devuelve un error recuperable y el Gestor puede reintentar

### Requirement: Endpoint dedicado de reenvío de E3 en el controlador de facturación

El sistema SHALL (DEBE) exponer el reenvío de E3 en un endpoint **dedicado**
`POST /reservas/{id}/facturas/senal/reenviar` (espejo de `.../facturas/liquidacion/reenviar`),
`@Roles('gestor')`, `@HttpCode(200)`, cuerpo vacío `{}`. Este endpoint es **distinto** del primer
envío `.../senal/enviar` (que sigue devolviendo `E3_YA_ENVIADO` ante un re-disparo). La respuesta
200 DEBE incluir el resultado del reenvío (nueva `cond_part_enviadas_fecha`). Los errores DEBEN
seguir el envelope del contrato con `codigo`: 404 `FACTURA_SENAL_NO_ENCONTRADA` (no existe factura
de señal / reserva cross-tenant); 409 `E3_NO_ENVIADO_PREVIAMENTE` (no hay un E3 previo que reenviar);
502 `EMISION_ENVIO_FALLIDO` (fallo del proveedor). El contrato OpenAPI DEBE describir este nuevo
path antes de la implementación (dueño: `contract-engineer`). (Fuente: US-023; convención viva del
controller `reservas/:id/facturas/{tipo}/{accion}`; `design.md §D-reenvio-e3`.)

#### Scenario: El endpoint de reenvío responde 200 con la nueva fecha de envío

- **GIVEN** una RESERVA con E3 ya enviado y factura de señal `enviada`, y un Gestor autenticado
- **WHEN** hace `POST /reservas/{id}/facturas/senal/reenviar` con cuerpo `{}`
- **THEN** responde 200 con la nueva `cond_part_enviadas_fecha`

#### Scenario: Reenviar sin un E3 previo se rechaza

- **GIVEN** una RESERVA cuya factura de señal aún NO tiene un E3 enviado
- **WHEN** el Gestor hace `POST /reservas/{id}/facturas/senal/reenviar`
- **THEN** el sistema rechaza con 409 `E3_NO_ENVIADO_PREVIAMENTE` y no crea ninguna `COMUNICACION`

#### Scenario: Reenviar sobre una reserva sin factura de señal o de otro tenant

- **GIVEN** una RESERVA sin `FACTURA` `tipo = 'senal'` (o perteneciente a otro tenant, RLS)
- **WHEN** el Gestor hace `POST /reservas/{id}/facturas/senal/reenviar`
- **THEN** el sistema rechaza con 404 `FACTURA_SENAL_NO_ENCONTRADA` y no reenvía E3

### Requirement: Recálculo en cascada del importe congelado y regeneración del borrador de liquidación

El sistema SHALL (DEBE), al recalcular el precio de una RESERVA dentro de la ventana viva (ver
delta `reserva-viva`), en la MISMA transacción y bajo el contexto RLS del tenant:
(1) **re-congelar** en la RESERVA `importe_total = nuevo_total` e `importe_liquidacion =
nuevo_total − importe_senal`, **sin modificar `importe_senal`** (la señal ya cobrada es un
importe fijo); (2) **regenerar el borrador de la FACTURA de liquidación** (`tipo='liquidacion'`)
de la reserva con el nuevo importe = `importe_liquidacion` re-congelado + Σ(subtotales de
RESERVA_EXTRA vigentes `factura_id IS NULL`), reutilizando `calcularTotalLiquidacion` y el
desglose fiscal por régimen (base derivada, IVA por resta). La regeneración DEBE ocurrir
**incluso si la FACTURA de liquidación ya está `enviada`** (se reescribe su importe/desglose),
y NO DEBE ocurrir si la FACTURA de liquidación ya está `cobrada` (en ese caso la RESERVA no está
en la ventana viva: la guarda ya lo rechaza aguas arriba). La **fianza NO se regenera** (no
depende del total). La operación es **idempotente**: aplicada dos veces con el mismo nuevo aforo/
duración produce el mismo estado final y no duplica facturas ni entradas de AUDIT_LOG
redundantes. Cada mutación se registra en `AUDIT_LOG`. (Fuente: petición de usuario; `US-021`
congelado; `US-027` borrador de liquidación; `US-029` cobro; `calculo-total-liquidacion.ts`;
`generar-borradores-liquidacion-fianza.use-case.ts`.)

#### Scenario: Recalcular re-congela total y liquidación sin tocar la señal

- **GIVEN** una RESERVA en la ventana viva con `importe_total = 3000,00`, `importe_senal =
  1200,00`, `importe_liquidacion = 1800,00` y un borrador de liquidación en `borrador`
- **WHEN** el recálculo produce un nuevo total de `3600,00`
- **THEN** el sistema fija `RESERVA.importe_total = 3600,00` e `importe_liquidacion = 2400,00`
- **AND** `RESERVA.importe_senal` permanece `1200,00`
- **AND** regenera el borrador de liquidación con importe `2400,00` (+ extras vigentes)

#### Scenario: Se regenera la liquidación aunque ya estuviera enviada

- **GIVEN** una RESERVA en la ventana viva con `liquidacion_status != 'cobrada'` y su FACTURA de
  liquidación en estado `enviada`
- **WHEN** el recálculo produce un nuevo total
- **THEN** el sistema reescribe el importe y el desglose de esa FACTURA de liquidación con el
  nuevo `importe_liquidacion` (+ extras vigentes)
- **AND** no crea una segunda FACTURA de liquidación (idempotente por `(reserva_id, tipo)`)

#### Scenario: La fianza no se regenera

- **GIVEN** una RESERVA en la ventana viva con FACTURA de fianza existente
- **WHEN** el recálculo produce un nuevo total
- **THEN** la FACTURA de fianza no se modifica (su importe no depende del total)

#### Scenario: Recálculo idempotente no duplica ni desajusta importes

- **GIVEN** una RESERVA en la ventana viva ya recalculada a total `3600,00`
- **WHEN** el mismo recálculo (mismo aforo/duración) se aplica de nuevo
- **THEN** el estado final es idéntico (`importe_total = 3600,00`, `importe_liquidacion =
  2400,00`, `importe_senal = 1200,00`) y no se duplican FACTURAS

