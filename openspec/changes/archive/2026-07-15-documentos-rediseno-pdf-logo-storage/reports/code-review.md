# Code Review - documentos-rediseno-pdf-logo-storage (epico 6, rebanada 6.5)

Revision de SOLO LECTURA del working tree (branch feature/documentos-rediseno-pdf-logo-storage) vs master. Fecha: 2026-07-15. Revisor: code-reviewer.

Alcance: git diff master -- apps/api (28 ficheros) mas untracked (resolver-logo-data-uri.ts, BloqueTitulo.tsx, BloqueCondicions.tsx, resolver-logo-data-uri.spec.ts, seed-assets/masia-logo.jpg). Todo backend (apps/api, capability documentos); sin frontend, sin contrato OpenAPI.

## Veredicto: APTO

No hay hallazgos Bloqueantes ni Altos. Un unico hallazgo Medio de higiene de commit (asset untracked) ya identificado por QA, con accion clara y no arquitectonico. Resto conforme a guardrails.

## Checklist de guardrails

| Regla | Resultado |
|-------|-----------|
| Hexagonal (domain sin @nestjs/@prisma/infra) | OK |
| componentes solo .tsx; .ts en presentation | OK |
| Arrow functions (metodos de clase exentos) | OK |
| Multi-tenancy: clave por tenantId, sin fuga cross-tenant | OK |
| Bloqueo atomico de fecha intacto; sin Redis/lock distribuido | OK (no tocado) |
| Modelo de vista sin cambios | OK |
| Logo por data-URI/bytes, no HTTP; degradacion a solo-texto | OK |
| Ruta estatica fuera de /api, acotada, sin path traversal | OK |
| TS strict, sin any injustificado; sin function declarativo | OK |
| Importes en Decimal (no aplica: presentacion) | N/A |
| Errores y comentarios en espanol | OK |
| Tests primero (TDD) presentes | OK |
| Contrato OpenAPI coincide (sin delta, justificado) | OK |
| Responsive (frontend) | N/A (sin frontend) |

## Analisis por regla

### Hexagonal - OK
- domain/almacen-documentos.port.ts sigue siendo interfaz pura; la nueva op obtener(clave) devuelve Promise de Uint8Array o null y no importa @nestjs/@prisma/infra.
- domain/__tests__/almacen-documentos.port.spec.ts importa solo el type del puerto.
- Lectura/escritura de disco en infrastructure/almacen-documentos-local.adapter.ts; resolucion del logo en presentation/resolver-logo-data-uri.ts. Separacion correcta.
- resolverAlmacenLocalDir y crearAlmacenDocumentos (que conocen ConfigService) estan en documentos.module.ts / app.module.ts (composicion), no en dominio.

### componentes solo .tsx - OK
- presentation/componentes contiene exclusivamente .tsx (13 ficheros, incluidos los nuevos BloqueTitulo.tsx y BloqueCondicions.tsx).
- resolver-logo-data-uri.ts y estilos.ts viven en presentation (raiz), NO en componentes.

### Arrow functions - OK
- Helpers y componentes nuevos/modificados son arrow. Sin ninguna funcion declarativa en el diff. Los metodos de la clase AlmacenDocumentosLocalAdapter son metodos de clase Nest, exentos por la regla.

### Multi-tenancy - OK
- Clave del logo derivada por tenant: en el seed logos/TENANT_ID.jpg y en derivarClaveLogo el fallback logos/tenantId.jpg. resolverConfigConLogoDataUri usa config.tenantId; sin clave global ni lectura cruzada de otro tenant. No aplica JWT/RLS (render mas seed, no query de negocio nueva).

### Bloqueo atomico de fecha - OK
- El diff no toca el bloqueo. Busqueda de redis/redlock/ioredis/setnx en el diff sin coincidencias reales (los positivos son la palabra REDISENADO).

### Modelo de vista sin cambios - OK
- Ningun fichero modelo-documento aparece en el diff; el rediseno quedo confinado a estilos.ts mas componentes .tsx. Consistente con QA (tests de contenido verdes sin cambios).

