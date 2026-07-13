# Code review — documentos-config-tenant-storage (rebanada 6.1a)

- **Fecha:** 2026-07-13
- **Revisor:** code-reviewer (solo lectura)
- **Alcance:** diff de la branch `feature/documentos-config-tenant-storage` (cambios en árbol de trabajo vs `master`): módulo `apps/api/src/documentos/`, modelo Prisma `PlantillaDocumentoTenant` + migración `20260713140000_documento_config_tenant`, seed, `app.module.ts`, `env.validation.ts`, docs (`er-diagram.md`, `architecture.md`).
- **Naturaleza de la rebanada:** solo cimientos (config de documento por tenant + puerto de object storage + seed). Sin PDF, sin react-pdf, sin endpoint HTTP, sin frontend.

## Verificaciones automáticas

| Check | Comando | Resultado |
|-------|---------|-----------|
| Lint (ESLint, arrow-functions/max-lines/boundaries) | `pnpm --filter @slotify/api lint` | Verde (0 errores) |
| Typecheck (TS strict) | `pnpm --filter @slotify/api typecheck` | Verde |
| Arquitectura (dependency-cruiser) | `pnpm --filter @slotify/api arch` | `✔ no dependency violations found (513 módulos)` |
| Tests unitarios/puros `documentos` (dominio + aplicación + adaptador local + seed) | `jest --runInBand` | 15/15 verde (4 suites) |
| Test integración SQL real (Postgres `slotify_test`) | `jest` con `DATABASE_URL` de `.env.test` | 6/6 verde (tabla + UNIQUE + FK + RLS + policy + aislamiento + mapeo VO) |

Total módulo: 21/21 tests verde. Migración ya aplicada a `slotify_test` (`prisma migrate deploy` → sin drift, sin pendientes).

## Checklist de guardrails

### Hexagonal / DDD — OK
- `domain/` (`almacen-documentos.port.ts`, `configuracion-documento.ts`, `configuracion-documento.repository.port.ts`) es puro: solo `import type` entre ficheros de dominio; sin `@nestjs/*`, sin `@prisma/*`, sin `infrastructure/`. Verificado además por depcruise (0 violaciones) y por el hook `no-infra-in-domain`.
- Puertos en dominio; adaptadores en `infrastructure/`; tokens de inyección (Symbol) fuera del dominio en `documentos.tokens.ts`. Wiring por `useFactory`/`useClass` en `documentos.module.ts`.
- Servicio de aplicación `ObtenerConfiguracionDocumentoService` puro (constructor recibe el puerto; sin decoradores Nest).
- Test del contrato del puerto vive en `domain/__tests__/almacen-documentos.port.spec.ts` (doble in-memory, no importa infra); test del adaptador local en `infrastructure/__tests__/`. Separación correcta.
- **`.dependency-cruiser.cjs` sin cambios respecto a master** (confirmado: `git diff master -- apps/api/.dependency-cruiser.cjs` vacío). La relajación temporal quedó revertida.

### Multi-tenancy / RLS — OK
- Tabla `plantilla_documento_tenant` con `tenant_id` `UNIQUE` + FK a `tenant` (`ON DELETE RESTRICT ON UPDATE CASCADE`).
- Migración: `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation ... USING (tenant_id = current_setting('app.tenant_id', true))`. Calca exactamente el patrón del `init` (sin `FORCE`, como el resto del schema).
- Adaptador `ConfiguracionDocumentoPrismaAdapter.obtenerPorTenant` lee scoped por `tenantId` (`findUnique({ where: { tenantId } })`) dentro de `$transaction` con `fijarTenant(tx, tenantId)` como primera operación — mismo patrón que los demás adaptadores del proyecto (`calendario`, `dashboards`, `comunicaciones`, `confirmacion`).
- El `tenantId` es un parámetro del método (lo aporta la capa que hoy no existe en 6.1a: no hay endpoint que lo tome de path/body). Correcto para la rebanada.
- Nota (no regresión): como en todo el schema, la RLS es efectiva para roles sin `BYPASSRLS`; el owner la evita por diseño de PostgreSQL. Está documentado en `er-diagram.md §5.7` y en el test de integración. El aislamiento efectivo en dev/test lo garantiza el filtro por `tenantId` a nivel de aplicación. Comportamiento preexistente, no introducido por este change.

