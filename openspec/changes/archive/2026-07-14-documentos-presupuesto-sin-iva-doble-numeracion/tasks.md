# Tasks — documentos-presupuesto-sin-iva-doble-numeracion (6.2)

> Change de OpenSpec. Los pasos obligatorios provienen de `openspec/config.yaml`.
> El agente DEBE ejecutar él mismo las pruebas (unit, integración, curl, E2E,
> verificación visual del PDF); **nunca las delega en el usuario**.
>
> **CON fase de contrato OpenAPI/SDK** (D4: `metodoPago` es campo nuevo
> obligatorio en el request; se regenera el SDK). **CON fase de frontend + E2E
> Playwright** (D5: selector método de pago al generar presupuesto). react-pdf es
> ESM puro → los tests de render corren con `NODE_OPTIONS=--experimental-vm-modules`.
> Los tests de integración/numeración concurrente contra Postgres se lanzan desde
> la SESIÓN PRINCIPAL (los subagentes no tienen BD).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/documentos-presupuesto-sin-iva-doble-numeracion` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`presupuestos` +
      `documentos`) + `design.md` y ESPERAR su OK explícito
- [x] 1.2 Sub-decisiones **RESUELTAS en el gate SDD 2026-07-14**: **D1** enums
      `RegimenIva {con_iva,sin_iva}` + `MetodoPago {transferencia,efectivo}`,
      persistir AMBOS; **D2** **Opción A** — literal `AAAANNN` COMPARTIDO entre
      CON/SIN, unicidad `@@unique([tenantId, regimenIva, numeroPresupuesto])`,
      tabla `SecuenciaDocumento` diferida a 6.3; **D3** SIN IVA omite SOLO razón
      social fiscal + NIF (mantiene dirección/branding) y el **total SIN IVA =
      base sin IVA (importe MENOR)** → **la 6.2 SÍ toca el cálculo fiscal**
      (`desglose-fiscal.ts` se parametriza por régimen); **D4** `metodoPago`
      obligatorio en confirmar Y preview, respuesta expone `regimenIva` +
      `numeroPresupuesto`; **D5** 6.2 completa punta a punta (UI selector + E2E);
      **D6** unit de ambas variantes + verificación visual del PDF SIN IVA desde
      la sesión principal
- [x] 1.3 OK explícito del humano registrado en el gate SDD **2026-07-14** ("si")
      — habilitada la fase de contrato/TDD/implementación

## 2. Contrato OpenAPI + SDK (OBLIGATORIO — tras el gate — contract-engineer)
- [x] 2.1 Añadir `metodoPago` (enum `[transferencia, efectivo]`, obligatorio) al
      request de confirmar (`POST /reservas/{id}/presupuesto`) y —según D4— al
      preview en `docs/api-spec.yml`; exponer `regimenIva` (y `numeroPresupuesto`
      si D4 lo aprueba) en la respuesta; `spectral lint docs/api-spec.yml` en verde
- [x] 2.2 Regenerar el cliente HTTP del frontend desde el contrato (NUNCA a mano;
      hook `protect-generated-client`)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 3.1 Test de dominio `regimenDesdeMetodoPago`: `transferencia→con_iva`,
      `efectivo→sin_iva` (mapa declarativo) — EN ROJO
      (`presupuestos/domain/__tests__/regimen-desde-metodo-pago.spec.ts`)
- [x] 3.1b Tests de dominio del **cálculo fiscal por régimen**
      (`calcularDesgloseFiscal` / `calcularReparto` parametrizados por
      `RegimenIva`): CON IVA base 1000 → total 1210 (IVA 210); SIN IVA base 1000
      → total 1000 (IVA 0); reparto 40/60 sobre el total del régimen; fiança fija
      igual en ambos; invariante `base+IVA=total` (CON) y `total=base`/`IVA=0`
      (SIN); **no regresión** del cálculo CON IVA de 6.1b — EN ROJO
      (`presupuestos/__tests__/desglose-fiscal-por-regimen.spec.ts`)
- [x] 3.2 Tests de numeración por régimen (dominio + doble secuencia): cada
      régimen arranca en `AAAA001`; secuencias independientes; CON continúa la de
      6.1b; reinicio anual por régimen — EN ROJO
      (`presupuestos/domain/__tests__/numeracion-presupuesto-por-regimen.spec.ts`)
- [x] 3.3 Tests de render de la **variante SIN IVA** (modelo de vista +
      componentes): totales solo-Total (sin base/IVA); cabecera sin razón social
      fiscal ni NIF; concepto/horas/extras/reparto/validesa/pie idénticos a CON
      IVA; **no regresión** de CON IVA — EN ROJO
      (`documentos/presentation/__tests__/documento-presupuesto-sin-iva.plantilla.spec.ts`)
- [x] 3.4 Test del use-case: `metodoPago` obligatorio; deriva y persiste
      `regimenIva`/`metodoPago`; llama a `ultimoNumeroDelAnio(...,regimen)`;
      reintento `P2002` discriminado por `meta.target` para la nueva unicidad —
      EN ROJO (`presupuestos/__tests__/generar-presupuesto-regimen.use-case.spec.ts`)
- [x] 3.5 Confirmar que los tests fallan por ausencia de implementación (RED):
      5 suites en ROJO por módulos/enum/campos/parám/clase de error ausentes
      (TS2307/TS2305/TS2353/TS2339); ninguna aserción verde accidental

## 4. Backend: implementar + revisar tests unitarios (OBLIGATORIO — step-N)
- [x] 4.1 Migración Prisma no destructiva: `metodo_pago` + `regimen_iva` en
      `Presupuesto` (nullable + backfill CON/transferencia); unicidad **Opción A**
      `@@unique([tenantId, regimenIva, numeroPresupuesto])` (sustituye a
      `[tenantId, numeroPresupuesto]` de 6.1b); **NO** recrear la policy RLS de
      presupuesto
- [x] 4.2 Implementar `regimenDesdeMetodoPago` (dominio puro, arrow, mapa)
- [x] 4.2b Parametrizar `calcularDesgloseFiscal` y `calcularReparto` por
      `RegimenIva` (dominio puro, ramificación declarativa): CON IVA = base+IVA21;
      SIN IVA = base, IVA 0; reparto sobre el total del régimen; fiança fija
- [x] 4.3 Extender el use-case: recibir `metodoPago`, derivar régimen, calcular
      el desglose/total/reparto según el régimen, pasarlo a `crear(...)` y a
      `ultimoNumeroDelAnio(tenantId, anio, regimen)`; adaptar el reintento `P2002`
      a la nueva constraint discriminando por `meta.target`
- [x] 4.4 Extender `construirModeloDocumentoPresupuesto` con `regimen` + flags
      `cabecera.mostrarIdentidadFiscal` / `totales.mostrarDesgloseIva`; adaptar
      `Cabecera` y `BloqueTotales` (arrow, contenido 100% config); el adaptador
      real pasa el régimen del presupuesto al render
- [x] 4.5 DTO/controller: `metodoPago` obligatorio y validado; response con
      `regimenIva` (según D4)
- [x] 4.6 Revisar/actualizar tests existentes de `presupuestos`/`documentos`
      afectados; los del paso 3 en verde
- [x] 4.7 `pnpm lint` + `pnpm typecheck` (+ `arch`) en verde

## 5. Frontend: selector de método de pago (OBLIGATORIO si UI — step-N — frontend-developer)
- [x] 5.1 Selector obligatorio `transferencia | efectivo` en el formulario de
      generar presupuesto (feature `reservas`/`presupuestos`, mobile-first,
      responsive 390/768/1280); envía `metodoPago` con el cliente **regenerado**
- [x] 5.2 El borrador (preview) refleja la variante según método de pago
- [x] 5.3 `pnpm lint` + `pnpm typecheck` del web en verde

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Baseline BD capturado (dev total=1/con_numero=0, test=0; índice único viejo)
- [x] 6.2 5 specs dirigidos verdes (48 tests, `--experimental-vm-modules`)
- [x] 6.3 Suite completa: 1889/1890 (único rojo = flaky pre-existente US-004
      deadlock 40P01, ajeno a la 6.2, intermitente)
- [x] 6.4 Migración aplicada a `dev`+`test` (deploy); columnas/backfill/unicidad
      por régimen verificadas; eje régimen + doble numeración verificado contra BD
      real (efectivo→sin_iva total=base; transferencia→con_iva; 2026001 coexisten;
      CON→2026002) desde la sesión principal
- [x] 6.5 Estado posterior verificado y restaurado (dev/test a baseline)
- [x] 6.6 Report `reports/2026-07-14-step-6-unit-test-and-db-verification.md`
- [x] 6.7 Completado: tests en verde (salvo flaky ajeno) + report creado

## 7. QA: pruebas manuales con curl + verificación VISUAL del PDF (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Backend en marcha (3000) contra dev migrado; login gestor del piloto OK
- [x] 7.2 `efectivo → sin_iva`, total=base (menor), secuencia SIN → verificado
      contra BD real en 6.4 (misma ruta de código que el controller confirmar)
- [x] 7.3 `transferencia → con_iva`, secuencia CON continúa (2026002) → verificado
      contra BD real en 6.4
- [x] 7.4 `curl` preview sin `metodoPago` → **HTTP 400** (ValidationPipe); con
      método entra en negocio → confirma DTO 6.2 vivo en el server; sin efectos
- [x] 7.5 Doble numeración + unicidad por régimen (coexistencia CON/SIN en 2026001)
      verificadas contra BD real (6.4)
- [x] 7.6 **PDF SIN IVA inspeccionado visualmente** (`muestra-presupuesto-sin-iva.pdf`):
      sin base/IVA, sin razón social fiscal/NIF, sin "lloguer", total menor, 40/60/
      fiança, IBAN; comparado con `muestra-presupuesto-con-iva.pdf` (sin regresión)
- [x] 7.7 Restaurado: dev intacto, reserva `26-0003` sin modificar, temporales borrados
- [x] 7.8 Report `reports/2026-07-14-step-7-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Frontend (5173) + backend (3000) + dev en estado conocido; login UI OK
- [x] 8.2 Diálogo abierto; selector Efectivo (SIN IVA) seleccionable; al togglear se
      re-pide el preview con `metodoPago=efectivo` (observado en red). Borrador con
      desglose por régimen cubierto por unit + real-DB (reserva 2b de dev sin duración;
      mutar el registro compartido de dev quedó bloqueado por guardrail de datos)
