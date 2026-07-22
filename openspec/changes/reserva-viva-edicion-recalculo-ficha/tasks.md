# Tasks — reserva-viva-edicion-recalculo-ficha

> Flujo del arnés: `SDD → ⏸ review-gate-sdd → contrato → TDD-RED → impl (back ∥ front) → QA →
> code-review → docs → ⏸ review-gate-final → archive/PR`.
> El AGENTE ejecuta él mismo todas las pruebas (unit/curl/E2E). NUNCA delega en el usuario.
> Marca `[x]` SOLO tras ejecutar y verificar cada tarea.

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Branch `feature/reserva-viva-edicion-recalculo-ficha` (base `master`) — YA creada y
      checked out en el worktree por el usuario. NO crear rama nueva; NO tocar el checkout
      principal.
- [x] 0.2 Verificar la branch actual del worktree (`git branch --show-current`).

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)
- [x] 1.1 Presentar al humano `proposal.md`, los spec-deltas (`ficha-operativa`, `reserva-viva`,
      `presupuestos`, `facturacion`, `comunicaciones`) y `design.md`, y ESPERAR su OK explícito.
- [x] 1.2 NO avanzar a contrato/TDD/implementación hasta el OK (aunque se diga "continúa").

## 2. Contrato OpenAPI (contract-engineer — tras el gate)
- [x] 2.1 `FichaOperativa` (response de `GET`): exponer `duracionHoras` (enum `4/8/12`),
      `numAdultosNinosMayores4`, `numNinosMenores4`; `numInvitadosConfirmado` como valor DERIVADO
      read-only. Reflejar el pre-relleno.
- [x] 2.2 `GuardarFichaOperativaRequest` (body de `PATCH`): aceptar `duracionHoras` y el desglose
      de invitados; dejar de aceptar `numInvitadosConfirmado`/`duracion` como escritura de
      aforo/duración estructural (soft-deprecate). Añadir `precioManualEur` para el caso
      `tarifaAConsultar`.
- [x] 2.3 Respuesta de guardado enriquecida con el resultado del recálculo (nuevo total,
      `pagoInicial`, `liquidacionRestante`, versión de presupuesto y liquidación regeneradas, o
      `tarifaAConsultar`).
- [x] 2.4 `spectral lint docs/api-spec.yml` en verde (hook `validate-openapi`).
- [x] 2.5 Regenerar el SDK del frontend desde el contrato (NUNCA a mano; hook
      `protect-generated-client`).

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 3.1 Guarda de ventana viva `esEditableEnVentanaViva` (máquina de estados declarativa):
      casos dentro/fuera de ventana (ficha cerrada, liquidación cobrada, estado anterior). RED.
      `apps/api/src/reservas/__tests__/maquina-estados-ventana-viva.spec.ts` (RED: TS2305 —
      `esEditableEnVentanaViva` no exportado en `maquina-estados.ts`).
- [x] 3.2 Nº de invitados derivado (`derivarNumPersonas`) y pre-relleno al leer (valor propio
      prevalece; leer no muta). RED.
      - `apps/api/src/presupuestos/domain/derivar-num-personas.spec.ts` (VERDE: `derivarNumPersonas`
        YA existe; consolida cobertura de pre-relleno — sin implementación pendiente).
      - `apps/api/src/ficha-evento/__tests__/leer-ficha-operativa-prerelleno.use-case.spec.ts`
        (RED: 7 tests de pre-relleno fallan por falta de implementación; el use-case aún devuelve
        la ficha sin JOIN CLIENTE ni derivación).
- [x] 3.3 `RecalcularReservaVivaUseCase`: nuevo total con motor de tarifa; re-congelado
      `importe_total`/`importe_liquidacion` SIN tocar `importe_senal`; nueva versión de
      presupuesto de modificación (pago inicial fijo + restante); regeneración de liquidación
      (incluida ya `enviada`, nunca `cobrada`); fianza intacta. RED.
      `apps/api/src/ficha-evento/__tests__/recalcular-reserva-viva.use-case.spec.ts` (RED: TS2307 —
      módulo `recalcular-reserva-viva.use-case.ts` inexistente).
- [x] 3.4 Casos: `tarifaAConsultar` (>50 / sin tarifa) exige precio manual; idempotencia;
      concurrencia con cierre de ficha / cobro (guarda re-evaluada en tx); sin cambio real =
      no-op. RED. (Mismo spec que 3.3: `recalcular-reserva-viva.use-case.spec.ts`.)
