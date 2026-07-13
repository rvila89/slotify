# Design — documentos-config-tenant-storage (6.1a)

## Contexto

Primera rebanada (6.1a) del épico #6. Establece SOLO los cimientos —config de
documento por tenant + puerto/adaptador de almacén de objetos + seed— sin generar
PDF. Layout fijo en código y contenido 100% por tenant es decisión ya aprobada del
épico; aquí solo se modela el "contenido por tenant".

## Modelo de datos

Nueva tabla `plantilla_documento_tenant` (Prisma `PlantillaDocumentoTenant`),
relación **1-1** con `Tenant` vía `tenant_id UNIQUE` + FK. PK `String @id
@default(uuid())` (regla `foundation`: ninguna PK autoincremental). RLS habilitada
por migración (`current_setting('app.tenant_id')`), igual que el resto de tablas.

Campos (con `@map` snake_case, convención del schema):

| Bloque | Campo | Tipo | Notas |
|--------|-------|------|-------|
| Branding | `logo_url` | `String?` | referencia a object storage (clave/URL) |
| Branding | `color_primario` | `String` | hex, p. ej. "#RRGGBB" |
| Branding | `color_texto` | `String` | hex |
| Identidad | `razon_social_fiscal` | `String` | "Canoliart, SL" |
| Identidad | `nombre_comercial` | `String` | "Masia l'Encís" |
| Identidad | `nif` | `String` | "B10874287" |
| Identidad | `direccion_fiscal` | `String` | multi-línea (`\n`) |
| Identidad | `web` | `String` | |
| Identidad | `email` | `String` | |
| Banca | `iban` | `String` | |
| Banca | `beneficiario_transferencia` | `String` | "Canoliart, SL" |
| Banca | `concepto_transferencia` | `String` | "Masia l'Encís" |
| Textos | `plantilla_concepto_fiscal` | `String` | con placeholder `{nombreComercial}` |
| Textos | `validesa_texto` | `String` | "10 DIES" |
| Textos | `pie_legal` | `String` | |

Se añade la relación inversa en `Tenant` (`plantillaDocumento PlantillaDocumentoTenant?`).

## Arquitectura hexagonal

- **Dominio**: interfaz `AlmacenDocumentosPort` (`subir(bytes, clave):
  Promise<url>`, `urlPublica(clave): string`) + tipo/objeto de configuración de
  documento (VO/DTO de dominio). Sin imports de `@nestjs`/`prisma`/SDK cloud (hook
  `no-infra-in-domain` lo verifica).
- **Aplicación**: caso de uso / servicio de lectura de la config de documento del
  tenant (para 6.1b) + puerto de repositorio de lectura de
  `PlantillaDocumentoTenant`.
- **Infraestructura**: adaptador Prisma del repositorio de config + adaptador de
  `AlmacenDocumentosPort` seleccionado por env (ver cuestión abierta B).

No hay máquina de estados ni bloqueo de fecha implicados. No hay endpoint HTTP
(la config se siembra; CRUD/UI = 6.5).

## Cuestión abierta A — ¿la config duplica o referencia los datos de `Tenant`?

Hoy `Tenant.nombre`/`nif`/`direccion` mezclan identidad comercial y fiscal, y los
usa el resto del sistema. La nueva config necesita el desdoble razón social ≠
nombre comercial.

- **Opción A1 (recomendada)**: la `PlantillaDocumentoTenant` es la **fuente de
  verdad para los documentos** y **duplica** deliberadamente los datos fiscales que
  necesita (razón social, nombre comercial, NIF, dirección fiscal, web, email). No
  se tocan los campos de `Tenant`. Ventaja: desacople total, sin migración de datos
  arriesgada, el documento no depende de la semántica ambigua de `Tenant`.
  Inconveniente: dato duplicado (NIF vive en dos sitios) hasta que 6.5 dé UI; se
  acepta como deuda menor porque `Tenant.*` no se usa en documentos.
- **Opción A2**: la config **referencia** `Tenant` y solo añade lo que falta
  (razón social fiscal, nombre comercial). Inconveniente: mezcla fuentes en 6.1b y
  arrastra la ambigüedad de `Tenant.nombre`.

**Recomendación**: **A1** (duplicar; la config es la fuente para documentos). Ya
reflejado así en proposal/spec-delta. **Pendiente de OK del humano en el gate.**

## Cuestión abierta B — ¿adaptador cloud real ya, o dev/local seleccionable por env?

El adaptador de `AlmacenDocumentosPort` es contra S3/Supabase por env. En 6.1a
todavía no se sube nada en producción (el logo se sube en 6.5; los PDFs en 6.1b).

- **Opción B1 (recomendada)**: implementar en 6.1a un **adaptador dev/local**
  (filesystem o in-memory) seleccionable por env (`ALMACEN_PROVIDER=local|s3`),
  dejando el **adaptador cloud real para cuando haya credenciales/bucket** (se
  activa por env sin tocar dominio). Ventaja: 6.1a no requiere credenciales cloud,
  los tests corren sin secretos (regla dura), y el puerto queda validado. El cloud
  se añade como adaptador hermano cuando el usuario provisione el bucket.
- **Opción B2**: implementar ya el adaptador cloud real (requiere
  credenciales/bucket provisionados). Inconveniente: bloquea 6.1a a que exista la
  infra cloud; los tests seguirían necesitando un doble igualmente.

**Regla dura (invariante en ambas opciones)**: los tests NO dependen de
credenciales cloud (se prueba con doble/adaptador local).

**Recomendación**: **B1** (adaptador local por env ahora; cloud cuando haya
credenciales). **Pendiente de OK del humano en el gate.**

## Matiz razón social fiscal ≠ nombre comercial

Decidido con el usuario y central en el épico: en un documento fiscal la **razón
social** ("Canoliart, SL") y el **nombre comercial** ("Masia l'Encís") son
distintos y aparecen en sitios distintos (p. ej. cabecera fiscal vs. marca). Por
eso son **dos campos separados** en la config, y el `plantilla_concepto_fiscal`
usa el placeholder `{nombreComercial}` (nunca la razón social, y **nunca**
"lloguer"). En 6.2, la variante SIN IVA omitirá Canoliart+NIF de la cabecera; esa
lógica es de 6.2, aquí solo se guardan ambos valores.

## Testing (TDD, sin credenciales cloud)

- **Unit (RED primero)**: contrato de `AlmacenDocumentosPort` con un doble/adaptador
  local (subir→url, urlPublica); repositorio de lectura de config con doble.
- **Integración SQL real** (desde la **sesión principal**, que tiene Postgres — los
  subagentes QA no tienen BD): tabla creada por migración, `UNIQUE(tenant_id)`, RLS
  aísla por tenant, y el seed deja exactamente una fila por tenant con los datos
  reales e idempotencia al re-ejecutar.
- **No** hay curl (sin endpoint) ni E2E (sin frontend): esas fases se saltan en
  `tasks.md`.

## Alcance explícito NO incluido

`@react-pdf/renderer`, capa de plantilla/layout, sustitución de adapters *fake*,
numeración, variante SIN IVA/método de pago, facturas, Condicions particulars, UI
de ajustes, endpoint HTTP. Todo ello en 6.1b→6.5.
