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
`RESERVA_EXTRA` con `factura_id` en la fase de borrador (ese marcado ocurre al emitir). El sistema
**NO genera** ningún borrador ni recibo de fianza (la fianza deja de ser una FACTURA que se emite;
ver requisitos de fianza pasiva). El fallo de esta generación NO revierte la confirmación ya
realizada. (Fuente: plan §Liquidación standalone / §Fianza pasiva; `US-027 §Historia`, `§Happy Path`;
UC-21; `er-diagram.md §3.12 FACTURA`, `§3.10 RESERVA_EXTRA`.)

#### Scenario: Liquidación con extras pendientes suma el 60 % y los extras con factura_id nulo

- **GIVEN** una RESERVA que ha transitado a `reserva_confirmada` con `importe_liquidacion =
  3.600,00 €` y dos `RESERVA_EXTRA` con `factura_id IS NULL` de subtotales `300,00 €` y `200,00 €`
- **WHEN** el sistema genera la factura de liquidación al activar los sub-procesos
- **THEN** se crea una FACTURA con `tipo = 'liquidacion'`, `estado = 'borrador'`, `numero_factura
  = NULL`, `total = 4.100,00 €`, `reserva_id` de la RESERVA y `tenant_id` correcto

#### Scenario: La activación de los sub-procesos no genera ningún borrador de fianza

- **GIVEN** una RESERVA que ha transitado a `reserva_confirmada` con `fianza_status = 'pendiente'`
- **WHEN** el sistema activa los sub-procesos tras el commit
- **THEN** se genera únicamente el borrador de la factura de liquidación
- **AND** no se crea ninguna FACTURA de tipo `fianza` ni ningún recibo

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

### Requirement: Numeración diferida a la emisión — numero_factura nulo en borrador

El sistema SHALL (DEBE) crear el borrador de liquidación con `numero_factura = NULL`. La asignación
del `numero_factura` con formato `F-YYYY-NNNN` (secuencial y único por `tenant_id` + año) se produce
**solo al emitir/enviar** la liquidación, reutilizando la numeración ya definida en `facturacion`
(US-022). En borrador, la ausencia de `numero_factura` NO viola la unicidad `UNIQUE(tenant_id,
numero_factura)`, que solo aplica a valores no nulos. (Fuente: plan §Liquidación standalone; `US-027
§Reglas de negocio` `numero_factura` no se asigna en borrador.)

#### Scenario: El borrador de liquidación no lleva número de factura

- **GIVEN** una RESERVA `reserva_confirmada` para la que se genera el borrador de liquidación
- **WHEN** el sistema crea la FACTURA en `borrador`
- **THEN** tiene `numero_factura = NULL` y solo recibirá `F-YYYY-NNNN` al emitirse

### Requirement: Idempotencia — una única liquidación y un único recibo de fianza por reserva

El sistema SHALL (DEBE) garantizar que exista **como máximo una** FACTURA con `tipo =
'liquidacion'` por `reserva_id` en estado `borrador` o `enviada`. Antes de crear el borrador de
liquidación, el sistema comprueba si ya existe una FACTURA con ese `reserva_id` y `tipo =
'liquidacion'`; si existe, **NO crea un duplicado** (operación idempotente, sin efecto secundario).
La unicidad la refuerza en BD la restricción `UNIQUE(reserva_id, tipo)` ya introducida en US-022
(cubre `senal` y `liquidacion`; el tipo `fianza` **deja de existir**): una reinvocación concurrente
del trigger que sortee la guarda aborta por `P2002` y recupera la existente. **Ya no existe recibo de
fianza** cuya unicidad garantizar (la fianza pasa a un flujo pasivo de comprobante). (Fuente: plan
§Fianza pasiva; `US-027 §Idempotencia — trigger duplicado`, `§Reglas de Validación`.)

#### Scenario: Reinvocación del trigger no duplica el borrador de liquidación

