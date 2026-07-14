# Tasks — documentos-condiciones-particulares-pdf (6.4a)

> Épico #6, rebanada 6.4a (SOLO bloques A y B; el envío E3 va en 6.4b).
> El agente DEBE ejecutar él mismo todas las pruebas; nunca delega en el usuario.
> react-pdf es ESM puro → tests con `NODE_OPTIONS=--experimental-vm-modules` (ya
> en el script `test`). Los tests de PDF/integración se lanzan desde la SESIÓN
> PRINCIPAL (los subagentes QA no tienen Postgres/Docker).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/documentos-condiciones-particulares-pdf` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`documentos`, `presupuestos`) + `design.md` y ESPERAR su OK explícito — **OK humano 2026-07-14**
- [x] 1.2 Resolver con el humano las cuestiones abiertas del `design.md`: **D1** texto parseado del Excel (14 secciones verbatim, sesión principal) · **D2** columna `Json` default `'{}'` + reseed piloto · **D3** degradar a `null` si config null **o** `secciones` vacío · **D4** confirmado sin OpenAPI (E3 en 6.4b) · **D5** validado (render unit + integración PDF + E2 con 2 adjuntos, sin Playwright)
- [x] 1.3 OK humano recibido — se avanza a TDD-RED

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

> Escribir los tests EN ROJO antes de tocar implementación. El hook
> `require-tests-first` bloquea implementar lógica sin test hermano.

- [x] 2.1 **VO config**: test de `ConfiguracionDocumentoTenant` con el bloque `condiciones` (`{ titulo, secciones: [{ titulo, cuerpo }] }`) — tipos/forma
- [x] 2.2 **Seed piloto**: test de `construirConfiguracionDocumentoPiloto` — `condiciones.titulo === 'Condicions Particulars'` y `condiciones.secciones` tiene exactamente 14 elementos (título + cuerpo no vacíos) en el orden especificado; determinista y puro
- [x] 2.3 **Adapter Prisma de config**: test (unit con Prisma mockeado) de que `aDominio(...)` mapea la columna JSON `condiciones` al bloque del VO
- [x] 2.4 **Render de plantilla**: test de `renderizarDocumentoCondicionesABytes(config)` — devuelve `Uint8Array` no vacío que empieza por `%PDF`; incluye título, títulos de las secciones y las etiquetas del bloque de firma (NOM I COGNOMS CLIENT / SIGNATURA CLIENT / DNI / DATA ESDEVENIMENT); bloque de firma en blanco (sin datos de reserva)
- [x] 2.5 **Adapter real** `PdfCondicionesRealAdapter`: (a) config `null` → devuelve `null` sin renderizar ni subir; (b) config presente → llama al render, sube por `AlmacenDocumentosPort.subir(bytes, 'condiciones/{tenantId}.pdf')` y devuelve la URL; (c) la clave AÍSLA por tenant (dos tenants → dos claves distintas)
- [x] 2.6 **Adapter fake** `PdfCondicionesFakeAdapter`: test de la URL sintética
- [x] 2.7 **DispararE2Adapter**: (a) presupuesto + condiciones presentes → el motor recibe DOS adjuntos (`presupuesto` y `condiciones`); (b) condiciones `null` → solo el adjunto `presupuesto`, sin fallar; (c) presupuesto `null` y condiciones `null` → adjuntos vacíos, sin fallar; (d) idempotencia E2 intacta
- [x] 2.8 Verificar que TODOS los tests nuevos están EN ROJO (RED) antes de implementar

## 3. Implementación — Bloque A: generación del PDF (`documentos`)

> Solo tras 2.8 (RED). Hexagonal: puertos en dominio, adapters en infra.

- [x] 3.1 Añadir el bloque `condiciones` (`CondicionesDocumento` / `SeccionCondiciones`) al VO `ConfiguracionDocumentoTenant` (`documentos/domain/configuracion-documento.ts`)
- [x] 3.2 Migración Prisma: columna `condiciones Json @map("condiciones")` en `PlantillaDocumentoTenant` (estrategia según D2: default `'{}'`, no destructiva). Migración SQL creada manualmente (`20260714130000_documento_condiciones_particulares`); `prisma generate` ejecutado. APPLY/reseed lo hace la sesión principal en QA (sin Postgres aquí)
- [x] 3.3 Mapear la columna en `ConfiguracionDocumentoPrismaAdapter.aDominio(...)`
- [x] 3.4 Poblar el bloque `condiciones` en `construirConfiguracionDocumentoPiloto` con el título y las 14 secciones reales (texto de D1)
- [x] 3.5 Plantilla react-pdf en `documentos/presentation/`: `modelo-documento-condiciones.ts` + `documento-condiciones.render.ts` (patrón ESM/import nativo de 6.1b)
- [x] 3.6 Componentes `.tsx` en `presentation/componentes/`: `DocumentoCondicionesLayout.tsx`, `ListaSeccionesCondiciones.tsx`, `BloqueFirmaCondiciones.tsx` (reutilizando `Cabecera`, `estilos.ts`, `kit-react-pdf.ts`). Guardarraíl: SOLO `.tsx` en `componentes/`
- [x] 3.7 Puerto de dominio `GenerarPdfCondicionesPort` `(params: { tenantId: string }) => Promise<string | null>`
- [x] 3.8 `PdfCondicionesRealAdapter` (infra `documentos`): config → degrada a `null` → render → `subir(bytes, 'condiciones/{tenantId}.pdf')` → url (espejo de `PdfPresupuestoRealAdapter`)
- [x] 3.9 `PdfCondicionesFakeAdapter` (tests)
- [x] 3.10 Token `GENERAR_PDF_CONDICIONES_PORT` en `documentos.tokens.ts`; cablear en `DocumentosModule` (factory con `ObtenerConfiguracionDocumentoService` + `ALMACEN_DOCUMENTOS_PORT` + render) y **exportarlo**

## 4. Implementación — Bloque B: adjuntar condiciones al E2 (`presupuestos`)
- [x] 4.1 Inyectar `GENERAR_PDF_CONDICIONES_PORT` en `DispararE2Adapter` (`presupuestos/infrastructure/disparar-e2.adapter.ts`)
- [x] 4.2 Generar la URL de condiciones y **añadir** `{ clave: 'condiciones', nombre: 'condicions-particulars.pdf', pdfUrl }` al array de adjuntos; omitir si `null` sin romper el E2
- [x] 4.3 Wiring en `PresupuestosModule` (asegurar import/export de `DocumentosModule` con el nuevo token)

## 5. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 5.1 Poner en VERDE todos los tests de la fase 2 (7 suites nuevas; render en verde en aislamiento — el batch conjunto de varios suites react-pdf dispara la flakiness ESM de teardown preexistente, se corre con aislamiento en la suite global de QA)
- [x] 5.2 Revisar/actualizar tests existentes de `documentos` y `presupuestos` afectados por el nuevo bloque de config y por el adjunto E2 (evitar regresiones): completado el campo `condiciones` en 7 fixtures de config y añadido tipo del parámetro al mock `motorFalso` de `disparar-e2` (fix de inferencia de jest, sin tocar aserciones); mapeada la columna en el adapter de factura
- [x] 5.3 `pnpm lint` + `pnpm typecheck` en verde (arrow-functions, `componentes/` solo `.tsx`, hexagonal)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO — desde la SESIÓN PRINCIPAL)
- [x] 6.1 Baseline BD: 1 fila piloto, SIN columna `condiciones` (pre-migración)
- [x] 6.2 Tests dirigidos 6.4a: no-render 22/22 + render condiciones (aislada) 8/8 verde
- [x] 6.3 Suite completa `jest --runInBand`: 1929/1947 PASS; los 18 fallos = flakiness ESM PRE-EXISTENTE de render react-pdf (reproducida SIN condiciones), no regresión de 6.4a
- [x] 6.4 Migración aplicada (`migrate deploy`) + reseed; columna `condiciones` poblada con 14 secciones y título "Condicions Particulars". **Fix en QA**: `prisma/seed.ts` no persistía el campo → añadido `condiciones` al `create` (import `Prisma` + cast `InputJsonValue`)
- [x] 6.5 Estado BD final = entregable del change (migración+seed); no se restaura al baseline
- [x] 6.6 Report `reports/2026-07-14-step-N+1-unit-test-and-db-verification.md` creado
- [x] 6.7 Completado: lógica 6.4a en verde + report

## 7. QA: verificación de integración + PDF real (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO — desde la SESIÓN PRINCIPAL)

> No hay endpoint HTTP nuevo (6.4a no toca OpenAPI). En lugar de curl a un
> endpoint inexistente, se verifica la GENERACIÓN del PDF y el DISPARO del E2 con
> dos adjuntos (plan D5, sujeto al gate).

- [x] 7.1 BD en estado conocido (piloto reseedeado con las 14 secciones)
- [x] 7.2 PDF real generado (9121 bytes, `%PDF-`, 14 secciones) e inspeccionado VISUALMENTE (3 pág.): cabecera comercial/fiscal, título, 14 secciones catalanas correctas, bloque de firma EN BLANCO. Muestra en `reports/pdf-muestra/condicions-particulars-piloto.pdf`
- [x] 7.3 Degradación a `null` verificada (config null o `secciones` vacío) — `pdf-condiciones.real.adapter.spec.ts`
- [x] 7.4 Disparo E2 con DOS adjuntos verificado (y omisión si `null`) — `disparar-e2.adapter.spec.ts` (no hay endpoint HTTP en 6.4a)
- [x] 7.5 Sin mutaciones extra que restaurar (solo lectura + render en memoria)
- [x] 7.6 Report `reports/2026-07-14-step-N+2-curl-endpoint-tests.md` creado

## 8. QA: E2E con Playwright MCP (OBLIGATORIO SI HAY FRONTEND — step-N+3 — NO APLICA)
- [x] 8.1 **NO APLICA**: 6.4a no tiene frontend (sin UI). Documentado en los reports step-N+1/N+2

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 9.1 Docs sincronizados: `er-diagram.md` (v4.8), `data-model.md` (v1.4), `architecture.md`, `development_guide.md`; use-cases/api-spec sin cambios justificados
- [x] 9.2 Roadmap del épico actualizado (memoria): 6.4 desdoblada en 6.4a/6.4b; se marca 6.4a al mergear

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 `code-reviewer` ejecutado sobre el diff (hexagonal, RLS, degradación, `componentes/` solo `.tsx`, aislamiento de clave — todos OK)
- [x] 10.2 Informe `reports/2026-07-14-step-review-code-review.md` con `Veredicto: APTO` (M1 corregido y re-verificado; quedan 2 Bajas no bloqueantes)
- [x] 10.3 N/A — fue APTO (M1 Media resuelto en el mismo ciclo con test 2.7e)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [ ] 11.1 Tras code-review APTO + verificación manual (PDF de muestra + E2 con dos adjuntos), ESPERAR el OK humano ANTES de archivar/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 12.1 `openspec archive documentos-condiciones-particulares-pdf` (solo tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin informe APTO)
- [ ] 12.2 Actualizar `openspec/specs/documentos` y `openspec/specs/presupuestos` con los deltas ADDED
- [ ] 12.3 Abrir PR (GitHub MCP o `gh`)
