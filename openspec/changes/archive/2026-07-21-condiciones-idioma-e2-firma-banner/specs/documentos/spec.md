# Spec-delta: condiciones-idioma-e2-firma-banner (capability `documentos`)

## MODIFIED Requirements

### Requirement: Generación y almacenamiento del PDF de "Condicions particulars"

El sistema SHALL (DEBE) proveer un puerto de dominio
**`GenerarPdfCondicionesPort`** con firma
`(params: { tenantId: string; idioma: 'es' | 'ca' }) => Promise<string | null>`, cuyo **adaptador
real** (infraestructura de `documentos`): (1) obtiene la configuración del tenant
vía `ObtenerConfiguracionDocumentoService`; si es `null` **degrada a `null`** sin
renderizar ni subir; (2) renderiza el PDF con la plantilla de condiciones **en el idioma
indicado** (selecciona `titulo.{idioma}` y `secciones[].cuerpo.{idioma}` del JSON bilingüe); (3)
sube los bytes por `AlmacenDocumentosPort.subir(bytes, clave)` con la **clave
por tenant e idioma** `condiciones/{tenantId}-{idioma}.pdf` (reutiliza/sobrescribe por tenant
e idioma); (4) devuelve la URL. El puerto se enlaza por el token
**`GENERAR_PDF_CONDICIONES_PORT`** en `DocumentosModule` (que lo exporta), y se
provee un **adaptador fake** para tests. El render y el almacén son
**infraestructura**; el puerto vive en dominio. (Fuente:
`epico-6-documentos-pdf-roadmap` §6.4a; espejo de `PdfPresupuestoRealAdapter`
6.1b; `documentos` 6.1a `AlmacenDocumentosPort`; `CLAUDE.md §Arquitectura`
hexagonal, `§Multi-tenancy`; change `condiciones-idioma-e2-firma-banner` Mejora A.)

#### Scenario: Genera, sube con clave por tenant e idioma y devuelve la URL

- **GIVEN** un tenant con configuración de documento (incluye `condiciones`) e `idioma = 'es'`
- **WHEN** se invoca el adaptador real con `{ tenantId, idioma: 'es' }`
- **THEN** se renderiza el PDF en español, se invoca `AlmacenDocumentosPort.subir(bytes,
  'condiciones/{tenantId}-es.pdf')`
- **AND** se devuelve la URL resultante

#### Scenario: Genera en catalán con clave diferenciada

- **GIVEN** un tenant con configuración de documento e `idioma = 'ca'`
- **WHEN** se invoca el adaptador real con `{ tenantId, idioma: 'ca' }`
- **THEN** se renderiza el PDF en catalán con clave `condiciones/{tenantId}-ca.pdf`

#### Scenario: Sin configuración del tenant degrada a null

- **GIVEN** un tenant sin `ConfiguracionDocumentoTenant`
- **WHEN** se invoca el adaptador real con `{ tenantId, idioma: 'es' }`
- **THEN** devuelve `null` sin renderizar ni subir nada

#### Scenario: La clave aísla los objetos por tenant e idioma

- **GIVEN** dos tenants distintos con dos idiomas distintos
- **WHEN** se genera el documento de condiciones para cada combinación
- **THEN** cada una tiene su propia clave `condiciones/{tenantId}-{idioma}.pdf`, sin
  colisión entre tenants ni entre idiomas

---

### Requirement: Reutilización del PDF de condicions particulars como adjunto de E3

El sistema SHALL (DEBE), al enviar la factura de señal (E3), adjuntar **únicamente** el PDF de
la factura de señal. E3 ya **no** adjunta el PDF de condicions particulars — las condicions se
envían en E2 al confirmar el presupuesto (change `condiciones-idioma-e2-firma-banner` Mejora B).
El puerto `GenerarPdfCondicionesPort` no se invoca desde el adaptador de E3. (Fuente:
`US-023`; change `condiciones-idioma-e2-firma-banner` Mejora B.)

#### Scenario: E3 se envía sin adjunto de condicions

- **GIVEN** una factura de señal enviable con su PDF disponible
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** el email E3 lleva solo el adjunto de la factura de señal
- **AND** no se llama a `GenerarPdfCondicionesPort.generar` desde el envío E3

---

### Requirement: El fallo del adjunto de condicions particulars no tumba el envío confirmado de E3

El sistema SHALL (DEBE), en el envío confirmado de E3, tratar las condicions particulars como
**adjunto ya no requerido**: E3 solo lleva la factura de señal. La guarda dura de condicions
configuradas (`CONDICIONES_NO_CONFIGURADAS`) se ha movido al paso de **confirmar presupuesto
(E2)** — change `condiciones-idioma-e2-firma-banner` Mejora B. Por tanto, cuando el Gestor
envía la factura de señal, `RESERVA.cond_part_enviadas_fecha` ya está fijado (lo fijó E2 al
confirmar el presupuesto) y E3 no puede ni debe abortar por condicions no configuradas.
(Fuente: `US-023`; change `condiciones-idioma-e2-firma-banner` Mejora B.)

#### Scenario: E3 no lanza CONDICIONES_NO_CONFIGURADAS

- **GIVEN** un tenant con o sin condicions configuradas y una factura de señal enviable
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** el sistema no rechaza con 409 `CONDICIONES_NO_CONFIGURADAS`
- **AND** E3 se envía con el adjunto de la factura de señal únicamente

## REMOVED Requirements

### Requirement: Persistencia idempotente del DOCUMENTO de condiciones particulares al enviar E3
