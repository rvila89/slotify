# QA Report — Step N+1: Unit Tests + DB State Verification
**Change:** us-040-bloquear-fecha-atomicamente  
**Rama:** feature/us-040-bloquear-fecha-atomicamente  
**Fecha:** 2026-06-27  
**Agente:** qa-verifier  

---

## 1. Baseline de BD (pre-tests)

Captura realizada con `docker exec slotify-postgres psql -U user -d slotify_dev`.

| Tabla | Filas | Notas |
|-------|-------|-------|
| `fecha_bloqueada` | 0 | Sin bloqueos activos |
| `reserva` | 0 | Sin reservas |
| `cliente` | 0 | Sin clientes |
| `tenant` | 1 | Masia l'Encís (`00000000-0000-0000-0000-000000000001`) |
| `tenant_settings` | 1 | `ttl_consulta_dias=3`, `ttl_prereserva_dias=7` |

**Check constraints presentes en `fecha_bloqueada`:**
```
chk_firme_sin_ttl  : CHECK (tipo_bloqueo <> 'firme'  OR ttl_expiracion IS NULL)
chk_blando_con_ttl : CHECK (tipo_bloqueo <> 'blando' OR ttl_expiracion IS NOT NULL)
```

**Índice UNIQUE anti-doble-reserva:**
```
fecha_bloqueada_tenant_id_fecha_key  UNIQUE btree (tenant_id, fecha)
```

---

## 2. Ejecución de tests dirigidos del módulo US-040 (step 6.2)

**Comando:**
```
cd apps/api && npx jest --runInBand --testPathPatterns="bloquear-fecha|fecha-bloqueada-concurrencia" --reporters default --verbose
```

**Suites ejecutadas (4):**

### 2.1 `src/reservas/__tests__/bloquear-fecha.service.spec.ts` — Dominio puro (mocks)
Cubre: mapa canónico fase→(tipo,ttl,modo) con función `resolverPlanBloqueo`, servicio `BloquearFechaService`, validaciones previas a la transacción, propagación de errores de dominio.

| Test | Resultado |
|------|-----------|
| debe_resolver_2b_a_blando_insert_con_ttl_ahora_mas_ttl_consulta_dias | PASS |
| debe_leer_el_ttl_de_TENANT_SETTINGS_y_no_hardcodear_3_dias | PASS |
| debe_resolver_2v_a_blando_con_ttl_visita_mas_un_dia | PASS |
| debe_resolver_pre_reserva_a_blando_con_ttl_ahora_mas_ttl_prereserva_dias | PASS |
| debe_resolver_2c_a_extension_de_ttl_sin_cambiar_el_tipo | PASS |
| debe_resolver_reserva_confirmada_a_upgrade_firme_con_ttl_null | PASS |
| debe_rechazar_una_fase_no_contemplada_en_el_mapa | PASS |
| debe_insertar_bloqueo_blando_en_2b_con_ttl_leido_de_settings | PASS |
| debe_promover_a_firme_con_upgrade_preservando_el_reserva_id | PASS |
| debe_extender_el_ttl_en_2c_con_modo_extend_y_tipo_blando | PASS |
| debe_usar_la_fecha_de_visita_mas_un_dia_en_2v | PASS |
| no_debe_mutar_la_reserva_solo_invoca_el_repositorio_de_bloqueo | PASS |
| debe_lanzar_FECHA_EN_PASADO_y_no_tocar_el_repositorio | PASS |
| debe_rechazar_la_fecha_del_mismo_dia_la_fecha_debe_ser_estrictamente_futura | PASS |
| debe_exponer_la_fecha_en_el_detalle_de_FECHA_EN_PASADO | PASS |
| debe_lanzar_TENANT_MISMATCH_cuando_el_tenant_del_bloqueo_difiere_del_de_la_reserva | PASS |
| debe_rechazar_una_fase_invalida_antes_de_abrir_la_transaccion | PASS |
| debe_propagar_FECHA_YA_BLOQUEADA_sin_envolverla_cuando_el_repo_la_lanza | PASS |
| debe_propagar_el_detalle_de_diagnostico_del_rechazo | PASS |

**Subtotal: 19/19 PASS**

### 2.2 `src/reservas/__tests__/bloquear-fecha-integracion.spec.ts` — Integración (BD real)
Cubre: concurrencia (zona crítica), rechazo determinista, idempotencia firme, upgrade blando→firme por UPDATE.

| Test | Resultado |
|------|-----------|
| debe_permitir_un_bloqueo_y_rechazar_el_segundo_cuando_son_concurrentes (ZONA CRITICA) | PASS (64 ms) |
| debe_rechazar_con_FECHA_YA_BLOQUEADA_y_no_insertar_fila_adicional | PASS (17 ms) |
| debe_ser_idempotente_ante_un_segundo_bloqueo_firme_con_el_mismo_reserva_id | PASS (22 ms) |
| debe_rechazar_un_bloqueo_firme_con_reserva_id_distinto_sobre_la_misma_fecha | PASS (9 ms) |
| debe_promover_el_blando_existente_a_firme_con_ttl_null_y_mismo_reserva_id | PASS (7 ms) |

**Subtotal: 5/5 PASS**

### 2.3 `src/reservas/__tests__/bloquear-fecha-check-constraints.spec.ts` — Check constraints (BD real)
Cubre: rechazo de fila firme con TTL no nulo (`chk_firme_sin_ttl`), rechazo de fila blando sin TTL (`chk_blando_con_ttl`), aceptación del caso coherente firme+ttl_null.

