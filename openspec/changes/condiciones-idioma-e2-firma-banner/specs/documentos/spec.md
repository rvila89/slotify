# Spec-delta: condiciones-idioma-e2-firma-banner (capability `documentos`)

## MODIFIED Requirements

### Requirement: Generación del PDF de condicions particulars respetando el idioma de la reserva

El sistema SHALL (DEBE) generar el PDF de condicions particulars en el **idioma de la
comunicación con el cliente** (`RESERVA.idioma`, `'es'` o `'ca'`). El puerto de dominio
`GenerarPdfCondicionesPort` DEBE aceptar `{ tenantId: string; idioma: 'es' | 'ca' }` en
su método `generar`. El adaptador `PdfCondicionesRealAdapter` DEBE:

1. Recibir `idioma` y pasarlo al renderizador (`RenderizarDocumentoCondiciones`).
2. Usar clave de almacenamiento diferenciada por idioma:
   `condiciones/{tenantId}-{idioma}.pdf` (en lugar del anterior `condiciones/{tenantId}.pdf`).
   Esto asegura que dos reservas del mismo tenant con idiomas distintos no sobreescriban
   el PDF del otro.
3. El renderizador selecciona, para cada sección, el texto correspondiente al idioma:
   `titulo.{idioma}`, `secciones[i].titulo.{idioma}`, `secciones[i].cuerpo.{idioma}`.

La degradación a `null` (tenant sin config o sin secciones, D3) se mantiene: se evalúa
antes de invocar al renderizador. El idioma `'es'` o `'ca'` es el único valor válido;
cualquier valor distinto NO DEBE llegar a este puerto (la normalización a `'es' | 'ca'`
se hace en el llamante).

#### Scenario: PDF de condicions en español para una reserva con idioma 'es'

- **GIVEN** un tenant con condicions configuradas en ambos idiomas y una RESERVA con
  `idioma = 'es'`
- **WHEN** el sistema genera el PDF de condicions para esa reserva
- **THEN** el PDF contiene los textos de la sección `es` del JSON bilingüe
- **AND** el PDF se sube con clave `condiciones/{tenantId}-es.pdf`

#### Scenario: PDF de condicions en catalán para una reserva con idioma 'ca'

- **GIVEN** un tenant con condicions configuradas en ambos idiomas y una RESERVA con
  `idioma = 'ca'`
- **WHEN** el sistema genera el PDF de condicions para esa reserva
- **THEN** el PDF contiene los textos de la sección `ca` del JSON bilingüe
- **AND** el PDF se sube con clave `condiciones/{tenantId}-ca.pdf`

#### Scenario: Dos reservas del mismo tenant con idiomas distintos no sobreescriben el PDF

- **GIVEN** un tenant con condicions configuradas y dos reservas: una en `idioma = 'es'`
  y otra en `idioma = 'ca'`
- **WHEN** el sistema genera el PDF para cada reserva
- **THEN** cada reserva genera y almacena su propio PDF bajo su clave diferenciada
- **AND** el PDF de una no sobreescribe el de la otra
