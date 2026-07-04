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

