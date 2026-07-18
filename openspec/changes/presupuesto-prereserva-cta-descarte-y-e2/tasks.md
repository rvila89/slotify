# Tasks — presupuesto-prereserva-cta-descarte-y-e2

> Change no-US con tres workstreams: **A** (CTA verde, solo frontend), **B** (descartar
> pre-reserva, slice vertical), **C** (cablear E2, backend + depuración). Los pasos siguen los
> `mandatory_steps` de `openspec/config.yaml`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E) y no delega en el usuario. Los reports van a
> `openspec/changes/presupuesto-prereserva-cta-descarte-y-e2/reports/`.
>
> Nota de identidad: la **carpeta del change** es `presupuesto-prereserva-cta-descarte-y-e2`;
> la **branch** es `feature/presupuesto-prereserva-cta-descarte-e2` (decisión explícita del
> change).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Crear branch `feature/presupuesto-prereserva-cta-descarte-e2` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [ ] 1.1 Presentar al humano `proposal.md` + `spec-delta.md` (+ `specs/*/spec.md`) + `design.md`
      y ESPERAR su OK explícito antes de implementar
- [x] 1.2 Decisiones del Gate **CERRADAS por el humano** (2 anulan la recomendación): **D-1** =
      **REQUERIDO** (`adjuntosRequeridos: ['presupuesto']`; el fix garantiza entrega CON adjunto —
      anula "opcional"); **D-2** = **REUTILIZAR `POST /reservas/{id}/descartar`** con despacho por
      fase, contrato MODIFICADO (anula el endpoint dedicado); **D-3** = **SÍ** (verde también en el
      botón del diálogo `ConfirmarSenalDialog`; coincide)

## 2. Contrato OpenAPI + SDK (OBLIGATORIO para workstream B — contract-engineer)

- [ ] 2.1 **MODIFICAR la operación `descartar` existente** en `docs/api-spec.yml` (D-2 CERRADA =
      reutilizar): ampliar su semántica y responses para cubrir el descarte de `pre_reserva`
      (200/404/409/422) **sin romper** el contrato de US-013. NO añadir una operación
      `descartarPreReserva`. El body `{ motivo?: string }` ya existe; se conserva
- [ ] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml` / hook `validate-openapi`) y
      comprobar que el cambio es retrocompatible con US-013 (misma ruta/verbo/body)
- [ ] 2.3 Regenerar el SDK del frontend (nunca a mano; dueño `contract-engineer`) y verificar
      que compila; la firma de `descartar` no cambia (cambia la semántica), el frontend de
      `AccionDescartarPreReserva` reutiliza esa misma operación
- [ ] 2.4 Workstreams A y C NO tocan contrato (marcar N/A)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — tdd-engineer)

- [ ] 3.1 **B/máquina de estados**: tests de la guarda declarativa
      `esOrigenValidoParaDescartarPreReserva` en `maquina-estados.spec.ts` (único origen
      `pre_reserva`; el resto de estados y terminales → inválidos) — en rojo
- [ ] 3.2 **B/concurrencia del bloqueo**: tests de la UoW atómica del descarte (transición +
      `liberarFecha()` + promoción de cola exactamente-una-vez + rollback total; doble descarte
      concurrente → 1 aplica, el otro 409) — en rojo. Ejecutar desde la sesión principal con
      Postgres real (los subagentes QA no tienen BD).
- [ ] 3.3 **B/use-case + controller**: tests del caso de uso y del mapeo de errores
      (422 origen inválido / 409 terminal-carrera / 404 no encontrada) y del `AUDIT_LOG` con
      motivo opcional — en rojo
- [ ] 3.4 **C/E2**: tests de la plantilla E2 activa (`renderE2`, `variablesRequeridas`,
      `adjuntosRequeridos: ['presupuesto']`) y del disparo con adjunto **REQUERIDO** (D-1): con
      `pdfUrl` disponible y alcanzable → E2 se envía CON el presupuesto adjunto (path local ⇒
      `content` Buffer); sin `pdfUrl` / no alcanzable → E2 **NO** se envía sin adjunto (bloqueo
      observable, reintentable por idempotencia) — en rojo. Cubrir también el orden
      PDF-antes-de-E2 (`pdfUrl` no-nulo al motor)
- [ ] 3.5 **A/frontend**: tests de `AccionesPreReserva` (orden: confirmar primero; clase verde
      `accent-success` en confirmar; `brand-primary` en editar) y de `puedeDescartarPreReserva`
      — en rojo

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [ ] 4.1 **B**: revisar tests de `maquina-estados` y de descarte de consulta (US-013) para
      reutilizar patrones sin duplicar cobertura
- [ ] 4.2 **C**: revisar tests del catálogo de plantillas y del `DispararE2Adapter` (US-014) y
      del motor de email (US-045); ajustar los que asumían E2 inactiva
- [ ] 4.3 Implementar el mínimo para poner en verde (GREEN): guarda + use-case de pre-reserva +
      UoW adapter + **use-case orquestador que despacha `descartar` por fase** + extensión del
      controller `descartar` existente (B); `renderE2` + `PLANTILLA_E2_ES` con
      `adjuntosRequeridos: ['presupuesto']` + retirar `'E2'` de `CODIGOS_DIFERIDOS` + garantizar
      `pdfUrl` no-nulo y adjunto entregado (C); reorden + clases verdes (A)

## 5. Depuración sistemática del `fallido` de E2 (OBLIGATORIO para workstream C — systematic-debugging — RUTA CRÍTICA)

- [ ] 5.1 Reproducir el disparo de E2 con PDF disponible y con PDF ausente/no-alcanzable, y
      observar la `COMUNICACION` resultante y los logs del adaptador Resend (NO asumir la causa)
- [ ] 5.2 Confirmar la causa raíz del `fallido` (hipótesis: `readFileSync` lanza si el path
      local no existe; URL no alcanzable por Resend → error; o `pdfUrl` llega `null` al disparo)
      antes de cerrar el punto
- [ ] 5.3 Aplicar la corrección coherente con **D-1 (adjunto REQUERIDO)**: el fix debe conseguir
      que el presupuesto se **ENVÍE DE VERDAD**, NO omitir/degradar el adjunto. Garantizar en
      `generar-presupuesto.use-case.ts` que el PDF está generado/persistido y `pdfUrl` no-nulo
      ANTES/EN el disparo E2; en `resend.email.adapter.ts` que el path local viaja como `content`
      Buffer y la URL es alcanzable; y en `disparar-e2.adapter.ts` que un `pdfUrl` faltante hace
      el bloqueo/fallo **observable** (reintentable por idempotencia), no un envío silencioso sin
      adjunto

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Capturar baseline de BD de las entidades impactadas (`RESERVA`, `FECHA_BLOQUEADA`,
      cola `2.d`, `COMUNICACION` E2, `AUDIT_LOG`)
- [ ] 6.2 Ejecutar los tests dirigidos de los módulos cambiados (reservas/descarte, comunicaciones/E2,
      frontend/acciones)
- [ ] 6.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky (los tests de
      concurrencia se lanzan desde la sesión principal con Postgres real)
- [ ] 6.4 Verificar el estado posterior de BD y restaurar si hubo mutación no deseada
- [ ] 6.5 Crear report
      `openspec/changes/presupuesto-prereserva-cta-descarte-y-e2/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar el backend y verificar conexión a BD; anotar estado previo
