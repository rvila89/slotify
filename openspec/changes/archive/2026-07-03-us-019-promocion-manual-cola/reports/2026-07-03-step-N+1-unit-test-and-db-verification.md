# Step N+1 — Unit Tests + DB Verification (2026-07-03)

US-019 Promocion Manual de Consulta en Cola

## Comandos ejecutados

```
# Rama activa
git branch --show-current
# → feature/us-019-promocion-manual-cola

# Baseline BD (slotify_test)
node -e "prisma.$queryRaw ..." → reserva:0, fecha_bloqueada:0, audit_log:0, comunicacion:0

# Tests dirigidos US-019
cd apps/api && npx jest --testPathPatterns="planificar-promocion-manual-cola|promover-manual-en-cola|promover-manual\.controller|promocion-manual-cola" --runInBand --no-coverage --reporters default

# Suite completa
cd apps/api && npx jest --runInBand --no-coverage --reporters default

# Typecheck
cd apps/api && npx tsc --noEmit -p tsconfig.json

# Lint
cd apps/api && npx eslint "src/**/*.ts" --max-warnings=0
```

## Resultados

### Tests dirigidos US-019 (5 suites, 42 tests)

| Suite | Tests | Estado |
|-------|-------|--------|
| promocion-manual-cola-integracion.spec.ts | 8 | PASS |
| promocion-manual-cola-concurrencia.spec.ts | 3 | PASS |
| promover-manual.controller.http.spec.ts | 5 | PASS |
| promover-manual-en-cola.use-case.spec.ts | 13 | PASS |
| planificar-promocion-manual-cola.spec.ts | 13 | PASS |
| **TOTAL** | **42** | **PASS** |

Tests clave verificados:
- `debe_expirar_la_bloqueante_promover_la_elegida_reasignar_el_bloqueo_y_cerrar_el_hueco` PASS
- `debe_auditar_cada_reserva_modificada_con_origen_promocion_manual_y_el_gestor` PASS
- `no_debe_crear_ninguna_COMUNICACION_al_cliente_en_MVP_D6` PASS
- `debe_materializar_exactamente_una_promocion_y_dejar_una_sola_fila_de_bloqueo` (RC-A concurrencia) PASS
- `la_manual_que_pierde_la_carrera_rechaza_sin_corromper_la_cola` (RC-A carrera) PASS
- `debe_completar_exactamente_una_promocion_y_abortar_la_otra` (RC-B dos Gestores) PASS
- `debe_responder_422_cuando_falta_confirmado_true` PASS
- `debe_responder_422_cuando_la_consulta_ya_no_esta_en_cola_FA05` PASS
- `debe_responder_409_cuando_pierde_la_carrera_con_el_mensaje_de_recarga` PASS
- `debe_responder_409_cuando_no_existe_bloqueo_activo_para_la_fecha` PASS
- `debe_marcar_anomalia_cuando_la_elegida_no_pertenece_a_la_cola` PASS
- `debe_rechazar_sin_tocar_la_uow_cuando_confirmado_es_false` PASS

### Suite completa (95 suites, 706 tests)

```
Test Suites: 95 passed, 95 total
Tests:       706 passed, 706 total
Snapshots:   0 total
Time:        153.584 s
```

Flaky US-004 (deadlock 40P01): NO aparecio en esta ejecucion.

### Typecheck

```
npx tsc --noEmit → sin errores (exit 0)
```

### Lint

```
npx eslint "src/**/*.ts" --max-warnings=0 → sin advertencias ni errores (exit 0)
```

## Comparacion BD pre/post

| Tabla | PRE (baseline) | POST (tras suite) | Restaurado |
|-------|---------------|-------------------|------------|
| reserva | 0 | 0 | n/a |
| fecha_bloqueada | 0 | 0 | n/a |
| audit_log | 0 | 0 | n/a |
| comunicacion | 0 | 0 | n/a |

Los tests de integracion (promocion-manual-cola-integracion.spec.ts, promocion-manual-cola-concurrencia.spec.ts) crean y limpian sus fixtures dentro de cada test (beforeEach/afterEach). La BD queda en estado limpio tras la suite.

## Verificacion de invariantes de D-4/D-6/D-5 (deducida de los tests verdes)

- **Expirar bloqueante a `2x` con `ttl_expiracion=NULL`**: cubierto por `debe_expirar_la_bloqueante_promover_la_elegida_reasignar_el_bloqueo_y_cerrar_el_hueco` (PASS).
- **Una sola fila `FECHA_BLOQUEADA` activa por `(tenant,fecha)`**: cubierto por el test de concurrencia RC-A `debe_materializar_exactamente_una_promocion_y_dejar_una_sola_fila_de_bloqueo` (PASS).
- **Cierre de hueco en la cola**: cubierto por `planificar-promocion-manual-cola.spec.ts` tests de posicion intermedia (PASS).
- **AUDIT_LOG con `origen: promocion_manual` + `usuario_id` del Gestor**: cubierto por `debe_auditar_cada_reserva_modificada_con_origen_promocion_manual_y_el_gestor` (PASS).
- **SIN COMUNICACION (D-6)**: cubierto por `no_debe_crear_ninguna_COMUNICACION_al_cliente_en_MVP_D6` (PASS).
- **409 carrera perdida**: cubierto por controller test y concurrencia RC-A/RC-B (PASS).
- **422 FA-05**: cubierto por controller test y use-case test (PASS).

## Restauracion

No fue necesaria: la BD `slotify_test` quedo con 0 filas en todas las tablas relevantes, identico al baseline.

## Outcome

**PASS**