### Decisión A1 (duplicación de datos fiscales) — OK
- `PlantillaDocumentoTenant` guarda su propia copia de razón social, NIF, dirección, IBAN, etc. `Tenant.nombre/nif/direccion` no se borran ni migran; el modelo `Tenant` solo gana la relación inversa `plantillaDocumento PlantillaDocumentoTenant?`.
- `razonSocialFiscal` ("Canoliart, SL") y `nombreComercial` ("Masia l'Encís") son campos distintos, con tests que lo verifican (`!=`).

### Decisión B1 (adaptador por env) — OK
- `ALMACEN_PROVIDER` (`local`|`s3`, default `local`) y `ALMACEN_LOCAL_BASE_URL` añadidos a `env.validation.ts`.
- Factory `crearAlmacenDocumentos` instancia `AlmacenDocumentosLocalAdapter` para `local` y **lanza error explícito** para cualquier otro valor (incl. `s3`): fallo rápido, no silencioso.
- Tests del adaptador local sin credenciales cloud (`new AlmacenDocumentosLocalAdapter()`), bytes en memoria, URL determinista.

### Alcance 6.1a — OK
- `package.json` sin cambios: no se ha añadido `@react-pdf/renderer` ni `puppeteer` (verificado).
- `pdf-factura.fake.adapter.ts` y `pdf-presupuesto.fake.adapter.ts` sin tocar (`git status` limpio).
- Sin `*.controller.ts` en `documentos/`; sin cambios en `apps/web`. Contrato OpenAPI inalterado (sin endpoint nuevo, sin edición del cliente generado).

### Regla dura del épico ("espai", nunca "lloguer") — OK
- `plantillaConceptoFiscal = "Gestió de l'ús espai de {nombreComercial} per esdeveniment"`. Grep de "lloguer" en `src/documentos/` solo aparece en comentarios y aserciones negativas de test. Verificado en unit test (`configuracion-documento-piloto.spec.ts`) y en integración.

### Convenciones y tipos — OK
- Arrow-functions en helpers/factories (`construirConfiguracionDocumentoPiloto`, `crearAlmacenDocumentos`); métodos de clase Nest exentos. `pnpm lint` verde.
- Sin `any` en el módulo (grep sin resultados). TS strict verde.
- Todos los ficheros < 300 líneas (mayor: 184, un spec).
- Nombres y comentarios en español; identificadores en PascalCase/camelCase; ficheros en kebab-case.
- Sin secretos hardcodeados: IBAN/NIF/email del piloto son datos de negocio del dossier (no credenciales), correctamente ubicados en el factory del seed.

## Hallazgos

### Bloqueantes
- (ninguno)

### Alta
- (ninguno)

### Media
- (ninguno)

### Baja
- **[env / defensa en profundidad]** `env.validation.ts` (línea 43) admite `ALMACEN_PROVIDER=s3` como valor válido del enum, pero el factory (`documentos.module.ts` línea 39) lanza al arrancar si se selecciona `s3`. El comportamiento es el deseado por B1 (fallo explícito), pero el corte ocurre en el bootstrap del módulo y no en la validación de entorno. Recomendación (no bloqueante, para cuando se añada S3): considerar un `superRefine` que rechace `s3` mientras no exista el adaptador, para un mensaje aún más temprano/claro. Aceptable tal cual en 6.1a.
- **[migración / responsividad no aplica]** Rebanada sin frontend: el criterio "responsive en 3 viewports" no aplica y no requiere evidencia. Se deja constancia.

## Veredicto

Todos los guardrails duros (hexagonal, RLS/multi-tenancy, A1, B1, alcance 6.1a, regla "espai/lloguer", convenciones) se cumplen. Lint, typecheck, arch y los 21 tests del módulo (incl. integración SQL real contra Postgres) están en verde. `.dependency-cruiser.cjs` sin cambios respecto a master. No hay hallazgos bloqueantes ni de severidad alta/media.

Veredicto: APTO