- [x] 3.5 Email de modificación i18n (es/ca + fallback) — plantilla nueva. RED.
      `apps/api/src/comunicaciones/infrastructure/plantillas/catalogo-plantillas-e9.spec.ts`
      (RED: E9 no está en `CodigoEmail` ni registrado en el catálogo → `seleccionar('E9',…)` null).
- [x] 3.6 Test de INTEGRACIÓN por SQL real del recálculo (importes escritos por el use-case, NO
      sembrados a mano) — se ejecuta desde la sesión principal (subagentes sin Postgres). RED.
      Archivo: `ficha-evento/__tests__/recalcular-reserva-viva-integracion.spec.ts` (6 casos:
      importe_senal intacto, nueva versión presupuesto, factura regenerada, factura enviada,
      fuera_de_ventana_viva ficha cerrada, fuera_de_ventana_viva liquidación cobrada).
      PENDIENTE: el `tdd-engineer` NO lo escribe aquí (subagentes sin Docker/Postgres; ver memoria
      "Subagentes sin Docker/Postgres"). Lo escribe/ejecuta la SESIÓN PRINCIPAL con Postgres real.

## 4. Backend: implementación (backend-developer — tras TDD-RED)
- [x] 4.1 Guarda `esEditableEnVentanaViva` + error de dominio `FueraDeVentanaVivaError` (422).
- [x] 4.2 Lectura de ficha con pre-relleno derivado (JOIN CLIENTE en el adaptador de carga; read
      path completo: projection → DTO → contrato).
- [x] 4.3 Guardado de ficha: enrutar aforo/duración a la RESERVA; disparar recálculo si cambia y
      la guarda pasa.
- [x] 4.4 `RecalcularReservaVivaUseCase` (orquestación transaccional D-4) + adaptadores tx-bound
      (presupuesto versión, factura liquidación, reserva importes, auditoría, UoW).
- [x] 4.5 Plantilla de email de modificación (`CodigoEmail` nuevo es/ca) + disparo post-commit.

## 5. Frontend: implementación (frontend-developer — tras contrato/SDK)
- [x] 5.1 `features/ficha-operativa/`: inputs de invitados desglosados + duración enum `{4,8,12}`;
      nº personas derivado read-only; pre-relleno desde el SDK regenerado.
- [x] 5.2 Avisos de recálculo (nuevo total / restante) y de `tarifaAConsultar` (precio manual).
- [x] 5.3 Responsive mobile-first (390 / 768 / 1280), sin overflow, barrel `@/features/...`.

## 6. Backend: revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 6.1 Actualizar los tests de `ficha-evento` (guardado/lectura) y `confirmacion` (siembra)
      afectados por el cambio de aforo/duración estructural.
      REVISIÓN: (a) `guardar-ficha-operativa.use-case.spec.ts` solo cubría el path OPERATIVO
      legacy (`campos`) → HUECO real: no ejercitaba el enrutado de `estructurales`
      (duracionHoras/desglose/precioManualEur) al `RecalcularReservaVivaUseCase`. AÑADIDO un
      describe "enruta aforo/duración al recálculo (6.1)" con 5 casos: invoca el recálculo con
      campos estructurales, con solo `precioManualEur`, NO lo invoca sin estructurales, propaga
      `FueraDeVentanaVivaError`, y guarda operativos sin recálculo cableado (compat). 21/21 verde.
      (b) La lectura con pre-relleno ya está CUBIERTA por el spec dedicado
      `leer-ficha-operativa-prerelleno.use-case.spec.ts` (7 casos); el spec legado
      `leer-ficha-operativa.use-case.spec.ts` sigue representativo (guarda de acceso + no-muta)
      → sin cambios. (c) `confirmacion` (siembra): la siembra de la ficha NO toca aforo/duración
      (viven en RESERVA desde consulta); `confirmar-pago-senal.use-case.spec.ts` no se ve
      afectado → sin cambios. Suites verdes: ficha-evento guardado/lectura + confirmar-señal = 93/93.

## 7. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Capturar baseline de BD (RESERVA importes, PRESUPUESTO versiones, FACTURA liquidación).
- [x] 7.2 Ejecutar tests dirigidos de los módulos cambiados.
- [x] 7.3 Ejecutar la suite requerida (`pnpm test`); registrar totales/flaky (ver deuda conocida:
      us004-concurrency, finalizar-evento-integracion, react-pdf ESM).
