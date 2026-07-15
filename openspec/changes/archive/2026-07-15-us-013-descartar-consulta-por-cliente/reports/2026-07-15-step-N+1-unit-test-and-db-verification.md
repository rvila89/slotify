# Step N+1 — Unit Tests + DB State Verification
## Change: us-013-descartar-consulta-por-cliente
## Date: 2026-07-15
## Executed by: qa-verifier

---

## 1. Baseline de BD (pre-ejecución)

Base de datos: `slotify_test` (PostgreSQL local, `localhost:5432`)

| Tabla | Conteo | Detalle |
|-------|--------|---------|
| `reserva` | 1 | `e2e00001...`, estado `consulta`, sub_estado `s2x` (terminal) |
| `fecha_bloqueada` | 0 | Sin bloqueos activos |
| `audit_log` | — | No consultado (sin cambios esperados) |

No hay ninguna `RESERVA` en `2z` con `FECHA_BLOQUEADA` activa (cumple la invariante de BD).  
No hay `posicion_cola` inconsistente.

Estado BD: **limpio — las suites de tests usan mocks o la BD de test aislada**.

---

## 2. Tests ejecutados

### 2a. Suites de dominio/aplicación US-013 (mockeadas — NO requieren BD)

**Comando:**
```
cd apps/api
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand \
  --testPathPatterns "maquina-estados-descarte-cliente" "descartar-consulta-por-cliente\.use-case"
```

**Resultado:**
```
Test Suites: 2 passed, 2 total
Tests:       39 passed, 39 total
Snapshots:   0 total
Time:        8.336 s
```

| Suite | Resultado | Tests |
|-------|-----------|-------|
| `maquina-estados-descarte-cliente.spec.ts` | PASSED | 15/15 |
| `descartar-consulta-por-cliente.use-case.spec.ts` | PASSED | 24/24 |
| **Total** | **PASSED** | **39/39** |

Cobertura de las suites:
- Transición `{consulta, 2a|2b|2c|2d|2v} → {consulta, 2z}` permitida.
- Rechazo desde terminales (`2x/2y/2z/reserva_cancelada/reserva_completada`) → `null`.
- Happy path por origen (2a, 2b sin/con cola, 2c, 2d con/sin reordenación, 2v sin/con cola).
- Guarda de origen (FA terminal) → `DescarteEstadoTerminalError` (409).
- Reserva no encontrada bajo RLS → `ReservaNoEncontradaDescarteError` (404).
- Motivo opcional propagado/sin motivo.
- Atomicidad/rollback: fallo en paso de UoW propagado.
- Auditoría: desenlace expone par (origen → 2z) por rama.
- Multi-tenancy: tenant y usuario del JWT propagados.

### 2b. Suite de máquina de estados completa (todas las US)

**Comando:**
```
cd apps/api
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand \
  --testPathPatterns "maquina-estados-descarte-cliente|descartar-consulta-por-cliente\.use-case|maquina-estados\.spec|maquina-estados-activar|maquina-estados-alta-con-fecha|maquina-estados-archivado|maquina-estados-confirmar|maquina-estados-editar|maquina-estados-expiracion|maquina-estados-extender|maquina-estados-fianza|maquina-estados-finalizar|maquina-estados-firma|maquina-estados-inicio|maquina-estados-precond|maquina-estados-programar|maquina-estados-promocion|maquina-estados-resultado|maquina-estados-transicion"
```

**Resultado:**
```
Test Suites: 22 passed, 22 total
Tests:       322 passed, 322 total
Time:        13.136 s
```

Todas las suites de máquina de estados (incluyendo las de US anteriores) pasan sin regresión.

### 2c. Suite de frontend afectada (AccionesConsulta)

**Comando:**
```
cd apps/web
npx vitest run --reporter=verbose \
  src/features/reservas/pages/FichaConsulta/components/__tests__/AccionesConsulta.test.tsx
```

**Resultado:**
```
Test Files: 1 passed (1)
Tests:      5 passed (5)
Duration:   8.15s
```

Tests verificados:
- `se_ofrece_en_2b_con_bloqueo_vigente_cuando_no_hay_invitados_introducidos` — PASSED
- `NO_se_ofrece_si_ya_hay_invitados_introducidos` — PASSED
- `tambien_se_oculta_si_hay_solo_ninos_menores_de_4_o_aforo_final` — PASSED
- `es_el_primer_boton_de_accion_de_la_botonera` — PASSED
- `usa_el_verde_del_sistema_de_diseno_token_accent_success` — PASSED

### 2d. Suite completa de frontend (apps/web — pnpm test)

**Comando:**
```
cd apps/web
npx vitest run --reporter=verbose
```

**Resultado:**
```
Test Files: 36 passed (36)
Tests:      213 passed (213)
Duration:   44.92s
```

Sin ningún test fallido. Sin regresión en las 36 suites.

### 2e. Test de concurrencia [requires-real-db] — PENDIENTE

**Suite:** `descartar-consulta-por-cliente-concurrencia.spec.ts`

Marcado `[requires-real-db]`. Esta suite requiere Postgres real y no puede ejecutarse en el entorno del subagente. Debe ejecutarse desde la sesión principal con Postgres activo.

**Estado: PENDIENTE — no ejecutado, no marcado verde.**

---

## 3. Estado de BD (post-ejecución)

Las suites ejecutadas son mockeadas (dominio puro) o usan `slotify_test` aislado. No se realizó ninguna mutación en la BD durante los tests. El estado de BD es idéntico al baseline:

| Tabla | Estado post-test |
|-------|-----------------|
| `reserva` | Sin cambios (1 fila, `s2x`) |
| `fecha_bloqueada` | Sin cambios (0 filas) |

**Restauración: no fue necesaria.**

---

## 4. Notas

- El test de concurrencia (`RC-1/RC-2/RC-3`) está separado en `...concurrencia.spec.ts` por diseño del proyecto. Es el único test no ejecutado y queda pendiente de la sesión principal.
- La suite global `pnpm test` en `apps/api` incluye `pnpm run arch` (depcruise) que requiere Node completo; se optó por ejecutar las suites relevantes con Jest directamente para evitar dependencias de entorno no necesarias para la verificación QA de esta US.
- Flakiness conocida pre-existente no observada: el test de concurrencia US-004 (deadlock 40P01) no aplica a esta ejecución de suites mockeadas.

---

## 5. Outcome

| Suites ejecutadas | Resultado |
|-------------------|-----------|
| 2 suites US-013 (mock, dominio+app) | PASSED (39/39) |
| 22 suites maquina-estados completa (mock) | PASSED (322/322) |
| 1 suite frontend AccionesConsulta (vitest) | PASSED (5/5) |
| 36 suites frontend completas (vitest) | PASSED (213/213) |
| 1 suite concurrencia [requires-real-db] | PENDIENTE |

**Veredicto Step N+1: VERDE en lo ejecutable. PENDIENTE: concurrencia contra Postgres real.**
