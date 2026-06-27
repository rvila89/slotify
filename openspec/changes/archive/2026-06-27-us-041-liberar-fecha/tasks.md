# Tasks — us-041-liberar-fecha

Trazabilidad: **US-041 / UC-31** (liberación atómica de fecha; dolores D4/D13; automatizaciones
A4/A5/A21; invocada por US-012/US-013/US-011/US-019 y cancelación; dispara US-018). Pasos
obligatorios según `openspec/config.yaml` (11 pasos), en orden. Marcar `[x]` SOLO tras ejecutar
y verificar. **El agente ejecuta las pruebas; nunca se delegan al usuario.**

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO) — `spec-author`

- [x] 0.1 Crear y cambiar a `feature/us-041-liberar-fecha` desde `master` (YA HECHO; rama actual).
- [x] 0.2 Verificar la rama actual.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA) — humano

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/bloqueo-fecha/spec.md`) +
      `design.md` y **ESPERAR su OK explícito**. Resaltar especialmente:
      - **D-2 (gate #1)**: promoción de cola como `PromocionColaPort` con stub no-op +
        invocación post-commit inmediato.
      - **D-9 (gate #2)**: alcance = `liberarFecha()` + caso de uso de **liberación en lote**;
        **diferir** el cron/endpoint protegido + scheduler a la US de jobs / US-012.
      - **D-1/D-3/D-4**: DELETE serializado + rows-affected como primitiva exactamente-una-vez.
      - **D-7**: NO se expone endpoint HTTP propio (no se toca `docs/api-spec.yml`).
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin aprobación, aunque se diga "continúa".

## 2. Contrato OpenAPI (frontera back↔front) — `contract-engineer`

- [ ] 2.1 Confirmar la decisión D-7: **`liberarFecha()` NO expone endpoint HTTP propio**
      (operación interna de dominio; actor de UC-31 = Sistema). **No se edita `docs/api-spec.yml`**.
      Dejar constancia de la decisión.
- [ ] 2.2 Si el gate (D-9) decidiera incluir el endpoint protegido de barrido aquí, reabrir el
      contrato; en caso contrario, se difiere a la US de jobs / US-012 (fuera de alcance aquí).

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — ZONA CRÍTICA) — `tdd-engineer`

- [x] 3.1 **Concurrencia primero** (núcleo crítico, BD real): dos liberaciones simultáneas sobre
      la misma `(tenant_id, fecha)` → exactamente 1 DELETE (1 row affected) + 1 no-op (0 filas, sin
      error); la promoción (`PromocionColaPort`) se invoca **exactamente una vez** (no doble).
      → `src/reservas/__tests__/liberar-fecha-integracion.spec.ts`.
- [x] 3.2 Race liberación vs nuevo bloqueo: la liberación completa primero (DELETE + posible
      promoción) y el nuevo bloqueo hace INSERT o entra en cola; nunca `(T, D)` doble-bloqueada.
      → `liberar-fecha-integracion.spec.ts` (BD real).
- [x] 3.3 Idempotencia: DELETE con 0 filas = éxito silencioso (sin excepción); registra tentativa
      en `AUDIT_LOG`; no dispara promoción. → dominio + integración.
- [x] 3.4 Guarda del bloqueo firme: firme de reserva en `reserva_confirmada` → rechazo, fila
      intacta, intento auditado; firme de reserva en `reserva_cancelada` → liberación permitida.
      → `src/reservas/__tests__/liberar-fecha.service.spec.ts` (dominio puro, mocks de puertos).
- [x] 3.5 Disparo del seam de promoción: con cola activa (`2.d` apuntando a la liberada) → invoca
      `PromocionColaPort` una vez; sin cola → no lo invoca. → dominio (mock del puerto).
- [x] 3.6 Liberación en lote con fallo aislado: N fechas, una falla → las demás se liberan en
      transacciones independientes; cada éxito dispara promoción si corresponde.
      → `liberar-fecha-integracion.spec.ts` (BD real).
- [x] 3.7 No-mutación de la RESERVA: tras liberar, `estado`/`sub_estado` de la reserva intactos.
- [x] 3.8 AUDIT_LOG: liberación exitosa registra `accion='eliminar'`, `entidad='FECHA_BLOQUEADA'`
      y la causa (TTL/descarte/cancelación).
- [x] 3.9 Confirmar que toda la batería está en ROJO antes de implementar (hook
      `require-tests-first`). Restaurar la BD al baseline tras la ejecución.

## 4. Implementación backend (hexagonal) — `backend-developer`

- [x] 4.1 Dominio puro: servicio `liberarFecha()` en `src/reservas/domain/` + guarda firme
      declarativa (D-5) + errores de dominio tipados en español; sin imports de infra/framework
      (hook `no-infra-in-domain`). Reutiliza los tipos/errores de `bloquear-fecha.service.ts`.
- [x] 4.2 Puertos en dominio: ampliar `FechaBloqueadaRepositoryPort` con `liberar(...)` (devuelve
      filas afectadas + tipo/estado para la guarda); nuevos `PromocionColaPort` (D-2),
      `AuditLogPort` (D-8) y lectura de estado de reserva (D-6).
- [x] 4.3 Adaptador Prisma en infraestructura: transacción `$transaction` + `SET LOCAL
      app.tenant_id` (RLS) + `DELETE` vía `$executeRaw` devolviendo rows-affected (D-1). Sin
      cachés/locks fuera del motor (hook de bloqueo atómico verde).
      → `src/reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` (ampliado).
- [x] 4.4 Adaptador **stub no-op** de `PromocionColaPort` (D-2), documentado como deuda ligada a
      US-018; adaptador Prisma de `AuditLogPort`.
- [x] 4.5 Caso de uso de aplicación de **liberación en lote** (D-9): orquesta N fechas, cada una
      en transacción independiente, con fallo aislado. (Sin wiring de cron/endpoint — diferido.)
- [x] 4.6 Respetar el orden de evaluación: validar guarda firme (dominio) → DELETE serializado →
      si rows=1 auditar + (si cola) disparar promoción post-commit → propagar resultado.

## 5. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N) — `backend-developer`

- [x] 5.1 Revisar/actualizar tests unitarios afectados (incluidos los de US-040 que comparten el
      adaptador/puerto); pasar la batería de US-041 de ROJO a VERDE (incluida la suite de
      concurrencia con PostgreSQL real). Confirmar `pnpm lint`, `pnpm typecheck` y `pnpm run arch`
      (depcruise) sin violaciones.

## 6. QA: unit tests + verificación de BD + report (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 6.1 Capturar baseline de BD: `count(fecha_bloqueada)`, `count(audit_log)` y filas de cola
      (`reserva` en `2.d`) del tenant piloto.
- [x] 6.2 Ejecutar los tests dirigidos del módulo de liberación (incluida concurrencia y lote).
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/runtime.
- [x] 6.4 Verificar estado posterior de BD; **restaurar** cualquier `fecha_bloqueada`/`audit_log`
      de prueba (los tests de integración insertan/borran filas reales) al baseline.
- [x] 6.5 Crear report
      `openspec/changes/us-041-liberar-fecha/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`.
- [x] 6.6 Marcar completado solo tras tests en verde, BD verificada/restaurada y report creado.

## 7. QA: pruebas manuales con curl + report (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 7.1 `liberarFecha()` NO tiene endpoint propio (D-7): verificar la liberación
      **indirectamente** mediante tests de integración del repositorio (DELETE real contra
      PostgreSQL, rows-affected, idempotencia 0 filas, guarda firme); documentar el motivo (D-7).
      EL AGENTE DEBE EJECUTARLO.
- [x] 7.2 Caso happy: bloquear una fecha (blando), liberar y verificar 0 filas para `(T, D)` y el
      registro en `AUDIT_LOG` (`accion='eliminar'`). → restaurar BD.
- [x] 7.3 Caso idempotente: liberar una `(T, D)` sin bloqueo → 0 filas, sin error, tentativa
      auditada. Caso guarda firme: intentar liberar firme de reserva no cancelada → rechazo, fila
      intacta, intento auditado.
- [x] 7.4 Restaurar la BD: borrar/recrear las filas de prueba y dejar el estado al baseline.
- [x] 7.5 Crear report
      `openspec/changes/us-041-liberar-fecha/reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`
      documentando comandos, respuestas, el motivo de la verificación indirecta (D-7) y la
      restauración de BD.

## 8. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 8.1 **Condicional / previsiblemente N/A**: la liberación es infraestructura de dominio (solo
      backend) y NO aporta UI propia (actor de UC-31 = Sistema). Si en la implementación NO se
      añade frontend, documentar N/A en
      `openspec/changes/us-041-liberar-fecha/reports/YYYY-MM-DD-step-N+3-e2e-playwright-NA.md`. Si
      excepcionalmente se tocara UI, EL AGENTE DEBE EJECUTAR el E2E con Playwright MCP y restaurar BD.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4) — `docs-keeper`

- [x] 9.1 Reflejar la operación `liberarFecha()`, el seam `PromocionColaPort` (deuda US-018), la
      semántica de lote, la guarda firme y la decisión de NO exponer endpoint (D-7) en la
      documentación técnica; asegurar coherencia con `er-diagram.md §3.6`, `§3.17`, `§5.2`, `§5.3`
      y `use-cases.md` UC-31.

## 10. Code review del diff (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO) — `code-reviewer`

- [x] 10.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal sin infra en
      dominio, DELETE serializado sin locks distribuidos, rows-affected exactamente-una-vez, RLS y
      `tenant_id`, guarda firme declarativa, seam de promoción no-op documentado, AUDIT_LOG,
      dominio/errores en español, TDD-concurrencia primero).
- [x] 10.2 Dejar informe
      `openspec/changes/us-041-liberar-fecha/reports/YYYY-MM-DD-step-review-code-review.md` con la
      línea literal `Veredicto: APTO`.

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA) — humano

- [x] 11.1 Tras code-review APTO + validación manual, presentar el resumen y **ESPERAR el OK
      humano** antes de archivar/PR.

## 12. Archivar change + abrir PR (OBLIGATORIO — archive) — `spec-author`

- [x] 12.1 `openspec validate us-041-liberar-fecha --strict` OK (revalidar antes de archivar).
- [x] 12.2 `openspec archive us-041-liberar-fecha`; actualizar `openspec/specs/bloqueo-fecha/`;
      abrir PR (solo tras gate final y code-review `Veredicto: APTO` — el hook
      `require-code-review` lo exige).
