# Tasks — solicitud-datos-presupuesto-borrador

> Flujo del arnés SDD + TDD. El agente DEBE ejecutar él mismo todas las pruebas manuales
> (unit, curl, E2E); nunca las delega en el usuario. Marcar `[x]` solo tras ejecutar y
> verificar. Reports en `openspec/changes/solicitud-datos-presupuesto-borrador/reports/`.
>
> Alcance: **backend** (nuevo `SolicitarDatosPresupuestoUseCase` + endpoint, reutiliza la
> plantilla del E1 disponible, idempotencia una-sola-vez), **contrato** (nuevo path + subtipo
> `solicitud_datos`, SDK regenerado) y **frontend** (botón condicionado en el modal de
> presupuesto + banner + refresco de Comunicaciones).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Crear branch `feature/solicitud-datos-presupuesto-borrador` desde `master` **antes**
  de cualquier escritura.
- [x] 0.2 Verificar la branch creada y la branch activa.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`comunicaciones`, `ficha-consulta-ui`)
  y **ESPERAR su OK explícito**. → Aprobado por el humano ("approve, continue with contract and TDD").
- [x] 1.2 Confirmar con el humano las dos decisiones de producto: (1) botón visible solo con
  datos fiscales incompletos; (2) idempotencia una-sola-vez (`409` tras enviado; reutiliza
  borrador pendiente). → Confirmadas vía AskUserQuestion ("Solo si faltan datos" + "No, una sola vez").
  Sin `design.md` (no hay decisiones técnicas no triviales).

## 2. Contrato: nuevo endpoint + subtipo (contract-engineer — tras el gate)

- [x] 2.1 Añadido a `docs/api-spec.yml` el path
  `POST /reservas/{id}/comunicaciones/solicitar-datos-presupuesto` (201/200/409/422/404).
- [x] 2.2 Añadido `solicitud_datos` al enum `SubtipoEmail` del contrato.
- [x] 2.3 Contrato validado (openapi-typescript) y **SDK regenerado** (`schema.d.ts`,
  `operationId: solicitarDatosPresupuesto`); cliente no editado a mano.

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 Backend (use-case · texto por idioma es/ca) — RED verificado (módulo ausente).
- [x] 3.2 Backend (use-case · borrador) — RED verificado.
- [x] 3.3 Backend (use-case · idempotencia 409 / reutiliza) — RED verificado.
- [x] 3.4 Backend (use-case · guardas 422/404 + tenant/RLS + audit) — RED verificado.
- [x] 3.5 Frontend (visibilidad del botón) — cubierto por
  `GenerarPresupuestoDialog.datosFiscales.test.tsx`.
- [x] 3.6 Frontend (efecto UI: cierre + scroll + banner + invalidación; `useAvisosFicha`)
  — cubierto por los tests de FichaConsulta / presupuestos.
- [x] 3.7 Suite en rojo por las razones esperadas antes de implementar.

## 4. Backend: implementar + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)

- [x] 4.1 Migración aditiva `20260724120000_subtipo_solicitud_datos` (enum `SubtipoEmail`) +
  cliente Prisma regenerado. **Aplicada a `slotify_dev` y `slotify_test`.**
- [x] 4.2 `SolicitarDatosPresupuestoUseCase` (reutiliza `renderMensajeTransicionFecha`,
  idempotencia, guardas, RLS/tenant, AUDIT_LOG). **Corrección QA:** crea el borrador
  DIRECTAMENTE vía `comunicaciones.crear` (no `motor.despachar`, que reejecutaba la plantilla
  del catálogo E1 y persistía el texto equivocado). Comentario de alcance de idempotencia
  corregido tras code-review (el índice solo protege `enviado`, no borradores concurrentes).
- [x] 4.3 Controlador `POST /reservas/:id/comunicaciones/solicitar-datos-presupuesto`
  (201/200 según `reutilizado`; 409 `COMUNICACION_DUPLICADA`, 422 `DATOS_FISCALES_COMPLETOS`, 404).
- [x] 4.4 Tests unitarios: use-case 14/14; suite módulo comunicaciones 29 suites / 247 tests verde.

## 5. Frontend: implementar (OBLIGATORIO — step-N)

- [x] 5.1 Hook `useSolicitarDatosPresupuesto` (invalida comunicaciones + reserva).
- [x] 5.2 `GenerarPresupuestoDialog.tsx`: botón secundario visible solo con datos incompletos
  (`datosFiscalesIncompletos` sobre `CAMPOS_FISCALES`); prop `onSolicitarDatos`.
