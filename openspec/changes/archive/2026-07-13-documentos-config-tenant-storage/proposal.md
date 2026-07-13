# Change: documentos-config-tenant-storage

## Why

El épico **#6 — Documentos PDF por tenant** genera los documentos reales
(presupuesto/factura) como el Excel del tenant, con **layout fijo en código y
contenido 100% configurable por tenant** (decisión aprobada, ver
`epico-6-documentos-pdf-roadmap`). Antes de generar ningún PDF (rebanada 6.1b) se
necesitan dos cimientos que hoy **no existen**:

1. **Configuración de documento por tenant.** Hoy el branding, la identidad fiscal
   y los textos legales de un documento no están modelados como configuración: el
   modelo `Tenant` mezcla en `nombre`/`nif`/`direccion` datos que en un documento
   fiscal son **distintos** — la **razón social fiscal** (p. ej. "Canoliart, SL")
   NO es el **nombre comercial** (p. ej. "Masia l'Encís"). Un documento que
   sustituya al Excel necesita ambos por separado, más banca (IBAN, beneficiario,
   concepto de transferencia) y textos (concepto fiscal, validesa, pie legal), todo
   **por tenant**. (Fuente: `epico-6-documentos-pdf-roadmap` §Decisiones fijadas
   "razón social ≠ nombre comercial"; `presupuesto-parte-b-plan` #6; Excel
   `Plantilla_factures i pressupostos.xlsx`.)

2. **Almacenamiento de objetos.** El logo del tenant y —en 6.1b— los PDFs
   generados deben vivir en un object storage (S3/Supabase, decisión aprobada), no
   en la BD. El dominio necesita un **puerto** para subir bytes y obtener una URL,
   sin acoplarse a un proveedor concreto (arquitectura hexagonal).

Esta es la **primera rebanada (6.1a)** del épico: establece SOLO los cimientos
para que 6.1b (presupuesto PDF real) los consuma. **NO genera ningún PDF, no
instala `@react-pdf/renderer`, no toca los adapters *fake*** (`PdfPresupuestoFakeAdapter`,
`PdfFacturaFakeAdapter`) ni la numeración: todo eso es 6.1b y posteriores.

## What Changes

- **Nueva capability `documentos`** con la configuración de documento por tenant y
  el contrato del almacén de objetos. (Justificación de la capability más abajo.)
- **Nuevo modelo Prisma `PlantillaDocumentoTenant`** (tabla nueva
  `plantilla_documento_tenant`), relación **1-1 con `Tenant`** (`tenant_id UNIQUE`,
  FK a `Tenant`), multi-tenant con **RLS** (política por
  `current_setting('app.tenant_id')`, como el resto de tablas de negocio). Requiere
  **migración Prisma**. Campos:
  - **Branding**: `logo_url` (string `nullable`, apunta a object storage),
    `color_primario`, `color_texto`.
  - **Identidad fiscal**: `razon_social_fiscal` (p. ej. "Canoliart, SL"),
    `nombre_comercial` (p. ej. "Masia l'Encís") — **campos distintos**; más `nif`,
    `direccion_fiscal` (texto multi-línea), `web`, `email`.
  - **Banca**: `iban`, `beneficiario_transferencia`, `concepto_transferencia`.
  - **Textos**: `plantilla_concepto_fiscal` (p. ej. "Gestió de l'ús espai de
    {nombreComercial} per esdeveniment" — **nunca** "lloguer"), `validesa_texto`
    (p. ej. "10 DIES"), `pie_legal`.
- **NO** se borran ni migran los campos existentes `Tenant.nombre`/`nif`/`direccion`
  (los usa el resto del sistema). La `PlantillaDocumentoTenant` es la **fuente de
  verdad para los documentos**; el desdoble/deduplicación con `Tenant` se decide en
  `design.md` (cuestión abierta A).
- **Nuevo puerto de dominio `AlmacenDocumentosPort`** (interfaz en `domain/`, sin
  imports de framework/infra) con al menos `subir(bytes, clave): Promise<url>` y
  `urlPublica(clave): string`. Sirve para el logo ahora y para los PDFs en 6.1b.
- **Adaptador de infraestructura** que implementa el puerto contra object storage
  compatible **S3/Supabase**, configurado por **variables de entorno**. Si se usa
  un adaptador cloud real o uno dev/local seleccionable por env es la **cuestión
  abierta B** de `design.md` (para el gate). Regla dura: **los tests no dependen de
  credenciales cloud**.
- **Seed** (`apps/api/prisma/seed.ts`): sembrar la `PlantillaDocumentoTenant` del
  tenant piloto **Masia l'Encís** con los **datos reales** (razón social
  "Canoliart, SL", nombre comercial "Masia l'Encís", NIF "B10874287", dirección
  "08731 - Sant Martí Sarroca / Barcelona", web "www.masialencis.com", email
  "info@masialencis.com", IBAN "ES30 0182 1683 4002 0172 9599", beneficiario
  "Canoliart, SL", concepto "Masia l'Encís", y los textos de concepto/validesa/pie).
  El seed es **idempotente** (`deleteMany` + `create`/`createMany`).

