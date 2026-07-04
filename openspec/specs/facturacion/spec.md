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

### Requirement: Desglose fiscal de la factura con IVA 21 % y redondeo contable

El sistema SHALL (DEBE) calcular el desglose fiscal de la factura de señal derivando la base
del total: `iva_porcentaje = 21,00`; `base_imponible = round(total / 1,21, 2)`; `iva_importe =
total − base_imponible`. El redondeo es **contable a 2 decimales (mitad hacia arriba)** y el
`iva_importe` se obtiene **por resta** del total, de modo que `base_imponible + iva_importe =
total` **exactamente**, sin desajuste de céntimos por doble redondeo. El cálculo del desglose
es lógica de **dominio puro**. (Fuente: `US-022 §Happy Path` `base = 991,74`, `iva = 208,26`,
`§Reglas de Validación` redondeo contable; `er-diagram.md §3.12` base/iva derivados.)

#### Scenario: 1.200 € de total desglosa 991,74 base + 208,26 IVA

- **GIVEN** una factura de señal con `total = 1.200,00 €`
- **WHEN** el sistema calcula el desglose fiscal
- **THEN** `iva_porcentaje = 21,00`, `base_imponible = 991,74 €`, `iva_importe = 208,26 €`
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

El sistema SHALL (DEBE), tras crear la factura en `borrador`, generar el PDF **reutilizando el
mecanismo de generación de PDF ya existente** (puerto de dominio + adaptador de infraestructura,
como en US-014/US-021), con los datos fiscales del **emisor** (`TENANT.nombre`, `TENANT.nif`,
`TENANT.iban`, `TENANT.direccion`) y del **receptor** (`CLIENTE.nombre`, `CLIENTE.apellidos`,
`CLIENTE.dni_nif`, `CLIENTE.direccion`, `CLIENTE.codigo_postal`, `CLIENTE.poblacion`,
`CLIENTE.provincia`), el concepto, el desglose y el total, y almacenar la `pdf_url` en la
FACTURA. La generación es **posterior al commit** de la creación y el guardado de `pdf_url` es
**idempotente**. Al crear la factura, el sistema DEBE registrar `AUDIT_LOG` con `accion =
'crear'`, `entidad = 'FACTURA'` y el `entidad_id` de la factura creada. (Fuente: `US-022
§Happy Path` PDF con datos emisor/receptor + `pdf_url` + `AUDIT_LOG` crear; `er-diagram.md
§3.12 pdf_url`, patrón `§3.11` PDF post-commit; decisión del usuario: reusar mecanismo de PDF.)

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

