# Tasks — pdf-presupuesto-horario-idioma

> Flujo del arnés SDD + TDD. El agente DEBE ejecutar él mismo todas las pruebas
> (unit, curl, E2E); nunca las delega en el usuario. Marcar `[x]` solo tras ejecutar
> y verificar. Reports en
> `openspec/changes/pdf-presupuesto-horario-idioma/reports/`.
>
> Alcance: **Mejora 1** (fecha "D de mes de AAAA" + rango horario "De HH:MM a HH:MM
> (N hores)" con fallback + `numPersonas` derivado del aforo), **Mejora 2** (título
> "PRESSUPOST" en amarillo, solo el presupuesto), **Mejora 3** (idioma es/ca del PDF:
> etiquetas fijas + textos libres bilingües por seed/migración). SIN cambios de
> contrato OpenAPI.

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Trabajo en el **worktree aislado** `presupuesto-pdf-horario-idioma`
  (equivale a la feature branch `feature/presupuesto-pdf-horario-idioma`; Step 0
  satisfecho por el worktree, no se crea rama nueva ni se hace checkout).
- [x] 0.2 Confirmada la branch activa del worktree antes de cualquier escritura.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`documentos`,
  `presupuestos`) + `design.md` y **ESPERAR su OK explícito** antes de avanzar a
  TDD/impl. **EL FLUJO SE DETIENE AQUÍ.** (OK dado en Gate 1.)
- [x] 1.2 Confirmar las cuestiones abiertas del `design.md`: traducción `es` de los
  textos libres del piloto (la redacta el implementador, revisión en QA §D3), factura
  sin i18n en este change (§D6), estrategia de migración (**eliminar en la misma
  migración**, §D3). Resueltas en Gate 1 (ver `design.md`).

## 2. Contrato (NO aplica)

- [x] 2.1 Verificar que NO hay cambios de contrato OpenAPI ni de SDK (el PDF es
  interno, post-commit). No se toca `docs/api-spec.yml` ni el cliente generado.

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 **Builder (Mejora 1 · fecha)**: tests en rojo de
  `construirModeloDocumentoPresupuesto` — fecha "20 de setembre de 2026" (ca) y
  "20 de septiembre de 2026" (es), con año, sin `dd/mm/aaaa`. RED en
  `modelo-documento-presupuesto-idioma.spec.ts` + helper puro `formatearFechaLarga`/
  `MESES` en `i18n-documento.spec.ts`.
- [x] 3.2 **Builder (Mejora 1 · horario)**: tests en rojo — "De 12:00 a 20:00
  (8 hores)"; cruce de medianoche "De 22:00 a 02:00 (4 hores)" (`mod 1440`);
  fallback `horario = null` → "(8 hores)" sin rango; formato siempre "HH:MM". RED en
  `modelo-documento-presupuesto-idioma.spec.ts` + helpers puros `calcularHoraFin`/
  `formatearHorario` en `i18n-documento.spec.ts`.
- [x] 3.3 **Adaptador (Mejora 1 · numPersonas)**: test en rojo del helper puro
  `derivarNumPersonas` (`presupuestos/domain/__tests__/derivar-num-personas.spec.ts`)
  — `numPersonas = numInvitadosFinal ?? (numAdultosNinosMayores4 + numNinosMenores4)`.
  La verificación del ADAPTADOR contra BD real (proyección de `idioma`/`horario`) la
  hace QA desde la sesión principal (los subagentes no tienen Postgres).
