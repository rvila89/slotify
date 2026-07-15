# Spec Delta — Capability `documentos` (MODIFICADA)

> 6.4b (Bloque C) **reutiliza** el `GenerarPdfCondicionesPort` entregado por 6.4a
> (`documentos-condiciones-particulares-pdf`) para **adjuntar las condicions particulars
> al email E3** de la factura de señal, además del E2 del presupuesto que ya lo hace
> (`DispararE2Adapter`). Esta rebanada **fija el criterio de fallo del adjunto en un
> envío CONFIRMADO/rollback** (E3), que difiere del criterio post-commit de E2: en E3 el
> fallo o degradación a `null` de las condicions particulars **NO tumba** el envío; el
> adjunto se omite y se traza, porque el adjunto imprescindible es la factura de señal.
> Fuente: US-023 (§Happy Path adjuntos, §Condiciones particulares del tenant no
> configuradas); 6.4a `GenerarPdfCondicionesPort` (degrada a `null`); `design.md
> §D-adjunto-condiciones`.

## ADDED Requirements

### Requirement: Reutilización del PDF de condicions particulars como adjunto de E3

El sistema SHALL (DEBE), al enviar la factura de señal (E3), obtener el PDF de las
**condicions particulars** del tenant reutilizando `GenerarPdfCondicionesPort.generar({
tenantId })` (6.4a), que devuelve la URL del PDF (clave fija `condiciones/{tenantId}.pdf`)
o **`null`** cuando degrada (tenant sin configuración o sin secciones). Si devuelve una
URL, el sistema DEBE adjuntarla a E3 junto a la factura de señal. No se genera un documento
por reserva: el documento es **idéntico por tenant** (6.4a). (Fuente: `US-023 §Happy Path`;
6.4a `GenerarPdfCondicionesPort`; `design.md §D-adjunto-condiciones`.)

#### Scenario: Las condicions particulars se adjuntan a E3 cuando están configuradas

- **GIVEN** un tenant con las condicions particulars configuradas (6.4a) y una factura de
  señal enviable
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** `GenerarPdfCondicionesPort.generar` devuelve la URL del PDF de condiciones
- **AND** E3 se envía con dos adjuntos: la factura de señal y las condicions particulars

### Requirement: El fallo del adjunto de condicions particulars no tumba el envío confirmado de E3

El sistema SHALL (DEBE), en el envío CONFIRMADO/rollback de E3, tratar el fallo del adjunto
de **condicions particulars** de forma **tolerante**: si `GenerarPdfCondicionesPort.generar`
devuelve `null` (sin config/sin secciones) **o lanza** (fallo real de render/subida, p. ej.
la flakiness ESM de react-pdf), el sistema DEBE **omitir** el adjunto de condiciones y
enviar E3 **solo con la factura de señal**, sin abortar la emisión. El sistema DEBE **trazar**
en `AUDIT_LOG` que las condiciones no se adjuntaron (`datos_nuevos.condPartAdjuntada =
false`) y exponerlo en la respuesta (`condPartAdjuntada = false`), de modo que el Gestor
pueda configurarlas/reenviarlas. Este criterio **difiere** del adjunto **imprescindible**
(la factura de señal): si el PDF de la señal falta, el envío SÍ se aborta (ver delta
`facturacion`). (Fuente: `US-023 §Condiciones particulares del tenant no configuradas`
(alerta al gestor); patrón defensivo `DispararE2Adapter` (`.catch(() => null)`); `design.md
§D-adjunto-condiciones`.)

#### Scenario: Sin condiciones configuradas, E3 se envía solo con la factura de señal

- **GIVEN** un tenant SIN condicions particulars configuradas y una factura de señal
  enviable con su PDF
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** `GenerarPdfCondicionesPort.generar` devuelve `null`
- **AND** E3 se envía correctamente con **solo** el adjunto de la factura de señal
- **AND** `AUDIT_LOG` y la respuesta registran `condPartAdjuntada = false`

#### Scenario: Un fallo de render de condiciones no aborta la emisión de la señal

- **GIVEN** un tenant con condiciones configuradas cuya generación de PDF **lanza** un error
  transitorio
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** el sistema captura el fallo, omite el adjunto de condiciones y envía E3 con la
  factura de señal
- **AND** la emisión de la factura de señal se consolida normalmente (no hay rollback por el
  adjunto opcional)