- [x] 7.4 Ejecutar el test de INTEGRACIÓN por SQL real (sesión principal con Postgres); verificar
      que `importe_total`/`importe_liquidacion` los escribe el recálculo y `importe_senal` no
      cambia; restaurar BD.
- [x] 7.5 Report `openspec/changes/reserva-viva-edicion-recalculo-ficha/reports/2026-07-22-step-7-unit-test-and-db-verification.md`.
- [x] 7.6 Marcar completado solo tras verde + report.

## 8. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
  > QA completado. Bugs #1 y #2 encontrados, corregidos en commit 520de7a, re-verificados PASS.
- [x] 8.1 Levantar el backend (worktree: puertos alternos, EMAIL_SANDBOX, prisma generate).
- [x] 8.2 `GET /reservas/{id}/ficha-operativa`: verificar pre-relleno y campos estructurados.
- [x] 8.3 `PATCH` cambiando `duracionHoras`/desglose dentro de la ventana viva: verificar nuevo
      total, restante, nueva versión de presupuesto y liquidación regenerada; `importe_senal`
      intacto. Restaurar BD.
      RE-VERIFICADO 2026-07-22: `{"duracionHoras":8,"numAdultosNinosMayores4":35,"numNinosMenores4":5}`
      → 200 con `recalculo.nuevoTotal=1076.00`, `pagoInicial=360.80`, `liquidacionRestante=715.20`,
      `versionPresupuesto=2`. `importe_senal` invariante (360.80). BD restaurada. PASS.
- [x] 8.4 `PATCH` fuera de la ventana viva (ficha cerrada / liquidación cobrada): verificar 422.
- [x] 8.5 Caso `>50` invitados: verificar `tarifaAConsultar` y precio manual.
- [x] 8.6 Report `openspec/changes/reserva-viva-edicion-recalculo-ficha/reports/2026-07-22-step-8-curl-endpoint-tests.md`.

## 9. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
  > QA completado. Bugs #1 y #2 corregidos en commit 520de7a. Aviso recálculo visible en UI. PASS.
- [x] 9.1 Levantar frontend + backend; BD en estado conocido.
- [x] 9.2 Flujo: abrir ficha de una reserva confirmada → cambiar invitados/duración → verificar
      aviso de recálculo y nuevo restante en UI y persistencia en BD.
      RE-VERIFICADO 2026-07-22: cambiar duración 8h→4h → 200 OK (no 400) → UI muestra
      "Precio actualizado a 465,00 €. Pendiente de pago: 104,20 €. Pago inicial ya realizado: 360,80 €.
      Se ha regenerado el presupuesto y el borrador de factura de liquidación."
      Captura: e2e-screenshots/e2e-9-2-recalculo-aviso-1280.png. BD restaurada. PASS.
- [x] 9.3 Casos de error/validación (fuera de ventana, duración inválida, >50 precio manual).
- [x] 9.4 3 viewports (390 / 768 / 1280) sin overflow.
- [x] 9.5 Restaurar entorno/BD; mover capturas a `.../reports/e2e-screenshots/`.
- [x] 9.6 Report `openspec/changes/reserva-viva-edicion-recalculo-ficha/reports/2026-07-22-step-9-e2e-playwright.md`.

## 10. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [ ] 10.1 `docs/` afectada (er-diagram si aplica al soft-deprecate, use-cases/flujo de reserva
      viva, catálogo de emails E9). docs-keeper.

## 11. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 11.1 Ejecutar `code-reviewer` sobre el diff (hexagonal, bloqueo atómico intacto, no locks
      distribuidos, `importe_senal` no recalculado, guarda declarativa, read path completo).
- [ ] 11.2 Informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con línea `Veredicto: APTO`.

## 12. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)
- [ ] 12.1 Tras code-review APTO + validación manual, ESPERAR el OK humano antes de archive/PR.

## 13. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 13.1 `openspec archive reserva-viva-edicion-recalculo-ficha` (solo tras gate final y APTO;
      hook `require-code-review` bloquea sin informe APTO). Verificar una sola sección ADDED por
      requirement y que la carpeta de archive no duplica el prefijo de fecha.
- [ ] 13.2 Actualizar `openspec/specs/` y abrir PR (gh / GitHub MCP).
