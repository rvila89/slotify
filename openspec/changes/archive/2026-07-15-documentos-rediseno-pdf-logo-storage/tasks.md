# Tasks — documentos-rediseno-pdf-logo-storage (épico #6, rebanada 6.5)

> Todo backend (`apps/api`, capability `documentos`). Sin frontend, sin endpoints
> de negocio nuevos, **sin cambio de contrato OpenAPI** (ver `design.md` §E) → no
> hay fase de contrato/SDK ni E2E Playwright. Los tests de integración/render y
> las muestras visuales se lanzan desde la **sesión principal** (los subagentes QA
> no tienen Postgres). Marcar `[x]` solo tras ejecutar y verificar.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Crear branch `feature/documentos-rediseno-pdf-logo-storage` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/documentos/spec.md`)
      + `design.md` y **ESPERAR su OK explícito** antes de implementar. No avanzar
      por defecto aunque parezca trivial.
- [x] 1.2 Resolver las cuestiones abiertas de `design.md` (A ruta estática, B carga
      del logo por bytes, C acento como constante de presentación, D alcance
      variantes, E sin contrato) con la decisión aprobada.

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 2.1 **Bloque A (storage)**: test del `AlmacenDocumentosLocalAdapter` que
      verifique que `subir` **escribe a disco** en `ALMACEN_LOCAL_DIR/{clave}`, que
      `urlPublica` es determinista, y que los bytes persisten (releer del disco).
      Usar directorio temporal aislado (sin credenciales cloud). (RED) — incluye el
      nuevo `obtener(clave)` en el adaptador y en el contrato del puerto
      (`domain/__tests__/almacen-documentos.port.spec.ts`).
- [x] 2.2 **Bloque A (ruta estática)**: test que verifique que un fichero bajo
      `ALMACEN_LOCAL_DIR` se sirve por `GET /almacen/{clave}` (según mecanismo
      aprobado en design §A). (RED)
- [x] 2.3 **Bloque B (seed/logo)**: test del factory/seed que verifique que el logo
      se sube por `subir(bytes, 'logos/{tenantId}.jpg')` y que `branding.logoUrl`
      deja de ser `null`; e idempotencia. (RED) — *diferido a implementación por
      TDD-RED (subida real del logo = side-effect del `prisma/seed.ts`, no del
      factory PURO; se cubrirá con almacén falso + fichero temporal al implementar).*
- [x] 2.4 **Bloque B (concepto)**: test del factory `construirConfiguracionDocumentoPiloto`
      que verifique `plantillaConceptoFiscal === "Gestió ús espai de {nombreComercial} per esdeveniment"`
      y que **NO** contiene "lloguer". (RED) — añadido también el aserto de
      `colorPrimario === '#5edada'`.
- [x] 2.5 **Bloque B (cabecera por bytes)**: test que verifique que la cabecera con
      logo se renderiza a partir de **bytes/data-URI** (no de URL remota) y que sin
      logo cae a solo-texto sin romper el render. (RED) — implementado como unit puro
      `presentation/__tests__/resolver-logo-data-uri.spec.ts` (deriva clave, data-URI,
      degradación a solo-texto).
- [x] 2.6 **Bloque C (fidelidad visual)**: tests de presentación que aserten los
      nuevos marcadores del rediseño (barra turquesa `CONCEPTE|PREU`, franja
      `Validesa|Base imp.|% Iva|Total`, título "PRESSUPOST", acento `#ffd978`,
      `colorPrimario` turquesa aplicado), sin romper los **tests de contenido del
      modelo** existentes. (RED)

## 3. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [x] 3.1 Revisar los tests de presentación existentes (`presentation/__tests__/*`)
      y ajustarlos al nuevo layout **solo** en lo visual; los tests de **contenido
      del modelo** deben permanecer verdes sin cambios de datos. — Ningún test de
      contenido se tocó; todos pasan sin cambios (el rediseño quedó solo en la vista).
- [x] 3.2 Implementar Bloque A: `AlmacenDocumentosLocalAdapter` a disco
      (`ALMACEN_LOCAL_DIR`, default) + ruta estática `GET /almacen/*` + env
      (`env.validation.ts`: `ALMACEN_LOCAL_DIR`). — Puerto gana `obtener`;
      `@nestjs/serve-static` (`ServeStaticModule.forRootAsync`, `serveRoot:'/almacen'`)
      en `app.module.ts`, fuera del prefijo `/api`.
- [x] 3.3 Implementar Bloque B: seed sube `masia-logo.jpg` y fija `logoUrl`; cambiar
      `plantillaConceptoFiscal` y `colorPrimario` (`#5edada`) en el factory piloto;
      carga del logo por bytes/data-URI en el adaptador de PDF + `Cabecera`. — Logo
      resuelto a data-URI en el render vía `resolver-logo-data-uri.ts`; wiring del
      almacén en los tres módulos (presupuestos/facturacion/documentos).