### Logo por data-URI/bytes, no HTTP - OK
- resolver-logo-data-uri.ts lee bytes via almacen.obtener(clave) y compone un data-URI JPEG base64; nunca hace request HTTP durante el render. Los tres render (presupuesto/factura/condiciones) reciben el almacen opcional y resuelven el logo antes de renderizar. Degradacion: sin almacen, sin logoUrl o clave inexistente -> logoUrl null -> Cabecera.tsx cae a solo-texto. Cubierto por tests.

### Ruta estatica fuera de /api, acotada, sin path traversal - OK
- app.module.ts: ServeStaticModule.forRootAsync con serveRoot /almacen (fuera del prefijo global /api), rootPath acotado a ALMACEN_LOCAL_DIR, fallthrough:false (404 fuera del dir). rootPath resuelto con path.resolve; serve-static de Express normaliza .. y no sale del root. QA confirmo 200/404.

### TS strict / sin any - OK
- Sin any ni as any en el diff. Los casts son a interfaces tipadas (as ModuloReactPdf), patron ESM preexistente. obtener maneja ENOENT devolviendo null y propaga cualquier otro error de E/S.

### Errores y comentarios en espanol - OK
- crearAlmacenDocumentos lanza mensaje en espanol; validacion de entorno en espanol; comentarios del diff en espanol.

### Tests primero (TDD) - OK
- almacen-documentos.port.spec.ts (contrato mas obtener), almacen-documentos-local.adapter.spec.ts (persistencia a disco mas obtener mas durabilidad con instancia nueva, temp dir aislado), resolver-logo-data-uri.spec.ts (data-URI, degradacion, no-mutacion, fallback de clave), configuracion-documento-piloto.spec.ts (concepto sin lloguer mas color 5edada). Regla dura del epico verificada: plantillaConceptoFiscal correcto, sin lloguer, placeholder nombreComercial intacto.

### Contrato OpenAPI - OK
- Sin delta. GET /almacen es file server de assets, no API de negocio; no viaja por el SDK; las URLs (logoUrl, pdf_url) ya existian como strings. Justificado en proposal y design seccion E. Cliente generado del frontend no tocado.

### Sin hardcode de datos de negocio en la plantilla - OK
- componentes sin Masia/Canoliart/IBAN/NIF/masialencis. Los literales de BloqueCondicions.tsx y BloqueTitulo.tsx (percentajes, rotulos, etiquetas) son LAYOUT FIJO, no datos del tenant. Acento amarillo ffd978 como COLOR_ACENTO en estilos.ts (constante de presentacion, decision gate design seccion C). colorPrimario turquesa 5edada sigue siendo dato del tenant.

## Hallazgos

### Media
- [higiene-commit] apps/api/prisma/seed-assets/masia-logo.jpg esta untracked (git ls-files vacio; no gitignored). El seed (prisma/seed.ts) hace fs.readFile de seed-assets/masia-logo.jpg y falla en checkout limpio si el asset no se versiona. Ya senalado por QA (qa-report seccion 5). Recomendacion: incluir el binario en el commit del change antes de PR/archive. No es defecto arquitectonico; no bloquea el veredicto.

### Baja
- [consistencia-mensaje] documentos.module.ts linea 55: el error de ALMACEN_PROVIDER dice no esta implementado en 6.1a aunque el adaptador ya es 6.5. Cosmetico; opcional actualizar la referencia de rebanada.
- [nota] derivarClaveLogo (resolver-logo-data-uri.ts linea 28) cae a la clave local logos/tenantId.jpg cuando la logoUrl no es del almacen. Intencionado y seguro (misma clave por tenant, sin cruce), pero si en el futuro se soportan logos por URL externa real, el fallback deberia devolver null. No accionable ahora.

## Conclusion

El diff cumple los guardrails arquitectonicos de Slotify y el checklist de calidad backend: hexagonal intacto (puerto puro mas obtener), componentes solo .tsx, arrow functions, multi-tenancy por clave de tenant sin fugas, sin Redis/lock, modelo de vista sin cambios, logo por data-URI con degradacion a solo-texto, ruta estatica fuera de /api y acotada, sin any, TDD presente y regla sin lloguer verificada. El unico hallazgo Medio es de higiene de commit (asset untracked) con accion trivial.

Veredicto: APTO
