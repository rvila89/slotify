# presupuestos Specification

## ADDED Requirements

### Requirement: El email de presupuesto (E2) adjunta las Condicions particulars

El disparo del email de presupuesto (E2, US-014 §D-7) SHALL (DEBE) adjuntar,
además del PDF del presupuesto, el PDF de **"Condicions particulars"** del
tenant. El adaptador de disparo (`DispararE2Adapter`) DEBE obtener la URL del
documento de condiciones vía el puerto **`GenerarPdfCondicionesPort`** (capability
`documentos`) y, cuando la URL no sea `null`, **añadir** el adjunto
`{ clave: 'condiciones', nombre: 'condicions-particulars.pdf', pdfUrl }` al array
de adjuntos del E2. El disparo es **fire-and-forget post-commit**: si el
documento de condiciones devuelve `null` (tenant sin configuración), el adjunto
de condiciones se **OMITE sin romper** el despacho del E2, que sigue adjuntando
el presupuesto si existe. La **idempotencia** del E2 (índice UNIQUE parcial
`(reserva_id, codigo_email=E2)`) se mantiene. (Fuente:
`epico-6-documentos-pdf-roadmap` §6.4a Bloque B; `presupuestos` 6.1b
`DispararE2Adapter`; US-014 / UC-14 §D-7.)

#### Scenario: E2 adjunta presupuesto y condiciones cuando ambos existen

- **GIVEN** un tenant con configuración de documento y un presupuesto con
  `pdf_url` válida
- **WHEN** se dispara el E2 post-commit
- **THEN** el motor de email recibe dos adjuntos: `presupuesto`
  (`presupuesto.pdf`) y `condiciones` (`condicions-particulars.pdf`)

#### Scenario: E2 omite condiciones si el documento devuelve null

- **GIVEN** un tenant cuyo documento de condiciones devuelve `null`
- **WHEN** se dispara el E2 post-commit con un presupuesto válido
- **THEN** el motor de email recibe únicamente el adjunto `presupuesto`
- **AND** el despacho del E2 no falla

#### Scenario: E2 no adjunta nada si no hay presupuesto ni condiciones

- **GIVEN** un presupuesto sin `pdf_url` y un documento de condiciones que
  devuelve `null`
- **WHEN** se dispara el E2 post-commit
- **THEN** el array de adjuntos del E2 queda vacío
- **AND** el despacho del E2 no falla
