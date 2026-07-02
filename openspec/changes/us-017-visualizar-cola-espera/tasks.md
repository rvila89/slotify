# Tasks — us-017-visualizar-cola-espera

> US-017 · UC-11 · Módulo M3 · Talla S · vista de SOLO LECTURA.
> Reutiliza: `ColaQueryPort`/`ColaQueryPrismaAdapter` y `promocion-cola.ts` (US-018),
> `ObtenerReservaUseCase` (US-005), indicador `🔁` de `GET /calendario` (US-039).
> El AGENTE ejecuta todas las pruebas; NUNCA delega en el usuario.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-017-visualizar-cola-espera` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual
- [x] 0.3 Actualizar frontmatter de `user-stories/US-017-visualizar-cola-espera.md` (`branch`)

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) + `design.md`
- [x] 1.2 Recabar decisión de **D-3** (FA-04: 200 con `estaBloqueada:false` vs 404) y **D-5** (ubicación frontend)
- [x] 1.3 ESPERAR el OK explícito del humano. NO avanzar a contrato/TDD/impl sin él (aunque se diga "continúa")

## 2. Contrato OpenAPI (delegado en `contract-engineer` — tras el gate)
- [x] 2.1 Madurar `GET /reservas/{id}/cola`: ampliar `ColaItem` (+`fechaCreacion`, +`tiempoEnCola`) y añadir `ColaEsperaResponse` (sección `bloqueante` + `cola[]`) según `design.md D-2`
- [x] 2.2 Tipar respuestas de FA-04 según la decisión del gate (`design.md D-3`): 200 con `estaBloqueada:false`/`bloqueante:null`/`cola:[]`; 404 solo para reserva inexistente/otro tenant; 401/403 por convención
- [x] 2.3 `spectral lint docs/api-spec.yml` en verde; regenerar el SDK del frontend (nunca editar el cliente a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — delegado en `tdd-engineer`)
- [x] 3.1 Test de la **derivación pura** `ttlRestante` (`ttl_expiracion − now()`, incl. `null`) y `tiempoEnCola` (`now() − fecha_creacion`) sobre instantes
- [x] 3.2 Test del **use-case** `ObtenerColaEsperaUseCase`: bloqueante `2b`/`2c`/`2v` (+`visitaProgramadaFecha` en `2v`), cola ordenada ASC por `posicion_cola`
- [x] 3.3 Test de **filtrado**: solo `sub_estado='2d'` + `consulta_bloqueante_id` de la bloqueante; excluye la bloqueante y terminales `2x/2y/2z`
- [x] 3.4 Tests de los **5 FA**: FA-01 sin cola, FA-02 `2c`, FA-03 `2v`, FA-04 sin `FECHA_BLOQUEADA`, FA-05 cola de 1
- [x] 3.5 Test de **aislamiento multi-tenant** (RLS): cola de otro tenant invisible
- [x] 3.6 Confirmar que la suite arranca en ROJO (RED) antes de implementar
- [x] 3.7 NOTA: sin tests de concurrencia (lectura pura — `design.md D-7`); no se toca máquina de estados

## 4. Backend: implementar + revisar/actualizar tests unitarios (OBLIGATORIO — step-N — `backend-developer`)
- [x] 4.1 Dominio: read model `ColaEsperaLectura` (reutiliza nombres de `promocion-cola.ts`) + función pura de derivación temporal (sin `@nestjs`/Prisma)
- [x] 4.2 Aplicación: `ObtenerColaEsperaUseCase` + puerto `ColaEsperaQueryPort` (clon de `ObtenerReservaUseCase`)
- [x] 4.3 Infraestructura: `ColaEsperaQueryPrismaAdapter` reutilizando el patrón de `ColaQueryPrismaAdapter` (RLS `fijarTenant`, filtro `s2d`, `ORDER BY posicion_cola ASC`)
- [x] 4.4 Interfaz: controller `GET /reservas/{id}/cola` + `ColaEsperaResponseDto`; binding en `reservas.module.ts`
- [x] 4.5 Poner los tests del paso 3 en VERDE; sin regresiones en el módulo `reservas`

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 5.1 Capturar baseline de BD (`RESERVA` en `2d`, `FECHA_BLOQUEADA`, counts) sobre `slotify_test`
- [x] 5.2 Ejecutar tests dirigidos de los módulos cambiados (`reservas`)
- [x] 5.3 Ejecutar la suite requerida (`pnpm test`); registrar totales, runtime y flaky (vigilar US-004 `40P01`)
- [x] 5.4 Verificar estado posterior de BD (lectura pura ⇒ sin mutación esperada) y restaurar si hiciera falta
- [x] 5.5 Crear report `openspec/changes/us-017-visualizar-cola-espera/reports/2026-07-02-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Levantar el backend y verificar conexión a BD
- [x] 6.2 Sembrar una bloqueante con cola (2 elementos) y ejecutar `GET /reservas/{id}/cola`; verificar bloqueante + cola ordenada + TTL/tiempos (happy path)
- [x] 6.3 Probar FA-01 (sin cola), FA-05 (cola de 1)
- [x] 6.4 Probar FA-02 (bloqueante `2c`) y FA-03 (bloqueante `2v` con `visitaProgramadaFecha`)
- [x] 6.5 Probar FA-04 (reserva no bloqueante): verificar el shape decidido en el gate (200 `estaBloqueada:false` o 404)
- [x] 6.6 Probar aislamiento multi-tenant (JWT de otro tenant → no encontrada) y 401 sin sesión
- [x] 6.7 Como es solo lectura, confirmar que la BD NO cambia tras los curl (sin necesidad de restauración; documentarlo)
- [x] 6.8 Crear report `openspec/changes/us-017-visualizar-cola-espera/reports/2026-07-02-step-N+2-curl-endpoint-tests.md`

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar frontend y backend; BD en estado conocido con una fecha con cola
- [x] 7.2 `browser_navigate` al Calendario; localizar una fecha con indicador `🔁 N en cola`
- [x] 7.3 Clic en el indicador → verificar navegación a la vista de cola (US-017)
- [x] 7.4 Verificar sección bloqueante (cliente, sub_estado, TTL) y cola FIFO (posiciones, tiempo en cola)
- [x] 7.5 Verificar enlace a la ficha de una RESERVA de la cola (`GET /reservas/{id}`)
- [x] 7.6 Verificar responsive en 390 / 768 / 1280 sin overflow (regla dura `CLAUDE.md`)
- [x] 7.7 Verificar FA-01 (mensaje "Sin consultas en espera") y FA-04 ("Fecha disponible")
- [x] 7.8 Restaurar entorno/BD y cerrar sesiones de navegador
- [x] 7.9 Crear report `openspec/changes/us-017-visualizar-cola-espera/reports/2026-07-02-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — `docs-keeper`)
- [x] 8.1 Confirmar UC-11 en `docs/use-cases.md` (flujo y postcondiciones alineados con el endpoint)
- [x] 8.2 Reflejar el endpoint maduro en `docs/api-spec.yml` (ya cubierto por el step de contrato) y notas en `docs/er-diagram.md §5.3` si procede (lectura de cola)
- [x] 8.3 Actualizar `docs/frontend-standards.md`/estructura si se crea `features/cola-espera/`

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO — `code-reviewer`)
- [x] 9.1 Ejecutar `code-reviewer` sobre el diff (hexagonal, RLS, no-mutación, no cliente editado a mano, responsive)
- [x] 9.2 Dejar informe `openspec/changes/us-017-visualizar-cola-espera/reports/YYYY-MM-DD-step-review-code-review.md` con línea literal `Veredicto: APTO`

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)
- [x] 10.1 Tras code-review APTO + validación manual, presentar resultados y ESPERAR el OK humano antes de archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive — `spec-author`)
- [ ] 11.1 `openspec archive us-017-visualizar-cola-espera` (solo tras gate final y code-review APTO)
- [ ] 11.2 Actualizar `openspec/specs/consultas/` con el delta archivado
- [ ] 11.3 Abrir PR a `master` (GitHub MCP o `gh`); enlazar US-017 y reports
