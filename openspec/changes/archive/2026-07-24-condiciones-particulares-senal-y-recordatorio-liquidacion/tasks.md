# Tasks — condiciones-particulares-senal-y-recordatorio-liquidacion

> Change de OpenSpec. Pasos obligatorios de `openspec/config.yaml`, en orden. El agente
> DEBE ejecutar él mismo todas las pruebas (unit, curl, E2E); **nunca** delega en el
> usuario. Cada tarea se marca `[x]` **solo** tras ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Crear branch `feature/condiciones-particulares-senal-y-recordatorio-liquidacion` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [ ] 1.1 Presentar al humano `proposal.md` + spec-deltas (`presupuestos`, `facturacion`)
      y ESPERAR su OK explícito
- [ ] 1.2 **PARADA**: no avanzar a contrato/TDD/implementación hasta el OK del humano (se
      cumple aunque se diga "continúa", salvo renuncia explícita al gate)

## 2. Contrato OpenAPI + SDK (dueño: contract-engineer) — tras el gate SDD

- [ ] 2.1 Retirar la respuesta `409 CONDICIONES_NO_CONFIGURADAS` del endpoint de confirmar
      presupuesto en `docs/api-spec.yml` (verificar que no queda referenciada en otros paths)
- [ ] 2.2 `spectral lint docs/api-spec.yml` en verde
- [ ] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: tdd-engineer)

- [ ] 3.1 Actualizar (RED) `generar-presupuesto.use-case.spec.ts`: quitar la guarda
      `asegurarCondicionesConfiguradas` / `CondicionesNoConfiguradasError`; confirmar deja
      de fijar `cond_part_enviadas_fecha` / `cond_part_firmadas` y de pasar esos campos a
      `transicionarAPrereserva`
- [ ] 3.2 Actualizar (RED) `disparar-e2.adapter.spec.ts`: E2 adjunta solo el presupuesto;
      no invoca `GenerarPdfCondicionesPort`
- [ ] 3.3 Actualizar (RED) `activar-prereserva-*.spec.ts`: el puerto/adaptador
      `transicionarAPrereserva` ya no recibe `condPartEnviadasFecha` / `condPartFirmadas`
- [ ] 3.4 Nuevos RED en `enviar-factura-senal.use-case.spec.ts`: (a) con condiciones
      configuradas → adjunto `condiciones` + `fijarCondicionesEnviadas` dentro de la tx;
      (b) sin condiciones (`GenerarPdfCondicionesPort` → `null`) → envío igual, sin adjunto,
      sin fijar `cond_part_enviadas_fecha`, sin `409`
- [ ] 3.5 Nuevo RED de integración de `enviar-factura-senal` contra BD real (idioma es/ca,
      degradación, atomicidad E3)
- [ ] 3.6 Nuevos RED en `reenviar-e3` (`reenviar-e3.use-case.spec.ts` + adapter):
      regenera el PDF en blanco vía `GenerarPdfCondicionesPort` (no busca DOCUMENTO stale);
      degradación cuando devuelve `null`; fallo del proveedor no consolida nada
- [ ] 3.7 Nuevos RED en E4 (`enviar-factura-liquidacion.use-case.spec.ts`): con
      `cond_part_firmadas = false` → `recordarCondicionesPendientes = true`; con
      `cond_part_firmadas = true` → sin recordatorio
- [ ] 3.8 RED de catálogo de plantillas (`catalogo-plantillas.spec.ts`): E2 sin frase de
      condiciones; E3 con párrafo solo si `condicionesAdjuntas === true` (es/ca); E4 con
      recordatorio solo si `recordarCondicionesPendientes === true` (es/ca)
- [ ] 3.9 Confirmar que la suite dirigida está en **RED** por las razones esperadas

## 4. Backend: implementar (dueño: backend-developer) — revisar/ajustar tests unitarios (step-N)

- [ ] 4.1 A) Presupuesto/E2: `disparar-e2.adapter.ts` (quitar dep + bloque condiciones);
      `generar-presupuesto.use-case.ts` (quitar guarda, error, dep, campos a
      `transicionarAPrereserva`); `activar-prereserva-uow.prisma.adapter.ts` + puerto;
      `presupuestos.module.ts` (retirar wiring `GENERAR_PDF_CONDICIONES_PORT`);
      `generar-presupuesto.controller.ts` (quitar mapeo `409`); `catalogo-plantillas.ts`
      `renderE2`/`renderE2Ca`
- [ ] 4.2 B) Señal/E3: `enviar-factura-senal.use-case.ts` (dep `GenerarPdfCondicionesPort`,
      PDF pre-tx degradable, adjunto, repo `reservas.fijarCondicionesEnviadas` en tx solo si
      adjuntó, flag `condicionesAdjuntas`); `emision-email.adapter.ts` (`EnviarE3EmisionAdapter`);
      `catalogo-plantillas.ts` `renderE3`/`renderE3Ca`
