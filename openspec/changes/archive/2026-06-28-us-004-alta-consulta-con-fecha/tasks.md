# Tasks — us-004-alta-consulta-con-fecha

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar
> él mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada
> `[x]` solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-004-alta-consulta-con-fecha/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-004-alta-consulta-con-fecha` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`)
      + `design.md` (las 8 decisiones, incl. divergencia de fecha D-1 y migración
      aditiva D-8) y **ESPERAR su OK explícito**
      → **Gate 1 APROBADO**: decisión A = validación `> hoy` (estrictamente futura,
      rechaza hoy y pasado con 400); decisión B = migración aditiva D-8 aplicable
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Evolucionar `POST /reservas` / `ReservaResponse`: exponer `subEstado ∈
      {2a,2b,2d}`, `ttlExpiracion`, `posicionCola`, `consultaBloqueanteId`, aviso de
      disponibilidad y el bloque de tarifa estimada de E1 (alineado con D-1/D-4)
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde
- [x] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test de la **función declarativa de sub-estado** (`maquina-estados`): libre
      →`2b`/bloquear, bloqueada-por-`2b`→`2d`/encolar, bloqueada-por-`2c|2v|pre|conf+`
      →`2a`/exploratoria (en rojo)
      → `__tests__/maquina-estados-alta-con-fecha.spec.ts` — RED (TS2305: faltan
      `determinarAltaConFecha`/`EstadoFecha`/`ResultadoAlta`/entradas 2b/2d)
- [x] 3.2 Test del use-case alta con fecha libre: RESERVA `2b` + `FECHA_BLOQUEADA`
      blando con `ttl=now()+ttl_consulta_dias`, en una sola transacción
      → `__tests__/alta-consulta-con-fecha.use-case.spec.ts` (dobles) +
      `__tests__/alta-consulta-con-fecha-integracion.spec.ts` (BD real) — RED
      (integración: `reserva.subEstado` esperado `s2b`, recibido `undefined`)
- [x] 3.3 Test del use-case alta sobre fecha bloqueada por `2b`: RESERVA `2d` +
      `posicion_cola=MAX+1` + `consulta_bloqueante_id`; SIN `FECHA_BLOQUEADA`
      → mismos ficheros — RED (integración: reserva `s2d` no creada)
- [x] 3.4 Test del use-case alta sobre fecha bloqueada por `2c/2v/pre/confirmada`:
      RESERVA `2a` sin bloqueo ni cola
      → mismos ficheros — RED (no detecta no-disponibilidad; falta `fechaDisponible`)
- [x] 3.5 **Tests de concurrencia REALES (skill `concurrency-locking`)**: 2 workers
      misma `(tenant,fecha)` libre → 1×`2b`+`FECHA_BLOQUEADA` y 1×`2d`/pos=1; N
      workers → 1×`2b` + N-1×`2d` con posiciones únicas y contiguas (D-5/D-6)
      → `__tests__/alta-consulta-con-fecha-concurrencia.spec.ts` (DI real +
      Postgres real) — RED (`fecha_bloqueada` esperado 1, recibido 0)
- [x] 3.6 Test de validación `fecha_evento > hoy` (estrictamente futura) en servidor:
      pasado → 400 sin crear nada; **hoy → 400 sin crear nada**; futura válida → alta
      continúa; test de regresión del flujo sin fecha (US-003 → `2a`) intacto
      → `__tests__/alta-consulta-con-fecha-integracion.spec.ts` — RED (hoy/pasado:
      la promesa resuelve en vez de rechazar). Regresión sin fecha → `2a`: VERDE
- [x] 3.7 Test de E1: con fecha+invitados+horas → tarifa estimada en E1; faltando
      datos o cálculo imposible → dossier general sin precio, sin romper el alta
      → `__tests__/alta-consulta-con-fecha.use-case.spec.ts` — RED (falta puerto
      `TarifaEstimadaPort` y campo `tarifaEstimada` del resultado)
- [x] 3.8 Confirmar que toda la batería está **en rojo** antes de implementar
      → `npx jest --testPathPatterns="con-fecha"`: 4 suites FAIL (7 tests rojos,
      1 verde = regresión sin fecha). Ningún código de producción modificado

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 4.1 Revisar tests de US-003/US-040/US-016 afectados por el refactor
      (`bloquearEnTx`, ramificación del alta, puerto de tarifa) y ajustarlos sin
      romper su comportamiento; confirmar regresión cero de `bloquearFecha()` público
      → Solo se ajustó `unidad-de-trabajo.prisma.adapter.spec.ts` (presupuesto de
      reintentos `MAX_INTENTOS_TRANSACCION=12`, generaliza codigo+fecha+posicion_cola).
      `bloquear()` público de US-040 intacto (wrapper sobre `bloquearEnTx`); US-016 sin
      cambios. Suite global: 38 suites / 218 tests verdes; depcruise sin violaciones.

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 Extender `maquina-estados.ts`: entradas iniciales `2b`/`2d` + tabla
      declarativa `determinarAltaConFecha` (D-3)