- **GIVEN** una RESERVA que ya tiene una FACTURA `tipo = 'liquidacion'` en `borrador`
- **WHEN** el trigger de activación de sub-procesos se ejecuta de nuevo para esa RESERVA
- **THEN** el sistema detecta el borrador existente y **no** crea un documento duplicado
- **AND** la operación no tiene efecto secundario (idempotente) y no crea ninguna FACTURA de fianza

### Requirement: Alerta al Gestor de documentos pendientes de revisión

El sistema SHALL (DEBE), tras generar el borrador de liquidación, alertar al Gestor en la UI con el
texto "Factura de liquidación pendiente de revisión". La alerta menciona **solo** la factura de
liquidación (la fianza deja de generar documento y por tanto no aparece en la alerta). La alerta es
una señal de UI (no un email: E4 se dispara tras la aprobación del Gestor). (Fuente: plan §Fianza
pasiva; `US-027 §Happy Path`, `§Email relacionado`.)

#### Scenario: La alerta cita solo la factura de liquidación

- **GIVEN** una RESERVA para la que se ha generado el borrador de liquidación
- **WHEN** el sistema completa la generación
- **THEN** el Gestor recibe la alerta "Factura de liquidación pendiente de revisión" (sin mención a
  la fianza)

### Requirement: Auditoría de la creación de los borradores de liquidación y fianza

El sistema SHALL (DEBE) registrar en `AUDIT_LOG` una entrada con `accion = 'crear'`, `entidad =
'FACTURA'` y el `entidad_id` de la FACTURA de liquidación creada. **No** se registra ninguna creación
de FACTURA de fianza: la fianza deja de generarse como FACTURA (pasa a un flujo pasivo de comprobante),
por lo que solo se audita la creación de la liquidación. (Fuente: plan §Fianza pasiva; `US-027 §Happy
Path`.)

#### Scenario: Crear el borrador de liquidación registra un AUDIT_LOG de creación

- **GIVEN** una RESERVA para la que se genera el borrador de liquidación
- **WHEN** el sistema crea la FACTURA
- **THEN** `AUDIT_LOG` registra una única entrada con `accion = 'crear'`, `entidad = 'FACTURA'` con
  el `entidad_id` de la liquidación

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

### Requirement: Subida pasiva del comprobante de la fianza recibida

El sistema SHALL (DEBE) permitir al Gestor **subir el comprobante** de la transferencia de fianza
recibida del cliente sobre una RESERVA en `estado ∈ {reserva_confirmada, evento_en_curso,
post_evento}`, siguiendo el patrón pasivo de `condiciones_particulares` (capability `confirmacion`):
en una **única transacción atómica** (bajo contexto RLS del tenant del JWT), el sistema DEBE subir
el fichero al almacén de documentos y **crear una fila `DOCUMENTO`** con `tipo =
'comprobante_fianza'`, `reserva_id`, `tenant_id`, `url`, `mime_type`, `nombre_archivo` y
`tamano_bytes`; establecer `RESERVA.fianza_status = 'cobrada'` (comprobante recibido),
`RESERVA.fianza_cobrada_fecha = now()` y la referencia al comprobante
(`RESERVA.fianza_comprobante_fecha`, análoga a `cond_part_firmadas_fecha`); y registrar `AUDIT_LOG`
con `accion = 'actualizar'`. La subida es **opcional** (no requerida para ningún avance de estado),
acepta `mime_type ∈ {image/jpeg, image/png, application/pdf}` y tamaño ≤ 10 MB, y **NO** genera
ninguna FACTURA, recibo, numeración ni email. La subida **no es una transición** de la máquina de
estados. Es **re-subible** conservando el histórico de `DOCUMENTO` (la fila más reciente es la de
referencia). (Fuente: plan §Fianza pasiva; patrón `US-024 condiciones-firmadas`; `er-diagram.md
§3.15 DOCUMENTO`, `§RESERVA fianza_*`.)