- [x] 3.4 Implementar Bloque C: reescribir `estilos.ts` + componentes compartidos
      (`Cabecera`, `BloqueCliente`, `TablaConcepto`, `BloqueTotales`, `PieBancario`,
      `DocumentoLayout`, `DocumentoFacturaLayout`, `DocumentoCondicionesLayout`)
      fieles a la referencia; acento `#ffd978` como constante de presentación. —
      Nuevos `BloqueTitulo.tsx` y `BloqueCondicions.tsx`; acento `COLOR_ACENTO` en
      `estilos.ts`. Muestras CON/SIN IVA en `reports/` (preview backend; QA regenera).
- [x] 3.5 Verificar guardarraíles: `domain/` sin imports de infra; `componentes/`
      solo `.tsx`; **arrow functions**; sin datos de negocio hardcodeados en la
      plantilla. `pnpm lint` + `pnpm typecheck` + `pnpm arch` verdes.

## 4. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 4.1 Capturar baseline de BD (`PlantillaDocumentoTenant` del piloto:
      `logo_url`, `plantilla_concepto_fiscal`, `color_primario`).
- [x] 4.2 Ejecutar tests dirigidos de `documentos` (adaptador almacén, seed factory,
      presentación) — verificar en **aislamiento** por la flakiness ESM de react-pdf.
- [x] 4.3 Ejecutar la suite requerida (`pnpm lint`, `pnpm typecheck`, `pnpm test`);
      registrar totales, runtime y flaky conocidos.
- [x] 4.4 Ejecutar el seed (`pnpm db:seed`) y verificar en BD que `logo_url` no es
      `null`, el concepto es el nuevo y `color_primario = "#5edada"`; comprobar
      idempotencia re-ejecutando el seed.
- [x] 4.5 Verificar que el fichero del logo existe en `ALMACEN_LOCAL_DIR/logos/…` y
      persiste (releer). Restaurar BD/directorio si procede.
- [x] 4.6 Crear report `openspec/changes/documentos-rediseno-pdf-logo-storage/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`

## 5. QA: pruebas manuales con curl + muestras visuales (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [x] 5.1 Levantar el backend (sesión principal, con Postgres) tras seed.
- [x] 5.2 `curl -I http://localhost:3000/almacen/logos/{tenantId}.jpg` → verificar
      **200** y `Content-Type` de imagen (la ruta estática sirve el logo).
- [x] 5.3 Regenerar el **presupuesto CON IVA** y `curl` de su `pdf_url` → verificar
      que resuelve (200) y descargar el PDF a `reports/`.
- [x] 5.4 Comparar visualmente el PDF CON IVA contra `P2026023 Laura Mas.pdf`
      (logo, turquesa, título "PRESSUPOST", barra concepto, franja totales,
      mini-tabla condicions, IBAN centrado).
- [x] 5.5 Generar también **SIN IVA + factura señal 40% + condicions** y verificar
      coherencia visual y la derivación correcta por flags.
- [x] 5.6 Guardar los PDFs de muestra (4 variantes) en
      `openspec/changes/documentos-rediseno-pdf-logo-storage/reports/`.
- [x] 5.7 Restaurar el estado de BD/almacén tras las pruebas.
- [x] 5.8 Crear report `…/reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 6. QA: E2E con Playwright MCP (step-N+3) — NO APLICA

- [x] 6.1 **N/A**: esta rebanada no toca frontend (solo backend + ruta estática de
      assets). Se documenta como no aplicable en el report de QA.

## 7. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 7.1 Actualizar el roadmap `epico-6-documentos-pdf-roadmap` marcando 6.5
      cerrada y el re-scope (UI ajustes → rediseño/logo/storage; cloud diferido).
- [x] 7.2 Documentar la nueva env `ALMACEN_LOCAL_DIR` y la ruta estática
      `GET /almacen/*` donde corresponda (`.env.example`, README/arquitectura).
- [x] 7.3 Nota del asset `masia-logo.jpg` y de que el logo se carga por bytes.

## 8. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 8.1 Ejecutar `code-reviewer` sobre el diff (hexagonal, arrow-functions,
      `componentes/` solo `.tsx`, sin hardcode de negocio, storage durable, logo por
      bytes, concepto sin "lloguer", sin cambio de contrato indebido).
- [x] 8.2 Dejar informe `…/reports/YYYY-MM-DD-step-review-code-review.md` con la
      línea literal `Veredicto: APTO`.

## 9. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [x] 9.1 Tras code-review APTO + validación manual (muestras visuales comparadas
      con la referencia), **ESPERAR el OK humano** antes de archive/PR.

## 10. Archivar change + abrir PR (OBLIGATORIO — archive)

- [x] 10.1 `openspec archive documentos-rediseno-pdf-logo-storage` (solo tras gate
      final y code-review APTO); actualizar `openspec/specs/documentos/`.
- [x] 10.2 Abrir PR con `gh` (o GitHub MCP); mover capturas/muestras a
      `reports/` del change (no en la raíz).