### Fuera de alcance (rebanadas posteriores)

- Generación de PDF, `@react-pdf/renderer`, capa de plantilla, sustitución de los
  adapters *fake* → **6.1b**.
- Numeración de documentos → 6.1b / 6.2. Variante CON/SIN IVA + método de pago →
  6.2. Facturas 40/60 → 6.3. Condicions particulars → 6.4. UI de ajustes del
  tenant (CRUD + upload de logo) → 6.5.
- **No hay endpoint HTTP nuevo** en esta rebanada: la config se **siembra**; su
  CRUD/UI es 6.5. Por tanto este change **no** tiene fase de contrato OpenAPI/SDK,
  **ni** frontend, **ni** E2E Playwright. El `tasks.md` salta esas fases y el QA se
  reduce a unit tests (puerto/adaptador de storage con doble, repositorio de
  config) + un **test de integración SQL real** (tabla + RLS + seed) ejecutado
  desde la sesión principal (que tiene Postgres).

## Capability elegida y justificación

Se crea una **nueva capability `documentos`** en lugar de ampliar `presupuestos` o
`facturacion`:

- La configuración de documento (branding, identidad fiscal, banca, textos) y el
  almacén de objetos son **transversales** a presupuestos **y** facturas (y, más
  adelante, a las Condicions particulars): no pertenecen al agregado `Presupuesto`
  ni al `Factura`. Meterlos en `presupuestos` obligaría a `facturacion` a depender
  de `presupuestos` solo para leer la config del tenant.
- El épico #6 completo (6.1a→6.5) es "documentos PDF por tenant"; una capability
  `documentos` da un hogar coherente a todas sus rebanadas (plantilla, storage,
  numeración compartida, condicions particulars, UI de ajustes).
- Ya existe una entidad `Documento` en el schema (ficheros/adjuntos
  almacenados). La capability `documentos` de esta spec cubre la **configuración**
  del documento y el **almacén**, no reemplaza esa entidad; el nombre de la
  capability y de la entidad `Documento` conviven (la config es
  `PlantillaDocumentoTenant`, nombre deliberadamente distinto para no confundir).

## Trazabilidad

- Épico #6, rebanada **6.1a** (roadmap `epico-6-documentos-pdf-roadmap`).
- `presupuesto-parte-b-plan` #6 (datos reales del tenant, Excel
  `Plantilla_factures i pressupostos.xlsx`).
- `CLAUDE.md §Arquitectura` (hexagonal: puerto en dominio, adaptador en infra),
  `§Multi-tenancy` (tenant_id + RLS), `§Testing` (TDD), regla arrow-functions.
- Reutiliza el patrón de seed del tenant piloto de la capability `foundation`
  (requirement "Seed del tenant piloto Masia l'Encís").
