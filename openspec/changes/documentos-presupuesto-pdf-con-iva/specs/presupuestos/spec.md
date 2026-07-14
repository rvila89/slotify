# presupuestos Specification

## ADDED Requirements

### Requirement: PDF real del presupuesto CON IVA (sustituye al fake)

El sistema SHALL (DEBE) generar el PDF del presupuesto como un **documento real**
renderizado con `@react-pdf/renderer`, reemplazando al adaptador *fake*
(`PdfPresupuestoFakeAdapter`, URL sintética). El adaptador real implementa el
puerto de dominio **ya existente** `GenerarPdfPresupuestoPort`
(`(params:{tenantId,reservaId,idPresupuesto}) => Promise<string|null>`) y se
inyecta por el token **existente** `GENERAR_PDF_PRESUPUESTO_PORT` en
`PresupuestosModule`; el caso de uso `GenerarPresupuestoUseCase` **no cambia** (la
generación sigue siendo **post-commit**, fuera de la transacción crítica del
bloqueo de fecha). El adaptador DEBE:

1. cargar la **configuración del tenant** (`ObtenerConfiguracionDocumentoService`)
   y los datos del presupuesto/reserva/cliente/extras;
2. renderizar el PDF con la **capa de plantilla de documentos** (capability
   `documentos`);
3. **subir** los bytes por `AlmacenDocumentosPort.subir(...)`;
4. devolver la **URL real** (que el E2 §D-7 adjunta como `pdf_url`).

Esta rebanada cubre **solo la variante CON IVA** (pago por transferencia, hoja
"PRESSUPOST IVA"). Un fallo del render/subida NO revierte la pre_reserva ya
comprometida (comportamiento post-commit existente: devuelve `null`). (Fuente:
US-014/UC-14 §D-6/§D-7; `epico-6-documentos-pdf-roadmap` 6.1b; `documentos` 6.1a.)

#### Scenario: El presupuesto genera un PDF real y devuelve su URL

- **GIVEN** una reserva con datos fiscales completos y una
  `ConfiguracionDocumentoTenant` del tenant
- **WHEN** se confirma el presupuesto (US-014)
- **THEN** el PDF se renderiza con `@react-pdf/renderer`, se sube por
  `AlmacenDocumentosPort` y `pdf_url` apunta a la URL real del objeto subido
- **AND** NO es la URL sintética `https://storage.local/presupuestos/{id}.pdf` del
  fake

#### Scenario: El PDF es CON IVA (transferencia)

- **GIVEN** un presupuesto con base imponible, `% IVA` e importe de IVA
- **WHEN** se renderiza el PDF
- **THEN** el documento muestra Base imp., % IVA y Total (variante CON IVA), y el
  pie bancario con las instrucciones de transferencia e IBAN de la config del
  tenant

#### Scenario: Un fallo de render/subida no revierte la pre_reserva

- **GIVEN** una confirmación de presupuesto cuya pre_reserva ya se ha comprometido
- **WHEN** el render o la subida del PDF falla en el post-commit
- **THEN** la pre_reserva permanece comprometida y la operación devuelve el
  presupuesto (con `pdf_url` sin resolver), sin revertir la transacción

### Requirement: Contenido del PDF de presupuesto tomado de la config del tenant

El PDF del presupuesto CON IVA SHALL (DEBE) componerse **exclusivamente** con
datos del tenant y de la reserva, sin valores de negocio hardcodeados:

- **Cabecera**: logo si `logoUrl` no es nulo (si no, solo-texto), razón social
  fiscal, NIF, dirección fiscal, email y web (de `identidadFiscal`).
- **Dades client** (del cliente de la reserva): nombre y apellidos, DNI/NIF,
  dirección, CP + población, provincia.
- **PRESSUPOST + número + Data**.
- **CONCEPTE/PREU**: el texto de `textos.plantillaConceptoFiscal` con el
  placeholder `{nombreComercial}` resuelto (expresa "espai", **nunca** "lloguer");
  debajo, la fecha del evento, la **duración** (enum `DuracionHoras` 4/8/12 →
  "(N hores)"; ver `design.md` N5 sobre el rango horario), el nº de personas
  (`num_adultos_ninos_mayores4`), y los **extras** de la reserva como
  sub-conceptos con su precio.
- **Validesa** (`textos.validesaTexto`, p. ej. "10 DIES") | Base imp. | % IVA |
  Total.
- **Condicions**: 40% pago anticipado / 60% import restant / fiança "A l'arribada"
  (del desglose/reparto del presupuesto).
- **Pie bancario**: instrucciones de pago + IBAN (de `banca`).

(Fuente: Excel hoja "PRESSUPOST IVA"; `documentos` 6.1a `ConfiguracionDocumentoTenant`;
regla del épico "concepto nunca lloguer".)

#### Scenario: El concepto fiscal usa la plantilla del tenant y nunca "lloguer"

- **GIVEN** una config con `plantillaConceptoFiscal = "Gestió de l'ús espai de
  {nombreComercial} per esdeveniment"` y `nombreComercial = "Masia l'Encís"`
- **WHEN** se renderiza el concepto del PDF
- **THEN** aparece "Gestió de l'ús espai de Masia l'Encís per esdeveniment"
- **AND** el documento no contiene la palabra "lloguer"

#### Scenario: Los extras aparecen como sub-conceptos con precio

- **GIVEN** una reserva con extras (p. ej. "Neteja" a 100 €)
- **WHEN** se renderiza el PDF
- **THEN** cada extra figura como sub-concepto del bloque CONCEPTE con su precio

### Requirement: Numeración del presupuesto CON IVA por tenant y año

El sistema SHALL (DEBE) asignar a cada presupuesto CON IVA un
**`numero_presupuesto`** con formato **año + contador** (p. ej. `2026001`),
**único por tenant** y con **reinicio anual** (el año va embebido en el número).
El campo se persiste en `Presupuesto` (**migración Prisma** no destructiva) y su
unicidad se garantiza a nivel de BD por tenant + número. El **cálculo** del
siguiente número es una función de **dominio pura** que reutiliza el patrón de
`facturacion/domain/numeracion-factura.ts` (a partir del año y del último número
del tenant en ese año), y la asignación ocurre en la **transacción de
confirmación** del presupuesto (bajo RLS del tenant), no en el post-commit del
PDF. En 6.1b existe **una única** secuencia (solo CON IVA); 6.2 la generaliza a
dos. (Fuente: `epico-6-documentos-pdf-roadmap` 6.1b numeración; patrón US-022
§D-3; `design.md` cuestiones abiertas N1/N2.)

#### Scenario: El primer presupuesto del tenant en el año recibe el contador inicial

- **GIVEN** un tenant sin presupuestos numerados en 2026
- **WHEN** se confirma su primer presupuesto CON IVA en 2026
- **THEN** `numero_presupuesto` es `2026001` (año 2026 + contador 001)

#### Scenario: El contador es único por tenant y se incrementa

- **GIVEN** un tenant con un presupuesto `2026001`
- **WHEN** se confirma otro presupuesto CON IVA para el mismo tenant en 2026
- **THEN** `numero_presupuesto` es `2026002`
- **AND** un intento concurrente de asignar el mismo número falla por la
  unicidad `(tenant, numero_presupuesto)` en BD

#### Scenario: El número reinicia con el año

- **GIVEN** un tenant con presupuestos hasta `2026007`
- **WHEN** se confirma su primer presupuesto CON IVA en 2027
- **THEN** `numero_presupuesto` es `2027001`
