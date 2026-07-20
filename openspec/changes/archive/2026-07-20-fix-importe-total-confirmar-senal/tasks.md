# Tasks — fix-importe-total-confirmar-senal

> Flujo del arnés SDD + TDD para un **bug fix** del backend. El agente DEBE
> ejecutar él mismo todas las pruebas (unit, curl; E2E si aplica); nunca las
> delega en el usuario. Marcar `[x]` solo tras ejecutar y verificar. Reports en
> `openspec/changes/fix-importe-total-confirmar-senal/reports/`.
>
> Alcance: **backend puro**. Al confirmar el pago de señal, leer el total del
> PRESUPUESTO vigente, congelarlo en `RESERVA.importe_total` y marcar el
> presupuesto como `aceptado`, dentro de la transacción existente. Endpoint, DTO,
> respuesta HTTP y contrato OpenAPI **no cambian**.

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Trabajo en el **worktree aislado** `worktree-fix-importe-total-confirmar-senal`
  (rama `worktree-fix-importe-total-confirmar-senal`; Step 0 satisfecho por el
  worktree, **no** se crea rama ni worktree nuevo).
- [x] 0.2 Confirmada la rama activa del worktree antes de cualquier escritura.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`confirmacion`) y
  **ESPERAR su OK explícito** antes de avanzar a TDD/implementación. **EL FLUJO SE
  DETIENE AQUÍ.**
- [ ] 1.2 Confirmar la decisión clave: la aceptación del presupuesto y el
  congelado de `importe_total` ocurren **al confirmar la señal** (no en US-014), y
  el presupuesto vigente es `MAX(version)` con `estado = 'enviado'`.

## 2. Contrato: verificación (contract-engineer — tras el gate)

- [ ] 2.1 **Verificar que el contrato OpenAPI NO cambia**: `POST
  /reservas/{id}/confirmar-senal`, su DTO multipart y su respuesta
  (`importeSenal`/`importeLiquidacion`) permanecen idénticos. No se regenera el
  SDK. (Cambio puramente de comportamiento interno; hook `validate-openapi` no
  aplica al no editar `docs/api-spec.yml`.)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 **Unit (happy path)**: test en rojo de `ConfirmarPagoSenalUseCase` — al
  confirmar con un PRESUPUESTO vigente (`MAX(version)`, `estado='enviado'`,
  `total=3.000`), la RESERVA queda con `importe_total = 3.000` congelado, el
  presupuesto pasa a `estado='aceptado'` e `importe_senal=1.200`/
  `importe_liquidacion=1.800` (pct_senal 40). (Unit: proyección
  `presupuestoVigente`, `confirmarSenal({ importeTotal })`, `presupuestos.aceptar`.)
- [x] 3.2 **Unit (varias versiones)**: cubierto por integración (`MAX(version)`):
  con `version=1` (3.000, rechazado) y `version=2` (3.500, enviado), se congela el
  `total` de la vigente (3.500) y se acepta la `version=2`. En unit, `cargarReserva`
  proyecta directamente el vigente en `presupuestoVigente`.
- [x] 3.3 **Unit (rechazo 422)**: test en rojo — sin PRESUPUESTO en `enviado`
  (`presupuestoVigente=null`) o `total ≤ 0`, lanza `ImporteTotalInvalidoError` → 422
  `IMPORTE_TOTAL_INVALIDO` **sin efectos** (`uow.ejecutar` no llamado,
  `confirmarSenal`/`presupuestos.aceptar` no llamados).
- [x] 3.4 **Unit (pct derivado)**: test en rojo — `pct_senal=50` sobre `total=2.000`
  → `importe_senal=1.000`/`importe_liquidacion=1.000`.
- [x] 3.5 **Concurrencia**: test en rojo (escrito) — double-click / confirmación
  concurrente: solo una transacción congela el importe y acepta el presupuesto; la
  segunda detecta `reserva_confirmada` y no re-congela ni re-acepta. Usa BD real /
  `SELECT ... FOR UPDATE`; **RED se verifica desde la sesión principal con Postgres**
  (MEMORY "subagentes sin Docker/Postgres").
- [x] 3.6 Confirmar que la suite está en **rojo** por las razones esperadas. Unit
  spec verificado en ROJO: `Test suite failed to run` (TS2353 — `presupuestoVigente`
  no existe en `ReservaConfirmacion`, `importeTotal` no existe en
  `ConfirmarSenalReservaParams`, `presupuestos` no existe en
  `RepositoriosConfirmacion`). Integración/concurrencia (Postgres) pendientes de la
  sesión principal — el RED real del bug (importe_total nunca poblado → 422;
  presupuesto nunca aceptado) solo se reproduce contra BD real.

## 4. Backend: implementar + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)

- [ ] 4.1 En la transacción de `ConfirmarPagoSenalUseCase.ejecutar()` (y su
  puerto/UoW `confirmar-pago-senal-uow.prisma.adapter` / repositorio de
  presupuesto): (a) leer el PRESUPUESTO vigente (`MAX(version)`, `estado='enviado'`)
  de la reserva; (b) `validarImporteTotal` valida `presupuesto.total > 0`
  (dejando de leer `RESERVA.importe_total`); (c) congelar
  `RESERVA.importe_total = presupuesto.total`; (d) marcar ese presupuesto
  `estado='aceptado'`. Todo dentro de la transacción atómica existente y bajo RLS
  del tenant.
