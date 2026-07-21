# Tasks — factura-senal-pdf-idioma-email-ux

> Pasos obligatorios del harness (SDD + TDD), en orden. El AGENTE ejecuta él mismo todas
> las pruebas (unit, curl, E2E); NUNCA las delega en el usuario. Cada `[x]` se marca solo
> tras ejecutar y verificar. Los tests de integración/concurrencia con BD real se lanzan
> desde la sesión principal (los subagentes QA no tienen Postgres).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Branch `worktree-feature-factura-senal-pdf-idioma-email-ux` creada en el worktree
      `.claude/worktrees/feature-factura-senal-pdf-idioma-email-ux` (EnterWorktree — ya hecho)
- [x] 0.2 Artefactos OpenSpec creados: `proposal.md`, `spec-delta.md`, `design.md`, `tasks.md`

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + `spec-delta.md` + `design.md`; ESPERAR OK explícito
- [x] 1.2 Decisiones D1/D2/D3 revisadas y aprobadas en el gate (plan aprobado)
- [x] 1.3 OK recibido — avanzar a contrato/TDD/implementación

## 2. Contrato OpenAPI + SDK (post-gate — dueño: contract-engineer)
- [x] 2.1 Añadir `e3Enviado: boolean` a `FacturaSenalResponse` en `docs/api-spec.yml`
- [x] 2.2 `spectral lint docs/api-spec.yml` → OK (0 errores, 40 warnings pre-existentes)
- [x] 2.3 Regenerar SDK frontend (`pnpm --filter web run generate-client`) → `e3Enviado: boolean` en schema.d.ts
- [x] 2.4 Dejar constancia: el contrato queda con 1 campo additive (non-breaking)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 3.1 Unit `modelo-documento-factura.spec.ts`:
      `construirModeloDocumentoFactura({…, idioma:'es'})` → `concepto` con texto ES,
      `pieLegal` = `config.textos.pieLegal.es`; idem `idioma:'ca'` → texto CA
      (RED verificado: 5 tests FAIL — `idioma` no existe aún en el modelo)
- [x] 3.2 Unit `catalogo-plantillas-e3.spec.ts` (nuevo):
      `renderE3Ca({nombre:'Sergio', codigoReserva:'R001'})` → asunto CA correcto,
      cuerpo contiene 'Moltes gràcies'; `renderE3({...})` → asunto ES, cuerpo contiene
      '¡Muchas gracias por confiar'; ningún texto menciona 'condicions particulars'
      (RED verificado: 15 tests FAIL — `renderE3Ca` no existe aún, asunto/cuerpo ES incorrecto)
- [x] 3.3 Unit `enviar-factura-senal.use-case.spec.ts` (nuevo caso):
      `idioma` de la reserva propagado a `EnviarE3EmisionParams`; nombre del adjunto
      contiene nombre + apellidos del cliente
      (RED verificado: 4 tests FAIL — `idioma` no existe, adjunto usa 'factura-senal.pdf')
- [x] 3.4 Confirmar suite en ROJO (RED) antes de implementar

## 4. Backend: implementación (OBLIGATORIO — step-N)

### 4a. PDF idioma
- [x] 4a.1 `etiquetas-por-idioma.ts`: añadir `importFactura` a `EtiquetasDocumento`, `ETIQUETAS_CA`, `ETIQUETAS_ES`
- [x] 4a.2 `modelo-documento-factura.ts`: añadir `idioma` a params/modelo; `resolverConcepto` bilíngüe; `pieLegal` por idioma
- [x] 4a.3 `cargar-datos-documento-factura.port.ts`: añadir `idioma?: string` a `DatosDocumentoFactura`
- [x] 4a.4 `cargar-datos-documento-factura.prisma.adapter.ts`: SELECT `reserva.idioma`
- [x] 4a.5 `pdf-factura.real.adapter.ts`: pasar `datos.idioma` a `construirModeloDocumentoFactura`
- [x] 4a.6 `BloqueConceptoFactura.tsx`: props `etiquetaConcepto`/`etiquetaPrecio`
- [x] 4a.7 `DocumentoFacturaLayout.tsx`: `etiquetasDocumento(modelo.idioma ?? 'ca')`; REBUT/RECIBO bilíngüe; pasar etiquetas a `BloqueConceptoFactura`