- [x] 5.2 Refactor `FechaBloqueadaPrismaAdapter`: extraer `bloquearEnTx(tx, …)`
      reutilizado por `bloquear()` (US-040, sin cambio de contrato) y por la UoW del
      alta (D-2)
- [x] 5.3 Ramificar `AltaConsultaUseCase`: validación `> hoy` (estrictamente futura,
      vía `esFechaEstrictamenteFutura`; rechaza hoy y pasado con 400), determinación de
      sub-estado dentro de la tx, INSERT `FECHA_BLOQUEADA` en `2b`, cola en `2d`
      (`SELECT FOR UPDATE` sobre fila bloqueante + `MAX+1`), re-derivación D4 en el
      reintento; flujo sin fecha (US-003) intacto (D-1/D-5/D-6)
- [x] 5.4 Puerto `TarifaEstimadaPort` + adaptador sobre `CalculadoraTarifaService`;
      `ReservasModule` importa `TarifasModule`; E1 con/sin tarifa (D-4)
- [x] 5.5 Generalizar el retry-on-conflict de la UoW para `codigo` y `posicion_cola`;
      (si se aprueba D-8) migración aditiva del índice UNIQUE parcial de cola
      → migración `20260628120000_us004_cola_posicion_unique` aplicada (índice
      `reserva_cola_posicion_key` verificado en BD)
- [x] 5.6 Controller: propagar `fechaEvento` al comando y mapear el response ampliado
- [x] 5.7 Frontend "Nueva consulta": selector de fecha (bloquea < hoy **y hoy**;
      solo fechas estrictamente futuras) + avisos
      (cola/no disponible/borrador E1); responsive mobile-first
      → `apps/web/src/reservas/NuevaConsultaPage.tsx` extendido con campo fecha
      opcional (`<input type=date>` `min=mañana` + Zod `> hoy`) y avisos 2b/2d/2a +
      borrador/enviado E1. `pnpm --filter @slotify/web typecheck` y `pnpm lint` en verde

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `fecha_bloqueada`,
      `comunicacion`, `audit_log`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar estado posterior de BD (unicidad de `FECHA_BLOQUEADA` y de
      `posicion_cola` por fecha) y restaurar si hace falta
- [x] 6.5 Crear report `reports/2026-06-28-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 POST alta con fecha libre → 201; verificar RESERVA `2b`, `ttl`,
      `FECHA_BLOQUEADA` blando, E1 con tarifa, AUDIT_LOG. Restaurar BD
- [x] 7.3 POST alta sobre la misma fecha → verificar RESERVA `2d`, `posicion_cola=1`,
      `consulta_bloqueante_id`, SIN nueva `FECHA_BLOQUEADA`. Restaurar BD
- [x] 7.4 POST alta sobre fecha bloqueada por `pre_reserva`/`2c` → RESERVA `2a` sin
      bloqueo ni cola. Restaurar BD
- [x] 7.5 POST con `fecha_evento` pasada y POST con `fecha_evento = hoy` (bypass) →
      error de validación 400, sin crear nada en ninguno de los dos casos
- [x] 7.6 POST con fecha pero sin invitados/horas → E1 dossier general sin precio
- [x] 7.7 Verificar que el formato de error coincide con el contrato OpenAPI
- [x] 7.8 Crear report `reports/2026-06-28-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Navegar al formulario "Nueva consulta" (`browser_navigate`)
- [x] 8.3 Alta con fecha libre: rellenar + seleccionar fecha + confirmar; verificar
      creación en `2b` y aviso de fecha bloqueada
- [x] 8.4 Alta sobre fecha ocupada: verificar aviso de cola / no disponible según caso
- [x] 8.5 Casos de validación: selector no permite fechas pasadas ni hoy (solo
      estrictamente futuras); borrador E1
- [x] 8.6 Verificar responsive en 3 viewports (390 / 768 / 1280)
- [x] 8.7 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [x] 8.8 Crear report `reports/2026-06-28-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (capability `consultas`: alta con
      fecha, ramificación 2b/2d/2a, reuso de `bloquearEnTx`, puerto de tarifa,
      serialización de cola) y la trazabilidad de la US

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS, sin
      bloqueo distribuido, sin editar cliente generado, responsive, atomicidad D4)
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes
      de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [x] 12.1 `openspec archive us-004-alta-consulta-con-fecha` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [x] 12.2 Actualizar `openspec/specs/` y abrir PR