#### Scenario: Subir el comprobante crea el DOCUMENTO y marca la fianza como cobrada

- **GIVEN** una RESERVA en `reserva_confirmada` con `fianza_status = 'pendiente'` bajo el tenant
  del JWT
- **WHEN** el Gestor sube el comprobante de la transferencia (PDF ≤ 10 MB)
- **THEN** se crea una fila `DOCUMENTO` con `tipo = 'comprobante_fianza'`, `reserva_id`, `tenant_id`,
  `url` y `mime_type`
- **AND** `RESERVA.fianza_status = 'cobrada'`, `RESERVA.fianza_cobrada_fecha` y
  `RESERVA.fianza_comprobante_fecha` quedan con el timestamp actual
- **AND** no se crea ninguna FACTURA de fianza ni se envía ningún email
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'`

#### Scenario: La subida del comprobante es opcional y no bloquea el avance del evento

- **GIVEN** una RESERVA en `reserva_confirmada` con `fianza_status = 'pendiente'` sin comprobante
- **WHEN** se evalúa el avance del evento (ver capability `ficha-operativa`)
- **THEN** la ausencia del comprobante de fianza **no** bloquea la transición a `evento_en_curso`

#### Scenario: Re-subir el comprobante conserva el histórico

- **GIVEN** una RESERVA con `fianza_status = 'cobrada'` y un comprobante ya subido
- **WHEN** el Gestor sube una versión más legible del comprobante
- **THEN** se crea una **nueva** fila `DOCUMENTO` `tipo = 'comprobante_fianza'` (la anterior
  permanece) y `RESERVA.fianza_comprobante_fecha` se actualiza al nuevo timestamp

### Requirement: Emisión standalone de la factura de liquidación (flujo espejo de la señal)

El sistema SHALL (DEBE) permitir al Gestor **aprobar y enviar** la factura de liquidación como un
flujo **independiente** de la fianza y **espejo del flujo de la señal** (US-023), sobre una FACTURA
`tipo = 'liquidacion'` en `estado = 'borrador'`: pasar `FACTURA(liquidacion).estado = 'enviada'`,
asignar `numero_factura` `F-YYYY-NNNN` **en la emisión** (secuencial y único por `tenant_id` + año,
reutilizando la numeración de US-022 con `UNIQUE(tenant_id, numero_factura)` + reintento ante
`P2002`, **nunca** locks distribuidos), fijar `fecha_emision = now()`, marcar los `RESERVA_EXTRA`
sumados al borrador con el `factura_id` de la liquidación, y transicionar
`RESERVA.liquidacion_status = 'facturada'`, **solo si el envío del email E4 se confirma** (E4 = solo
liquidación; ver capability `comunicaciones`). El sistema DEBE registrar `AUDIT_LOG` con `accion =
'actualizar'`, `datos_anteriores.estado = 'borrador'`, `datos_nuevos.estado = 'enviada'`. Este flujo
**NO** emite ningún recibo de fianza, **NO** toca `RESERVA.fianza_status` y **NO** adjunta ningún PDF
de fianza. La ficha DEBE mostrar un **banner permanente** "Liquidación enviada el {fecha/hora}"
(derivado de `fecha_emision`), espejo del banner de la señal. (Fuente: plan §Liquidación standalone;
patrón `US-023 §Emisión y envío de la factura de señal`; `er-diagram.md §3.12 FACTURA`.)

#### Scenario: Aprobar y enviar la liquidación la emite con número y la deja enviada (solo liquidación)

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'borrador'` con `numero_factura = NULL`,
  PDF disponible y datos fiscales válidos
- **WHEN** el Gestor aprueba y envía la liquidación y el envío de E4 se confirma
- **THEN** `FACTURA(liquidacion).estado = 'enviada'`, `numero_factura = 'F-{año}-NNNN'` y
  `fecha_emision` con el timestamp actual
- **AND** `RESERVA.liquidacion_status = 'facturada'` y los `RESERVA_EXTRA` sumados quedan marcados
  con el `factura_id`
- **AND** `RESERVA.fianza_status` no cambia y no se emite ningún recibo ni PDF de fianza
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado = 'borrador'` y
  `datos_nuevos.estado = 'enviada'`