### 4b. E3 catálogo + idioma
- [x] 4b.1 `catalogo-plantillas.ts`: `renderE3` ES nuevo texto; `renderE3Ca` CA; `PLANTILLA_E3_CA`; `variablesRequeridas: ['nombre','codigoReserva']`
- [x] 4b.2 `lecturas-emision.prisma.adapter.ts`: añadir SELECT `idioma`, `cliente.nombre`, `cliente.apellidos`
- [x] 4b.3 `enviar-factura-senal.use-case.ts`: `idioma?`+`clienteNombre?`+`clienteApellidos?` en `ReservaSenalEmision`; propagado a `EnviarE3EmisionParams`; nombre adjunto
- [x] 4b.4 `reenviar-e3.use-case.ts`: ídem en `ReservaReenvioE3`; nombre adjunto
- [x] 4b.5 `emision-email.adapter.ts`: `EnviarE3EmisionAdapter` + `ReenviarE3Adapter` usan catálogo con `idioma`

### 4c. Flag `e3Enviado`
- [x] 4c.1 `obtener-factura-senal.use-case.ts`: `VerificarE3EnviadoPort` + `e3Enviado` en resultado
- [x] 4c.2 `lecturas-emision.prisma.adapter.ts`: `VerificarE3EnviadoPrismaAdapter` (query COMUNICACION E3 enviado, es_reenvio=false)
- [x] 4c.3 Wiring en `facturacion.module.ts` + token `VERIFICAR_E3_ENVIADO_PORT`

## 5. Frontend: implementación (OBLIGATORIO — step-N)
- [x] 5.1 `model/types.ts`: `e3Enviado` ya disponible vía `FacturaSenalDto` del SDK regenerado; doc comment añadido
- [x] 5.2 `useEnviarFacturaSenal.ts`: invalidar `comunicacionesReservaQueryKey` en `onSuccess`
- [x] 5.3 `useReenviarE3.ts`: invalidar `comunicacionesReservaQueryKey` en `onSuccess`
- [x] 5.4 `EnvioFacturaSenal.tsx`: banner verde eliminado; prop `e3Enviado`; botones condicionados
- [x] 5.5 `FacturaSenalCard.tsx`: pasar `factura.e3Enviado` a `EnvioFacturaSenal`

## 6. QA: unit tests + BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 `pnpm --filter api test` → verde (76 tests nuevos + anteriores; excl. integración/concurrencia que requieren Postgres)
- [x] 6.2 `pnpm --filter web build` → exit 0, sin errores TypeScript
- [x] 6.3 Report creado: `reports/2026-07-21-step-6-unit-tests.md`

## 7. QA: curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [ ] 7.1 `GET /reservas/{id}/factura-senal` → incluye `e3Enviado: false` (antes de enviar)
- [ ] 7.2 `POST /reservas/{id}/facturas/senal/enviar` → 200; adjunto nombrado correctamente
- [ ] 7.3 `GET /reservas/{id}/factura-senal` → `e3Enviado: true` (tras enviar)
- [ ] 7.4 Crear report `reports/2026-07-21-step-7-curl.md`

## 8. QA: E2E Playwright (OBLIGATORIO — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [ ] 8.1 Ficha reserva confirmada → enviar factura → toast aparece (no banner inline) → comunicaciones actualiza sin recargar → botón cambia a "Reenviar E3"
- [ ] 8.2 Reenviar E3 → nuevo registro en comunicaciones sin recargar
- [ ] 8.3 Crear report `reports/2026-07-21-step-8-e2e.md` + capturas

## 9. Documentación (OBLIGATORIO — step-N+4)
- [ ] 9.1 `docs-keeper` sincroniza docs afectados

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 10.1 `code-reviewer` sobre el diff completo
- [ ] 10.2 Report `reports/2026-07-21-step-10-code-review.md` con línea `Veredicto: APTO`

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Presentar al humano: code-review APTO + validación manual aprobados
- [ ] 11.2 ESPERAR OK explícito antes de archive/PR
- [ ] 11.3 `openspec archive` + PR