- [ ] 7.2 **B**: `POST /reservas/{id}/descartar` (endpoint REUTILIZADO) sobre una `pre_reserva`
      con cola → 200, verificar `reserva_cancelada`, `FECHA_BLOQUEADA` liberada, primero de cola
      promovido y `AUDIT_LOG` (con y sin `motivo`). Verificar además que el MISMO endpoint sobre
      una `consulta` sigue haciendo el descarte US-013 (→ `2z`) sin regresión. **Restaurar BD**.
- [ ] 7.3 **B/errores**: `POST /reservas/{id}/descartar` desde `reserva_confirmada`/posteriores →
      422; segundo descarte de una ya `reserva_cancelada` → 409; id inexistente/otro tenant → 404
- [ ] 7.4 **C**: disparar la generación de presupuesto (activar pre_reserva) y verificar que la
      `COMUNICACION` E2 queda `enviado` **CON el presupuesto adjunto** (adjunto REQUERIDO, D-1);
      comprobar que con PDF disponible el adjunto llega (path local ⇒ Buffer) y que sin PDF el E2
      NO se envía sin adjunto (bloqueo observable, reintentable), en modo sandbox. **Restaurar
      BD**.
- [ ] 7.5 Verificar que el formato de error coincide con el contrato OpenAPI
- [ ] 7.6 Crear report
      `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [ ] 8.1 Levantar frontend y backend con BD en estado conocido; comprobar tools de Playwright MCP
- [ ] 8.2 **A**: abrir la ficha de una `pre_reserva`; verificar que "Confirmar pago de señal" es
      el primer botón y es verde, "Editar presupuesto" debajo (secundario), y el botón del
      diálogo `ConfirmarSenalDialog` es verde (D-3)
- [ ] 8.3 **B**: ejecutar el flujo "Descartar pre-reserva" (con y sin motivo) desde la ficha;
      verificar el diálogo, la mutación y el resultado en la UI (reserva cancelada)
- [ ] 8.4 Probar escenarios de error/validación (acción no visible fuera de `pre_reserva`)
- [ ] 8.5 Verificar persistencia (BD coincide con la UI) y responsividad en 390/768/1280
- [ ] 8.6 Restaurar entorno y estado de BD; mover capturas `e2e-*.png` a
      `reports/e2e-screenshots/`
- [ ] 8.7 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — docs-keeper)

- [ ] 9.1 Actualizar `docs/use-cases.md` / `docs/er-diagram.md` si procede (nueva transición
      manual `pre_reserva → reserva_cancelada`, AUDIT_LOG de descarte)
- [ ] 9.2 Actualizar cualquier documentación de comunicaciones que listara E2 como diferida
- [ ] 9.3 Verificar que las Purpose de las specs vivas afectadas quedan coherentes tras archive

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal, bloqueo
      atómico, máquina de estados declarativa, RLS, guardrail frontend `lib/`, cliente generado
      no editado a mano, responsive)
- [ ] 10.2 Dejar informe
      `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal `Veredicto: APTO`
      (si NO APTO, volver a implementación y repetir)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 11.1 Tras code-review APTO + validación manual, presentar el resumen y ESPERAR el OK
      humano antes de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — spec-author)

- [ ] 12.1 `openspec archive presupuesto-prereserva-cta-descarte-y-e2` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin informe APTO)
- [ ] 12.2 Actualizar `openspec/specs/` con los deltas aplicados y verificar el conteo de
      secciones ADDED/MODIFIED (una sola sección por operación)
- [ ] 12.3 Abrir PR (GitHub MCP o `gh`) desde `feature/presupuesto-prereserva-cta-descarte-e2`