- [ ] 4.3 B) Reenvío E3: `reenviar-e3.use-case.ts` + `ReenviarE3Adapter` (regenerar PDF en
      blanco; mantener `fijarCondicionesEnviadas`)
- [ ] 4.4 C) Liquidación/E4: `enviar-factura-liquidacion.use-case.ts`
      (`condPartFirmadas` en `ReservaLiquidacionEmision`, `recordarCondicionesPendientes`);
      `lecturas-emision.prisma.adapter.ts` (`select cond_part_firmadas`); `emision-email.adapter.ts`
      (`EnviarE4EmisionAdapter` + `ReenviarE4Adapter`); `catalogo-plantillas.ts`
      `renderE4`/`renderE4Ca`
- [ ] 4.5 E) Frontend: eliminar el manejo del `409 CONDICIONES_NO_CONFIGURADAS` en el flujo
      confirmar-presupuesto (verificar referencias reales; NO tocar el manejo de errores del
      reenvío E3). Sin UI nueva
- [ ] 4.6 Revisar/actualizar tests unitarios hasta ponerlos en verde

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [ ] 5.1 Capturar baseline de BD (RESERVA `cond_part_enviadas_fecha`/`cond_part_firmadas`,
      FACTURA, COMUNICACION E3/E4)
- [ ] 5.2 Ejecutar tests dirigidos de `presupuestos` y `facturacion`
- [ ] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
- [ ] 5.4 Verificar estado posterior de BD y restaurar si hace falta
- [ ] 5.5 Crear report `openspec/changes/condiciones-particulares-senal-y-recordatorio-liquidacion/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Levantar el backend (Postgres real; los subagentes no tienen BD — ejecutar desde
      la sesión principal)
- [ ] 6.2 Confirmar presupuesto de un tenant **sin** condiciones configuradas → ya **no**
      devuelve `409 CONDICIONES_NO_CONFIGURADAS`; verifica creación de PRESUPUESTO y
      transición a `pre_reserva`; restaurar BD
- [ ] 6.3 Enviar factura de señal (E3) con condiciones configuradas → adjunto `condiciones`
      + `RESERVA.cond_part_enviadas_fecha` fijado; restaurar BD
- [ ] 6.4 Enviar factura de señal (E3) sin condiciones configuradas → envío igual, sin
      adjunto, `cond_part_enviadas_fecha` sigue `NULL`; restaurar BD
- [ ] 6.5 Reenviar E3 → nueva COMUNICACION `es_reenvio = true`, PDF regenerado; restaurar BD
- [ ] 6.6 Enviar liquidación (E4) con `cond_part_firmadas = false` y con `= true` → verificar
      presencia/ausencia del párrafo recordatorio (sandbox de email); restaurar BD
- [ ] 6.7 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 7. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar frontend y backend con BD en estado conocido
- [ ] 7.2 Flujo confirmar presupuesto en un tenant sin condiciones: verificar que **no**
      aparece error de condiciones no configuradas y que la confirmación completa
- [ ] 7.3 Verificar que no hay regresión visible en el flujo de reenvío E3 (manejo de
      errores intacto)
- [ ] 7.4 Verificar persistencia y restaurar entorno/BD (mover capturas `e2e-*.png` a
      `reports/e2e-screenshots/`)
- [ ] 7.5 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: docs-keeper)

- [ ] 8.1 Actualizar `docs/` (comunicaciones E2/E3/E4, condiciones particulares) para
      reflejar condiciones en E3 (no E2), sin guarda dura, y recordatorio E4 condicional
- [ ] 8.2 Reflejar la eliminación del `409 CONDICIONES_NO_CONFIGURADAS` donde esté documentado

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO — dueño: code-reviewer)

- [ ] 9.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, dominio puro,
      arrow functions, degradación pre-tx, atomicidad E3, sin locks distribuidos)
- [ ] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con `Veredicto: APTO`

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [ ] 10.1 Tras code-review APTO + validación manual, ESPERAR el OK humano
- [ ] 10.2 **PARADA**: no archivar ni abrir PR sin el OK del humano

## 11. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: spec-author)

- [ ] 11.1 `openspec archive condiciones-particulares-senal-y-recordatorio-liquidacion`
      (verificar que el prefijo de fecha no se duplica; el hook `require-code-review` exige
      informe con `Veredicto: APTO`)
- [ ] 11.2 Actualizar `openspec/specs/` (lo hace `archive`) y abrir PR (solo tras gate final
      y APTO)