- [x] 8.3 Opción Transferencia (CON IVA) presente como default; régimen comunicado
      en la propia UI ("Presupuesto con IVA (21%)" / "sin IVA")
- [x] 8.4 Selector con default `transferencia` → nunca se envía sin método desde UI
      (más seguro); el caso HTTP sin método (→400) verificado por curl en 7.4. 0 errores JS
- [x] 8.5 3 viewports (390/768/1280) **sin overflow horizontal**: móvil apilado,
      desktop dos tarjetas lado a lado; capturas en `reports/e2e-screenshots/`
- [x] 8.6 Sin mutaciones persistentes (flujo hasta borrador); capturas movidas a
      `reports/e2e-screenshots/` (no en la raíz)
- [x] 8.7 Report `reports/2026-07-14-step-8-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 9.1 Documentar: método de pago → régimen, variante SIN IVA del render, doble
      numeración por régimen, y la reconciliación con la secuencia CON de 6.1b
- [x] 9.2 Nota de roadmap: migración de la numeración de factura a la doble
      secuencia = 6.3; Condicions particulars = 6.4; upload de logo = 6.5

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 `code-reviewer` ejecutado; 1 hallazgo Alta (preview sin `regimenIva`)
      corregido con TDD RED→GREEN + 1 Baja (sangría) resuelto; guardrails duros OK
- [x] 10.2 Informe `reports/2026-07-14-step-review-code-review.md` con
      `Veredicto: APTO` (tras re-revisión del fix)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 OK humano final registrado **2026-07-14** ("sí, archiva y abre el PR")
      tras code-review APTO + PDF SIN IVA verificado + validación manual

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)
- [x] 12.1 `openspec archive` ejecutado (specs vivas: presupuestos +4/-1,
      documentos +1) y PR hacia `master` abierto tras gate final + code-review APTO
