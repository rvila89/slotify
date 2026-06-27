# QA Report — Step 6: Unit Tests + DB Verification
**Change:** us-041-liberar-fecha
**Fecha:** 2026-06-27
**Agente:** qa-verifier
**Outcome:** PASS

---

## 6.1 Baseline de BD (capturado antes de ejecutar tests)

| Tabla / Condición | Filas |
|---|---|
| `fecha_bloqueada` | 0 |
| `audit_log` | 0 |
| `reserva` WHERE `sub_estado = 's2d'` (cola) | 0 |
| `reserva` WHERE `codigo LIKE 'TST-U041-%'` | 0 |
| `cliente` WHERE `nombre = 'Cliente Test US-041'` | 0 |

Comandos de captura (via `docker exec slotify-postgres psql`):

```sql
SELECT COUNT(*) AS cnt_fecha_bloqueada FROM fecha_bloqueada;
-- cnt_fecha_bloqueada: 0

SELECT COUNT(*) AS cnt_audit_log FROM audit_log;
-- cnt_audit_log: 0

SELECT COUNT(*) AS cnt_cola FROM reserva WHERE sub_estado = 's2d';
-- cnt_cola: 0
```

---

## 6.2 Tests dirigidos del módulo de liberación

Comando ejecutado:
```
cd apps/api && npx jest --runInBand --testPathPatterns="liberar-fecha" --verbose --reporters=default
```

### Resultado por suite y test

**PASS** `src/reservas/__tests__/liberar-fecha-integracion.spec.ts` (BD real, PostgreSQL)

| Describe | Test | Resultado | Tiempo |
|---|---|---|---|
| liberarFecha() — dos liberaciones concurrentes (zona crítica) | debe_eliminar_la_fila_una_sola_vez_con_la_otra_en_noop_y_promover_exactamente_una_vez | PASS | 31 ms |
| liberarFecha() — race liberación vs nuevo intento de bloqueo | nunca_deja_la_fecha_doble_bloqueada_la_liberacion_completa_y_el_bloqueo_se_resuelve | PASS | 54 ms |
| liberarFecha() — idempotencia contra la BD real | debe_terminar_con_exito_y_0_filas_y_no_promover_cuando_no_hay_bloqueo | PASS | 6 ms |
| liberarFecha() — no muta el estado de la RESERVA | debe_dejar_estado_y_sub_estado_de_la_reserva_intactos_tras_liberar | PASS | 7 ms |
| liberarFechasEnLote() — fallo aislado por fecha (D-9) | debe_liberar_las_demas_aunque_una_falle_y_promover_solo_donde_hay_cola | PASS | 15 ms |

**PASS** `src/reservas/__tests__/liberar-fecha.service.spec.ts` (dominio puro, mocks)

| Describe | Test | Resultado |
|---|---|---|
| liberacionFirmePermitida — guarda firme declarativa (D-5) | debe_permitir_liberar_un_firme_solo_cuando_la_reserva_esta_cancelada | PASS |
| liberacionFirmePermitida — guarda firme declarativa (D-5) | debe_prohibir_liberar_un_firme_en_cualquier_estado_no_cancelado | PASS |
| LiberarFechaService — guarda del bloqueo firme | debe_rechazar_la_liberacion_de_un_firme_cuando_la_reserva_no_esta_cancelada | PASS |
| LiberarFechaService — guarda del bloqueo firme | debe_dejar_la_fila_firme_intacta_no_invocando_el_DELETE_cuando_la_guarda_falla | PASS |
| LiberarFechaService — guarda del bloqueo firme | debe_auditar_el_intento_rechazado_de_liberar_un_firme | PASS |
| LiberarFechaService — guarda del bloqueo firme | debe_permitir_liberar_un_firme_cuando_la_reserva_esta_cancelada | PASS |
| LiberarFechaService — disparo del seam de promoción (US-018) | debe_invocar_PromocionColaPort_exactamente_una_vez_cuando_hay_cola_activa | PASS |
| LiberarFechaService — disparo del seam de promoción (US-018) | no_debe_invocar_PromocionColaPort_cuando_no_hay_cola_activa | PASS |
| LiberarFechaService — disparo del seam de promoción (US-018) | debe_reflejar_en_el_resultado_que_la_promocion_fue_disparada | PASS |
| LiberarFechaService — idempotencia (0 filas afectadas) | no_debe_lanzar_excepcion_cuando_no_existe_bloqueo_para_la_fecha | PASS |
| LiberarFechaService — idempotencia (0 filas afectadas) | debe_auditar_la_tentativa_idempotente_cuando_el_DELETE_afecta_0_filas | PASS |
| LiberarFechaService — idempotencia (0 filas afectadas) | no_debe_disparar_la_promocion_cuando_el_DELETE_afecta_0_filas | PASS |
| LiberarFechaService — registro en AUDIT_LOG con la causa | debe_registrar_la_liberacion_exitosa_con_accion_eliminar_entidad_y_causa_TTL | PASS |
| LiberarFechaService — registro en AUDIT_LOG con la causa | debe_propagar_la_causa_descarte_al_registro_de_auditoria | PASS |
| LiberarFechaService — no muta la RESERVA | no_debe_exponer_ningun_puerto_de_escritura_de_la_reserva | PASS |
| LiberarFechaService — no muta la RESERVA | debe_limitar_sus_efectos_a_liberar_FECHA_BLOQUEADA_y_auditar | PASS |