- [x] 3.4 **Layout (Mejora 2 · título amarillo)**: test en rojo — el
  `DocumentoLayout` del presupuesto pinta el título con `COLOR_ACENTO` (#ffd978);
  el `DocumentoFacturaLayout` sigue en `colorPrimario` (turquesa), sin regresión.
  RED en `documento-presupuesto-titulo-amarillo.layout.spec.ts`.
- [x] 3.5 **Builder + i18n (Mejora 3 · etiquetas)**: tests en rojo — etiquetas fijas
  resueltas por idioma (ca: PRESSUPOST/CONCEPTE/PREU/persones/Validesa/…; es:
  PRESUPUESTO/CONCEPTO/PRECIO/personas/Validez/…); default `es` para idioma
  desconocido. RED en `modelo-documento-presupuesto-idioma.spec.ts` + helper puro
  `etiquetasDocumento` en `i18n-documento.spec.ts`.
- [x] 3.6 **VO + builder (Mejora 3 · textos libres)**: tests en rojo — `TextosDocumento`
  y `condiciones` bilingües `{ca,es}`; el builder elige el texto por `idioma` y
  resuelve `{nombreComercial}` sin "lloguer". RED en
  `modelo-documento-presupuesto-idioma.spec.ts` (builder elige por idioma) y
  `configuracion-documento-piloto-bilingue.spec.ts` (VO bilingüe).
- [x] 3.7 **Seed (Mejora 3)**: tests en rojo de `construirConfiguracionDocumentoPiloto`
  — textos libres bilingües; 14 secciones de condicions con `ca` y `es` no vacíos,
  en orden. RED en `configuracion-documento-piloto-bilingue.spec.ts`.
- [x] 3.8 Confirmar que la suite está en **rojo** por las razones esperadas antes de
  implementar (builder/adaptador/VO/seed por comportamiento nuevo). Verificado:
  6 suites nuevas fallan por AUSENCIA DE IMPLEMENTACIÓN (módulos i18n/helper
  inexistentes; VO `textos`/`condiciones` aún monolingüe; `DatosDocumentoPresupuesto`
  sin `idioma`/`horario`), no por errores de sintaxis. Un spec RENDER de las tres
  líneas del concepto se añade en `documento-presupuesto-concepto-tres-lineas.layout.spec.ts`.

## 4. Backend: implementar + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)

- [x] 4.1 **VO** `documentos/domain/configuracion-documento.ts`: `TextosDocumento`
  y `CondicionesDocumento` bilingües `{ca,es}` (nuevo `TextoBilingue`).
- [x] 4.2 **i18n** en `documentos/presentation`: helpers puros `meses.ts` (`MESES`
  `{ca,es}` estático + `formatearFechaLarga` en UTC, sin `Intl`), `horario.ts`
  (`calcularHoraFin` `mod 1440` + `formatearHorario`), `etiquetas-por-idioma.ts`
  (`etiquetasDocumento`, default `es`); arrow functions.
- [x] 4.3 **Builder** `modelo-documento-presupuesto.ts`: `DatosDocumentoPresupuesto`
  gana `idioma: 'es'|'ca'` y `horario: string|null`; el modelo expone
  `fechaEventoTexto`, `horarioTexto`, `etiquetas`; textos libres elegidos por idioma;
  `{nombreComercial}` resuelto.
- [x] 4.4 **Componentes** `TablaConcepto.tsx` (tres líneas: fecha / horario /
  personas), `DocumentoLayout.tsx` (título con `COLOR_ACENTO` + etiquetas),
  `BloqueTitulo.tsx` (prop `colorTitulo`), `BloqueCliente/BloqueTotales/
  BloqueCondicions` (rótulos por `etiquetas`), `DocumentoFacturaLayout.tsx`
  (idioma fijo `ca`, título turquesa intacto); `componentes/` solo `.tsx`.
- [x] 4.5 **Migración Prisma** no destructiva de `PlantillaDocumentoTenant`
  (`20260720120000_documento_textos_bilingues`): ADD `_ca`/`_es` → backfill `_ca` =
  columna actual, `_es` = placeholder → `condiciones` JSON → NOT NULL → DROP columnas
  monolingües; NO recrea la policy RLS. Cliente Prisma regenerado (`prisma generate`).
  NOTA: la migración NO se ha aplicado a Postgres (sin BD en el subagente) → QA.
- [x] 4.6 **Adaptador de config** `configuracion-documento.prisma.adapter.ts`: mapea
  las columnas `_ca`/`_es` al VO bilingüe; `condiciones` JSON bilingüe.
- [x] 4.7 **Adaptador de carga** `cargar-datos-documento-presupuesto.prisma.adapter.ts`:
  proyecta `idioma` (normalizado a `es|ca`) y `horario`; `numPersonas` vía
  `derivarNumPersonas`. RLS intacta. NOTA: sin verificar contra BD real → QA.
- [x] 4.8 **Seed** `configuracion-documento-piloto.ts`: textos libres bilingües
  (ca actual + traducción es) y 14 secciones de condicions bilingües (ca+es).
- [x] 4.9 Actualizados los tests unitarios existentes afectados (config/factura/
  plantilla/condiciones que construyen `ConfiguracionDocumentoTenant`/datos) al VO
  bilingüe + `idioma`/`horario`; `typecheck` y `lint` en verde; suites en verde
  (aislando la flakiness react-pdf ESM conocida).

## 5. Frontend (NO aplica)

- [x] 5.1 Sin cambios de frontend: el PDF se genera en `apps/api`. Confirmado: sin
  superficie de UI tocada.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 6.1 Capturar baseline de BD (`PLANTILLA_DOCUMENTO_TENANT` del tenant piloto).
  BD de test aislada del worktree `slotify_test_pdf`.
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (builder de presupuesto,
  i18n, adaptadores de config y carga, seed). Render react-pdf verificado en
  aislamiento (verde: 16/16 + 27/27 + 8/8); la flakiness ESM aparece solo con
  `--runInBand` al correr las suites react-pdf juntas.
- [x] 6.3 Ejecutar la suite (`pnpm test`): 2709 passed; los 9 fallos son
  exclusivamente render react-pdf por la flakiness ESM conocida (verde en aislamiento).
- [x] 6.4 Aplicada la migración (`migrate deploy`) + reseed del piloto en BD real;
  verificadas columnas bilingües `_ca`/`_es` (NOT NULL), DROP de monolingües y
  `condiciones` JSON bilingüe.
- [x] 6.5 Report creado en `reports/qa-report.md`.
- [x] 6.6 Tests en verde (aislando flakiness ESM) y report creado.

## 7. QA: verificación del PDF real generado (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

> Sustituye las pruebas curl: no hay endpoint nuevo. La verificación es del PDF
> generado por el flujo real de confirmación de presupuesto (post-commit).

- [x] 7.1 PDF real generado con la config bilingüe del piloto (render react-pdf →
  bytes `%PDF` → `pdftotext`).
- [x] 7.2 `idioma = 'ca'` con `horario`/`duracionHoras` → PDF con "20 de setembre de
  2026", "De 12:00 a 20:00 (8 hores)", "14 persones", etiquetas catalanas.
- [x] 7.3 `idioma = 'es'` → etiquetas + textos libres en castellano ("20 de septiembre
  de 2026", "De 12:00 a 20:00 (8 horas)", "14 personas", pie bancario en es).
- [x] 7.4 `horario = null` → "(8 horas)" sin rango, sin error.
- [x] 7.5 Título del presupuesto en amarillo `COLOR_ACENTO` (test de layout); factura
  conserva turquesa (sin regresión).
- [x] 7.6 `numPersonas` derivado `numInvitadosFinal ?? (numAdultosNinosMayores4 +
  numNinosMenores4)` (helper `derivarNumPersonas` con unit tests).
- [x] 7.7 PDFs adjuntos en `reports/pdf/`; verificación en `reports/qa-report.md`.

## 8. QA: E2E (NO aplica — sin frontend)

- [x] 8.1 No hay superficie de UI nueva; la verificación E2E del PDF se cubre en el
  paso 7 (generación real del documento). Documentado en `reports/qa-report.md`.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 9.1 Actualizada `docs/` afectada: `er-diagram.md` (v5.3) y `data-model.md`
  (v3.0) — `PlantillaDocumentoTenant` columnas bilingües `_ca`/`_es` + `condiciones`
  bilingüe, PDF en idioma del cliente, `horaFin` derivada. `api-spec` sin cambios.

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 10.1 Ejecutado `code-reviewer` sobre el diff (guardrails verificados OK).
- [x] 10.2 Informe `reports/code-review.md` con `Veredicto: APTO` (sin bloqueantes ni
  mayores; nits menores documentados).

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes
  de archive/PR. **EL FLUJO SE DETIENE AQUÍ.** (OK dado en Gate 2: commit + archivar
  + PR, con rebase sobre master.)

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 12.1 `openspec archive pdf-presupuesto-horario-idioma` (aplica: `documentos`
  ADDED x3 + MODIFIED x4; `presupuestos` MODIFIED x1). Verificar el conteo de
  secciones antes de archivar (una sola sección por requirement).
- [ ] 12.2 Verificar `openspec/specs/` actualizado por `archive`; abrir PR contra
  `master` (GitHub MCP o `gh`).