#### Scenario: El banner permanente muestra la fecha y hora de envío de la liquidación

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'enviada'` con `fecha_emision` informado
- **WHEN** se lee la ficha de la reserva
- **THEN** la sección de liquidación muestra un banner permanente "Liquidación enviada el
  {fecha/hora}" derivado de `fecha_emision`

### Requirement: Registro de la devolución completa de la fianza con email de confirmación

El sistema SHALL (DEBE) permitir al Gestor registrar la **devolución completa** de la fianza sobre
una RESERVA en `estado = 'post_evento'` con `fianza_status = 'cobrada'`, con una **única acción**
("Devolver fianza") **sin** pedir IBAN, importe ni motivo. En una **única transacción atómica** (bajo
contexto RLS del tenant del JWT), el sistema DEBE: establecer `RESERVA.fianza_status = 'devuelta'` y
`RESERVA.fianza_devuelta_fecha = now()` (la devolución es siempre por el importe completo
`fianza_eur`, no se persiste un importe devuelto parcial); y registrar `AUDIT_LOG` con `accion =
'actualizar'`, `entidad = 'RESERVA'`, `datos_anteriores = {fianza_status: 'cobrada',
fianza_devuelta_fecha: null}`, `datos_nuevos = {fianza_status: 'devuelta', fianza_devuelta_fecha}`.
Como efecto **posterior al commit** y **best-effort** (patrón `disparar-e8.adapter.ts`), el sistema
DEBE disparar el **email nuevo de "fianza devuelta"** al `CLIENTE.email` (capability
`comunicaciones`): su fallo **no revierte** el registro de la devolución (la RESERVA permanece en
`devuelta`) y es **reintentable**. La acción **no** genera ninguna FACTURA. El estado `devuelta` es
**final e irreversible** en MVP. (Fuente: plan §Devolución simplificada; UC-27; patrón post-commit
best-effort `US-035 disparar-e8`; `er-diagram.md §RESERVA fianza_*`, `§3.16 COMUNICACION`.)

#### Scenario: Devolver fianza deja la fianza en devuelta y dispara el email de confirmación

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'`, `fianza_eur = 500.00` y
  `fianza_cobrada_fecha` informado
- **WHEN** el Gestor pulsa "Devolver fianza"
- **THEN** `RESERVA.fianza_status = 'devuelta'` y `RESERVA.fianza_devuelta_fecha` queda con el
  timestamp actual
- **AND** el sistema dispara, post-commit, el email de "fianza devuelta" al `CLIENTE.email` con el
  importe `fianza_eur`
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.fianza_status =
  'cobrada'` y `datos_nuevos.fianza_status = 'devuelta'`
- **AND** no se genera ninguna FACTURA y no se pide IBAN, importe ni motivo

#### Scenario: El fallo del email post-commit no revierte la devolución

- **GIVEN** una RESERVA cuya devolución de fianza acaba de registrarse (`fianza_status = 'devuelta'`,
  commit realizado)
- **WHEN** el envío del email de "fianza devuelta" falla en el proveedor
- **THEN** la RESERVA permanece en `fianza_status = 'devuelta'` (el registro no se revierte)
- **AND** la `COMUNICACION` queda en `fallido` y el email es reintentable desde la ficha

#### Scenario: Segundo intento de devolución sobre fianza ya devuelta se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'devuelta'` (la devolución ya fue registrada)
- **WHEN** el Gestor intenta registrar otra devolución
- **THEN** el sistema rechaza la acción ("La devolución de la fianza ya está registrada") sin
  modificar `RESERVA` (la guarda se evalúa dentro de la transacción con `SELECT ... FOR UPDATE`,
  nunca con locks distribuidos)