**Totales (módulo):** Test Suites: 2 passed, 2 total | Tests: 21 passed, 21 total | Tiempo: ~1.2 s

---

## 6.3 Suite completa apps/api (`pnpm test`)

Comando ejecutado:
```
cd apps/api && pnpm test
# Equivale a: jest --runInBand && pnpm run arch (depcruise src)
```

Resultado:
```
Test Suites: 20 passed, 20 total
Tests:       94 passed, 94 total
Snapshots:   0 total
Time:        1.646 s, estimated 3 s
Ran all test suites.

$ depcruise src
✔ no dependency violations found (83 modules, 176 dependencies cruised)
```

- Tests: **94/94 PASS** — 0 failed, 0 skipped
- Suites: **20/20 PASS**
- Runtime: **1.646 s**
- Arquitectura (depcruise): **LIMPIA** — 83 modulos, 176 dependencias, 0 violaciones

---

## 6.4 Estado de BD post-tests y verificación de restauración

Comandos:
```sql
SELECT COUNT(*) FROM fecha_bloqueada;             -- 0
SELECT COUNT(*) FROM audit_log;                   -- 0
SELECT COUNT(*) FROM reserva WHERE sub_estado = 's2d';  -- 0
SELECT COUNT(*) FROM reserva WHERE codigo LIKE 'TST-U041-%'; -- 0
SELECT COUNT(*) FROM cliente WHERE nombre = 'Cliente Test US-041'; -- 0
```

| Tabla / Condición | Baseline | Post-tests | Delta | Restauracion |
|---|---|---|---|---|
| `fecha_bloqueada` | 0 | 0 | 0 | No necesaria |
| `audit_log` | 0 | 0 | 0 | No necesaria |
| `reserva` s2d (cola) | 0 | 0 | 0 | No necesaria |
| `reserva` TST-U041-* | 0 | 0 | 0 | No necesaria |
| `cliente` Test US-041 | 0 | 0 | 0 | No necesaria |

**Conclusion:** Los hooks `beforeEach`/`afterAll` del spec de integracion limpiaron todos los datos de prueba insertados. El estado de BD es IDENTICO al baseline. No se requirio restauracion manual.

---

## Anomalias

Ninguna. La observacion tecnica sobre la invocacion de depcruise con `--testPathPattern` (flag no soportado) es un artefacto del script `pnpm test` que encadena `jest --runInBand && pnpm run arch`; al ejecutar tests dirigidos con `npx jest --testPathPatterns=...` directamente, depcruise no se invoca y no aplica. El script `pnpm test` completo se ejecuto separadamente y paso sin errores.

---

## Outcome

**PASS** — 21/21 tests del modulo de liberacion en verde (5 integracion BD real + 16 dominio puro). 94/94 suite completa. Arquitectura hexagonal limpia (depcruise 0 violaciones). BD restaurada al baseline.