| Test | Resultado |
|------|-----------|
| debe_rechazar_un_bloqueo_firme_con_ttl_no_nulo_por_chk_firme_sin_ttl | PASS (43 ms) |
| debe_rechazar_un_bloqueo_blando_sin_ttl_por_chk_blando_con_ttl | PASS (2 ms) |
| debe_aceptar_un_bloqueo_firme_con_ttl_nulo_fila_coherente | PASS (4 ms) |

**Subtotal: 3/3 PASS**

### 2.4 `src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts` — Concurrencia directa en BD
Cubre: invariante UNIQUE constraint anti-doble-reserva (guardián original de US-000, ahora protegido por US-040).

| Test | Resultado |
|------|-----------|
| debe_permitir_un_bloqueo_y_rechazar_el_segundo_cuando_son_concurrentes | PASS (60 ms) |
| debe_rechazar_segunda_reserva_con_P2002_cuando_fecha_ya_bloqueada | PASS (7 ms) |

**Subtotal: 2/2 PASS**

**TOTAL MÓDULO US-040: 29/29 PASS**

> Nota: tasks.md indicaba 27 tests; la implementación añadió 2 tests adicionales de dominio en `bloquear-fecha.service.spec.ts` (rechazo fecha mismo día, y detalle de error de diagnóstico), lo que eleva el total a 29.

---

## 3. Ejecución de la suite completa (step 6.3)

**Comando:**
```
cd apps/api && pnpm test
# que ejecuta: jest --runInBand && pnpm run arch
```

**Resultado:**

```
Test Suites: 18 passed, 18 total
Tests:       71 passed, 71 total
Snapshots:   0 total
Time:        1.574 s
```

**depcruise (arquitectura hexagonal):**
```
✔ no dependency violations found (75 modules, 148 dependencies cruised)
```

**Suites completas (18 PASS):**
- `src/__tests__/app.e2e.spec.ts`
- `src/auth/auth.module.spec.ts`
- `src/calendario/calendario.module.spec.ts`
- `src/clientes/clientes.module.spec.ts`
- `src/comunicaciones/comunicaciones.module.spec.ts`
- `src/config/env.validation.spec.ts`
- `src/configuracion/configuracion.module.spec.ts`
- `src/dashboards/dashboards.module.spec.ts`
- `src/facturacion/facturacion.module.spec.ts`
- `src/ficha-evento/ficha-evento.module.spec.ts`
- `src/presupuestos/presupuestos.module.spec.ts`
- `src/reservas/__tests__/bloquear-fecha-check-constraints.spec.ts`
- `src/reservas/__tests__/bloquear-fecha-integracion.spec.ts`
- `src/reservas/__tests__/bloquear-fecha.service.spec.ts`
- `src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts`
- `src/reservas/reservas.module.spec.ts`
- `src/tareas/tareas.module.spec.ts`
- `src/tarifas/__tests__/calculadora-tarifa.service.spec.ts`

---

## 4. Verificación de zona crítica de concurrencia

**Escenario:** Dos transacciones simultáneas (`Promise.allSettled`) sobre la misma `(tenant_id='00000000-0000-0000-0000-000000000001', fecha='2026-09-12')`.

**Resultado observado:**
- 1 éxito (`fulfilled`) — INSERT exitoso, COMMIT
- 1 rechazo (`rejected`) — `FechaYaBloqueadaError` (traducción del `P2002` de Prisma por el adaptador)
- Estado final en BD: exactamente 1 fila para `(tenant_id, fecha)`

**Mecanismo verificado:** `SELECT ... FOR UPDATE` dentro de `$transaction` de Prisma + restricción `UNIQUE(tenant_id, fecha)` como última línea atómica. Sin Redis, sin locks distribuidos (conforme a `AGENTS.md §Regla crítica` y hook `no-distributed-lock`).

---

## 5. Verificación de check constraints BD (D-3)

| Escenario | Constraint activado | Resultado BD |
|-----------|-------------------|--------------|
| `tipo='firme'`, `ttl_expiracion` no nulo | `chk_firme_sin_ttl` | RECHAZADO (excepción Prisma) |
| `tipo='blando'`, `ttl_expiracion` nulo | `chk_blando_con_ttl` | RECHAZADO (excepción Prisma) |
| `tipo='firme'`, `ttl_expiracion` nulo (coherente) | N/A | ACEPTADO |

Migración aplicada: `20260627120000_us040_check_constraints_fecha_bloqueada`

---

## 6. Estado de BD post-tests (step 6.4)

| Tabla | Filas PRE | Filas POST | Delta | Restaurado |
|-------|-----------|-----------|-------|------------|
| `fecha_bloqueada` | 0 | 0 | 0 | SI |
| `reserva` | 0 | 0 | 0 | SI |
| `cliente` | 0 | 0 | 0 | SI |
| `tenant` | 1 | 1 | 0 | N/A |
| `tenant_settings` | 1 | 1 | 0 | N/A |

Los tests de integración realizan limpieza en `beforeAll`, `beforeEach` y `afterAll` (hooks `deleteMany` sobre registros con código `TST-U040-*`, `TST-CONC-*`, `TST-U040-CHK`). La BD queda en el estado exacto del baseline.

**No hubo filas residuales en `fecha_bloqueada` ni reservas de test.**

---

## Outcome

**PASS**

- Tests US-040: 29/29 PASS (4 suites: dominio puro, integración, check constraints, concurrencia)
- Suite completa: 71/71 PASS, 18 suites
- depcruise: sin violaciones de arquitectura hexagonal (75 módulos, 148 dependencias)
- BD pre y post-tests: idéntica al baseline
- Check constraints `chk_firme_sin_ttl` y `chk_blando_con_ttl` verificados y activos
- Zona crítica de concurrencia: 1 éxito + 1 P2002 deterministas, 1 fila final
