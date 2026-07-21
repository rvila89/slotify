# Spec-delta: condiciones-idioma-e2-firma-banner (capability `presupuestos`)

## MODIFIED Requirements

### Requirement: El email de presupuesto (E2) adjunta las Condicions particulars

El disparo del email de presupuesto (E2, US-014 §D-7) SHALL (DEBE) adjuntar,
además del PDF del presupuesto, el PDF de **"Condicions particulars"** del
tenant **en el idioma de la reserva** (`RESERVA.idioma`, normalizado a `'es' | 'ca'`).
El adaptador de disparo (`DispararE2Adapter`) DEBE obtener la URL del
documento de condiciones vía el puerto **`GenerarPdfCondicionesPort`** con
`{ tenantId, idioma }` (capability `documentos`) y, cuando la URL no sea `null`,
**añadir** el adjunto
`{ clave: 'condiciones', nombre: 'condicions-particulars.pdf', pdfUrl }` al array
de adjuntos del E2. El disparo es **fire-and-forget post-commit**: si el
documento de condiciones devuelve `null` post-commit (fallo transitorio — la guarda
pre-tx garantiza que la config existe), el adjunto de condiciones se **OMITE sin romper**
el despacho del E2. La **idempotencia** del E2 (índice UNIQUE parcial
`(reserva_id, codigo_email=E2)`) se mantiene. (Fuente:
`epico-6-documentos-pdf-roadmap` §6.4a Bloque B; `presupuestos` 6.1b
`DispararE2Adapter`; US-014 / UC-14 §D-7; change `condiciones-idioma-e2-firma-banner`
Mejora A+B.)

#### Scenario: E2 adjunta presupuesto y condiciones en el idioma de la reserva

- **GIVEN** un tenant con configuración de documento, una RESERVA con `idioma = 'es'`
  y un presupuesto con `pdf_url` válida
- **WHEN** se dispara el E2 post-commit
- **THEN** el motor de email recibe dos adjuntos: `presupuesto`
  (`presupuesto.pdf`) y `condiciones` (`condicions-particulars.pdf`)
- **AND** el PDF de condiciones es el generado con `idioma = 'es'`

#### Scenario: E2 omite condiciones si el documento devuelve null post-commit

- **GIVEN** un tenant cuyo documento de condiciones devuelve `null` (fallo transitorio post-commit)
- **WHEN** se dispara el E2 post-commit con un presupuesto válido
- **THEN** el motor de email recibe únicamente el adjunto `presupuesto`
- **AND** el despacho del E2 no falla

## ADDED Requirements

### Requirement: Confirmar presupuesto requiere condicions particulars configuradas

El sistema SHALL (DEBE) verificar que el tenant tiene condicions particulars configuradas
**antes** de iniciar la transacción de BD al confirmar el presupuesto (`confirmar()` en
`GenerarPresupuestoUseCase`). Si `generarCondicionesPort.generar({ tenantId, idioma })`
devuelve `null` (tenant sin config o sin secciones), el sistema SHALL (DEBE) rechazar la
operación con error `CondicionesNoConfiguradasError` (HTTP 409 `CONDICIONES_NO_CONFIGURADAS`)
sin crear PRESUPUESTO ni transicionar la RESERVA.

La guarda pre-tx MUST (DEBE) ser solo un check de existencia (presencia de config y
secciones), no una generación definitiva del PDF: la generación real (render + subida)
ocurre post-commit en `DispararE2Adapter`.

#### Scenario: Confirmar presupuesto sin condicions configuradas falla con 409

- **GIVEN** un tenant sin condicions particulars configuradas (o con secciones vacías) y
  una RESERVA en estado origen válido
- **WHEN** el gestor intenta confirmar el presupuesto
- **THEN** el sistema responde 409 `CONDICIONES_NO_CONFIGURADAS`
- **AND** no se crea ningún PRESUPUESTO
- **AND** la RESERVA permanece en su estado original
- **AND** `cond_part_enviadas_fecha` sigue siendo NULL

#### Scenario: La guarda pre-tx no genera el PDF en el almacén

- **GIVEN** un tenant con condicions configuradas
- **WHEN** el sistema ejecuta la guarda pre-tx
- **THEN** solo verifica la existencia de config y secciones sin subir ningún PDF al almacén

---

### Requirement: Confirmar presupuesto fija cond_part_enviadas_fecha en la transacción

El sistema SHALL (DEBE) fijar `RESERVA.cond_part_enviadas_fecha = now()` y
`RESERVA.cond_part_firmadas = false` dentro de la transacción de `confirmar()` (misma
unidad de trabajo que crea el PRESUPUESTO y transiciona la RESERVA a `pre_reserva`). La
respuesta de `confirmar` MUST (DEBE) incluir `condPartFechaEnvio` (timestamp del envío
de condiciones) para que el frontend refleje inmediatamente que las condicions fueron
enviadas.

#### Scenario: Confirmar presupuesto con condicions configuradas fija cond_part_enviadas_fecha

- **GIVEN** un tenant con condicions configuradas y una RESERVA en estado origen válido
- **WHEN** el gestor confirma el presupuesto
- **THEN** el sistema crea el PRESUPUESTO, transiciona la RESERVA a `pre_reserva`
- **AND** `RESERVA.cond_part_enviadas_fecha` queda fijado con el timestamp de la operación
- **AND** `RESERVA.cond_part_firmadas = false`
- **AND** el E2 se dispara post-commit con el PDF de condicions en el idioma de la reserva

#### Scenario: cond_part_enviadas_fecha ya está fijado cuando llega E3

- **GIVEN** una RESERVA cuyo presupuesto ya fue confirmado (cond_part_enviadas_fecha fijado)
- **WHEN** el gestor envía la factura de señal (E3)
- **THEN** E3 no modifica `cond_part_enviadas_fecha`
- **AND** la tarjeta de firma de condicions en la ficha muestra estado "pendiente de firma"