- [ ] 4.2 Verificar que el cálculo de `importe_senal`/`importe_liquidacion` usa el
  `importe_total` recién congelado (derivado de `TENANT_SETTINGS.pct_senal`, sin
  hardcodear), y que la respuesta HTTP sigue devolviendo los mismos campos.
- [ ] 4.3 Dominio no importa de infra (hook `no-infra-in-domain`); bloqueo atómico
  intacto (hook `no-distributed-lock`); arrow functions; sin tocar el contrato ni
  el SDK.
- [ ] 4.4 Revisar/actualizar tests unitarios existentes afectados (los que
  mockeaban `importe_total` prefijado o esperaban 422); dejar la suite en verde.

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [ ] 5.1 Capturar baseline de BD (RESERVA `importe_total`/`importe_senal`/
  `importe_liquidacion`, PRESUPUESTO `estado`, FECHA_BLOQUEADA, FICHA_OPERATIVA
  del tenant de prueba).
- [ ] 5.2 Ejecutar los tests dirigidos del módulo `confirmacion` (incl.
  concurrencia + idempotencia con **Postgres real**; el bug solo se reproduce
  contra BD real — MEMORY "backend nunca probado contra BD real").
- [ ] 5.3 Ejecutar la suite requerida (`pnpm test`); documentar flaky
  pre-existentes ajenos (US-004 deadlock 40P01, react-pdf ESM,
  finalizar-evento-integracion) si aparecen.
- [ ] 5.4 Verificar estado posterior de BD (`importe_total` congelado, presupuesto
  `aceptado`) y restaurar si hace falta.
- [ ] 5.5 Crear report `reports/YYYY-MM-DD-step-5-unit-test-and-db-verification.md`.
- [ ] 5.6 Marcar completado solo tras tests en verde y report creado.

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Levantar el backend y verificar conexión a BD (tenant piloto con
  presupuesto `enviado` vigente).
- [ ] 6.2 `POST /reservas/{id}/confirmar-senal` con justificante válido sobre una
  reserva en `pre_reserva` con presupuesto vigente `enviado` → **200/201**
  (deja de ser 422); verificar en BD: `RESERVA.importe_total = presupuesto.total`,
  `importe_senal`/`importe_liquidacion` correctos, PRESUPUESTO vigente
  `estado='aceptado'`, RESERVA `reserva_confirmada`, FECHA_BLOQUEADA firme.
  Restaurar BD.
- [ ] 6.3 `POST /reservas/{id}/confirmar-senal` sobre una reserva **sin**
  presupuesto vigente `enviado` → **422 `IMPORTE_TOTAL_INVALIDO`** sin efectos
  (RESERVA intacta, presupuesto sin marcar). Restaurar BD.
- [ ] 6.4 **Regresión de facturación acoplada**: verificar que, tras confirmar,
  la generación post-commit de la factura (US-022) encuentra
  `PRESUPUESTO(estado='aceptado')` y toma su número/régimen (no cae en el fallback
  "CON IVA por defecto"). Restaurar BD.
- [ ] 6.5 Crear report `reports/YYYY-MM-DD-step-6-curl-endpoint-tests.md`.

## 7. QA: E2E con Playwright MCP (OBLIGATORIO si hay UI — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar frontend + backend, BD en estado conocido (reserva en
  `pre_reserva` con presupuesto vigente `enviado`).
- [ ] 7.2 Desde la ficha de la reserva, pulsar "Confirmar pago de señal", adjuntar
  un justificante válido y confirmar → la reserva pasa a `reserva_confirmada`
  **sin error 422** y la UI muestra los importes de señal/liquidación.
- [ ] 7.3 Verificado en 3 viewports (390 / 768 / 1280), sin overflow horizontal
  (aunque este change no toca la UI, se valida que el flujo antes roto ahora
  funciona de punta a punta).
- [ ] 7.4 Entorno y BD restaurados; capturas en `reports/e2e-screenshots/`
  (mover los `e2e-*.png` de la raíz — MEMORY "qa-verifier deja capturas en la raíz").
- [ ] 7.5 Crear report `reports/YYYY-MM-DD-step-7-e2e-playwright.md`.

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [ ] 8.1 Actualizar `docs/` afectada: `use-cases` (UC-17: al confirmar se acepta
  el presupuesto vigente y se congela `importe_total`), `er-diagram` (aclarar que
  `RESERVA.importe_total` se puebla **al confirmar la señal**, no en `pre_reserva`;
  el presupuesto pasa a `aceptado` en UC-17, no en UC-14). `api-spec` **no** cambia.

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [ ] 9.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal/dominio sin
  infra, bloqueo atómico no tocado, transacción atómica e idempotencia de la
  confirmación intactas, contrato/SDK sin cambios, `max-lines`, arrow functions).
- [ ] 9.2 Informe `reports/YYYY-MM-DD-step-review-code-review.md` con línea literal
  `Veredicto: APTO` (el hook `require-code-review` lo exige para archivar/PR).

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [ ] 10.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano**
  antes de archive/PR. **EL FLUJO SE DETIENE AQUÍ.**

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 11.1 `openspec archive fix-importe-total-confirmar-senal` (aplica: MODIFIED
  `confirmacion` x1). Verificar que archive añade la fecha al slug (el slug se creó
  **sin** prefijo de fecha para no duplicarla).
- [ ] 11.2 Verificar `openspec/specs/confirmacion/spec.md` actualizado por
  `archive`; abrir PR contra `master` (GitHub MCP o `gh`).