- [x] 5.3 Cableado `onSolicitarDatos` hasta `FichaConsultaPage` (patrón `onConfirmadoPresupuesto`):
  cierra modal + scroll-top + `mostrarSolicitudDatosBorrador()` + refresco Comunicaciones.
- [x] 5.4 `useAvisosFicha`: estado `solicitudDatos` + `mostrarSolicitudDatosBorrador()`.
- [x] 5.5 `AvisosFicha` + `AvisoSolicitudDatosBorrador` (banner emerald).
- [x] 5.6 Reglas duras (arrow functions, `components/` solo `.tsx`, mobile-first). Flujo
  enviar-borrador + banner "email enviado" NO tocado.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 6.1 Baseline de BD (tenant piloto verificado en `slotify_test`).
- [x] 6.2 Tests dirigidos de módulos cambiados (comunicaciones + web presupuestos/FichaConsulta).
- [x] 6.3 **Integración con Postgres real** (`slotify_test`): 7/7 verde — 201 crea borrador con
  el CUERPO correcto (es/ca), 409 tras enviado, reutiliza borrador, coexistencia con
  `('E1','fecha_disponible')` bajo el índice UNIQUE parcial, 422, 404.
- [x] 6.4 Suite completa `apps/api`: 2900/2913. 13 fallos en 9 suites **pre-existentes en
  master** (git diff vacío en esos ficheros): plantilla/transición-fecha firma, alta-consulta,
  react-pdf ESM, concurrencia US-004 40P01. Web: mis tests verde; 2 fallos `DetallesEvento`
  pre-existentes ajenos.
- [x] 6.5 Estado de BD restaurado (los tests de integración limpian en `afterAll`).
- [x] 6.6 Report `reports/2026-07-24-step-6-unit-test-and-db-verification.md` creado.
- [x] 6.7 Completado: tests del change en verde + report.

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [x] 7.1 API real (`pnpm dev`) en `:3100` contra `slotify_dev`; login gestor OK.
- [x] 7.2 Reserva incompleta `es` → **201** borrador es (asunto "Pre-reserva confirmada", cuerpo correcto).
- [x] 7.3 Reserva `ca` → **201** borrador ca.
- [x] 7.4 Borrador pendiente → **200** reutiliza; tras `enviado` → **409** `COMUNICACION_DUPLICADA`.
- [x] 7.5 Datos completos → **422** `DATOS_FISCALES_COMPLETOS`; inexistente → **404**.
- [x] 7.6 Report `reports/2026-07-24-step-7-curl-endpoint-tests.md` creado. **6/6 PASS.** Datos limpiados.

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [x] 8.1 Web `:5273` + API `:3100`; reservas E2E-SDP-1 (incompleta) y E2E-SDP-2 (completa) sembradas.
- [x] 8.2 Datos incompletos: botón aparece → click → modal cierra + scroll-top + banner + borrador en Comunicaciones. **PASS.**
- [x] 8.3 Datos completos: el botón "Solicitar datos" NO aparece. **PASS.**
- [x] 8.4 Enviar borrador → banner "email enviado" + estado Enviado; 2ª solicitud → aviso inline 409 sin banner. **PASS.**
- [x] 8.5 Verificado en 390/768/1280, overflow 0; nav colapsa a drawer en `<lg`. **PASS.**
- [x] 8.6 Servidores parados; datos de prueba limpiados; 11 capturas en `reports/e2e-screenshots/`.
- [x] 8.7 Report `reports/2026-07-24-step-8-e2e-playwright.md` creado. **Outcome global: PASS.**

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 9.1 `docs-keeper` sincronizó `docs/er-diagram.md`, `docs/data-model.md` y `docs/use-cases.md`
  (subtipo `solicitud_datos` en enum/diccionario + UC-14 FA-01 y tabla de emails E1). `api-spec.yml`
  ya lo actualizó el contract-engineer.

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 10.1 `code-reviewer` ejecutado sobre el diff.
- [x] 10.2 Informe `reports/2026-07-24-step-review-code-review.md` con `Veredicto: APTO`
  (3 hallazgos no bloqueantes; el de severidad Media —comentario engañoso— corregido).

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [ ] 11.1 Tras code-review APTO, **ESPERAR el OK humano** antes de archive/PR. **EL FLUJO SE
  DETIENE AQUÍ.** (Incluye la decisión sobre curl §7 / E2E §8.)

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 12.1 `openspec archive solicitud-datos-presupuesto-borrador`.
- [ ] 12.2 Verificar `openspec/specs/` actualizado; abrir PR contra `master`.
