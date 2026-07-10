# Step N+1 — Unit Tests + Verificación de BD (2026-07-10)

Change: `us-037-archivado-automatico-reserva-completada`
Ejecutado por: `qa-verifier` (sesión sin Postgres)

---

## 1. Alcance de este step

### 1a. Tests sin Postgres (ejecutados por este agente)

Cuatro ficheros que no requieren BD — ejecutables en cualquier entorno:

| Fichero | Descripción | Tests |
|---------|-------------|-------|
| `maquina-estados-archivado-automatico.spec.ts` | Guarda de origen declarativa (`resolverArchivadoAutomatico`, `MAPA_ARCHIVADO_AUTOMATICO`): `post_evento → reserva_completada`; filtro de estados; sub-estados consulta; terminalidad de `reserva_completada`; determinismo. | 20 |
| `maquina-estados-fianza-resuelta.spec.ts` | Guarda pura de fianza (`fianzaResuelta`): status resolutivos; retención total; sin fianza (eur=0/null); pendiente con FA-01; determinismo. | 18 |
| `archivar-reservas-completadas.use-case.spec.ts` | Caso de uso con dobles de puertos in-memory: happy path (4.3); sin fianza (4.4); retención total (4.5); FA-01 (4.6); anti-duplicación (4.7); idempotencia bajo lock (4.10); múltiples reservas mixtas (4.11); fallo aislado (4.12); cross-tenant read; resumen vacío. | 13 |
| `barrido-completadas.controller.spec.ts` | Frontera HTTP: 200 con token válido; 401 sin token; 401 token incorrecto; 401 JWT bearer en lugar de X-Cron-Token. Guard `CronTokenGuard` real. | 4 |

**Total no-Postgres: 55 tests**

### 1b. Tests con Postgres (verificados por la sesión principal)

Dos ficheros que requieren BD real — **NO ejecutados por este agente** (memoria del proyecto: "Subagentes sin Docker/Postgres"):

| Fichero | Tests |
|---------|-------|
| `archivar-reservas-completadas-integracion.spec.ts` | 17 |
| `archivar-reservas-completadas-concurrencia.spec.ts` | 2 |

**Total Postgres: 19 tests — verificados por la sesión principal contra `slotify_test`.**

---

## 2. Comandos ejecutados (tests sin Postgres)

```
cd apps/api
npx jest --runInBand --no-coverage \
  "src/reservas/__tests__/maquina-estados-archivado-automatico.spec.ts" \
  "src/reservas/__tests__/maquina-estados-fianza-resuelta.spec.ts" \
  "src/reservas/__tests__/archivar-reservas-completadas.use-case.spec.ts" \
  "src/reservas/__tests__/barrido-completadas.controller.spec.ts"
```

Tiempo de ejecución: ~8-9 s.

---

## 3. Resultados — tests sin Postgres

```
Test Suites: 4 passed, 4 total
Tests:       55 passed, 55 total
Snapshots:   0 total
Time:        8.65 s
```

Nota: el test `debe_archivar_las_demas_aunque_una_lance_y_reflejar_el_fallo_aislado` (4.12)
produce un `console.error` de NestJS Logger durante la ejecución. Es el comportamiento
correcto: el servicio registra el fallo aislado en el logger antes de continuar con las
demás candidatas. No es un error del test.

### Detalle por suite

**`maquina-estados-archivado-automatico.spec.ts` — 20/20 passed**

| Suite | Tests |
|-------|-------|
| resolverArchivadoAutomatico — post_evento archiva a reserva_completada | 1 |
| resolverArchivadoAutomatico — el resto de estados principales NO son candidatos (null) | 7 |
| resolverArchivadoAutomatico — sub-estados de consulta NO archivan (null) | 8 |
| resolverArchivadoAutomatico — reserva_completada es terminal (sin salida) | 2 |
| resolverArchivadoAutomatico — determinismo y forma de la tabla declarativa | 2 |

Casos cubiertos: única arista `post_evento → reserva_completada`; 6 estados principales no
candidatos; sub-estado espurio en `post_evento` devuelve null; 8 sub-estados de consulta
devuelven null; `reserva_completada` sin salida; tabla declarativa con exactamente 1 entrada.

**`maquina-estados-fianza-resuelta.spec.ts` — 18/18 passed**

| Suite | Tests |
|-------|-------|
| fianzaResuelta — status resolutivo con importe > 0 | 2 |
| fianzaResuelta — retención total (retenida_parcial) es estado resuelto | 1 |
| fianzaResuelta — sin fianza (eur<=0 o null) satisface la guarda sin mirar el status | 12 |
| fianzaResuelta — status no resolutivo con importe > 0 está PENDIENTE (FA-01) | 3 (x cobrada/pendiente/recibo_enviado) |
| fianzaResuelta — determinismo (función pura) | 1 |

Matriz completa `fianzaStatus × fianzaEur` verificada (5 status × eur=0/null/positivo = 15
combinaciones; 3 pendientes con eur>0 devuelven `{resuelta:false, pendiente:true}`).

**`archivar-reservas-completadas.use-case.spec.ts` — 13/13 passed**

| Suite | Test |
|-------|------|
| 4.3 happy path fianza devuelta | 2 |
| 4.4 sin fianza archiva | 2 |
| 4.5 retención total archiva | 1 |
| 4.6 FA-01 fianza pendiente alerta | 1 |
| 4.7 anti-duplicación de la alerta | 2 |
| 4.10 idempotencia bajo lock | 1 |
| 4.11 múltiples reservas mixtas | 1 |
| 4.12 fallo aislado por RESERVA | 1 |
| cross-tenant read y resumen vacío | 2 |

**`barrido-completadas.controller.spec.ts` — 4/4 passed**

| Test | HTTP observado |
|------|----------------|
| Token válido (X-Cron-Token correcto) | 200 + body `{candidatas,archivadas,fianzaPendiente,fallos}` |
| Sin cabecera X-Cron-Token | 401 |
| Token incorrecto | 401 |
| JWT Bearer en lugar de X-Cron-Token | 401 |

---

## 4. Resultados — tests con Postgres (verificados por la sesión principal)

**Verificado por la sesión principal (harness-orchestrator) contra `slotify_test`.**
Este agente no los re-ejecutó (sin Postgres disponible).

### Comando exacto para reproducir

```bash
cd apps/api && DATABASE_URL=postgresql://user:password@localhost:5432/slotify_test \
  npx jest --runInBand \
  src/reservas/__tests__/archivar-reservas-completadas-integracion.spec.ts \
  src/reservas/__tests__/archivar-reservas-completadas-concurrencia.spec.ts
```

### Resultado comunicado

```
Test Suites: 2 passed, 2 total
Tests:       19 passed, 19 total
```

- `archivar-reservas-completadas-integracion.spec.ts`: **17 passed**
- `archivar-reservas-completadas-concurrencia.spec.ts`: **2 passed** (RC-1, RC-2)

### Bugs detectados y corregidos durante la ejecución contra BD real

Dos bugs ocultos que los tests unitarios (con dobles) no podían detectar; emergieron
exclusivamente contra Postgres:

**Bug 1 — Alerta FA-01 fallaba por RLS al escribir `audit_log` sin fijar tenant**

- Síntoma: el adaptador de la alerta (`AlertaFianzaPendientePort`) intentaba insertar
  en `audit_log` sin ejecutar `SET LOCAL app.tenant_id` como primera operación de su
  transacción, por lo que RLS bloqueaba la escritura.
- Fix: el adaptador de la alerta ya pasa por `fijarTenant(tx, tenantId)` como primera
  operación de la transacción antes de insertar la entrada `fianza_pendiente_t7d`,
  igual que el adaptador principal de archivado.

**Bug 2 — `$queryRaw` de `debeEmitir` referenciaba columna inexistente `fecha`**

- Síntoma: la consulta de anti-duplicación (D-4=4.2) usaba `fecha` como nombre de columna
  en la cláusula `WHERE`, pero la columna real en `audit_log` es `fecha_creacion`.
- Fix: la consulta SQL fue corregida para usar `fecha_creacion` en lugar de `fecha`.

Ambos bugs fueron corregidos por `backend-developer` y la suite Postgres re-verificada
19/19 verde.

---

## 5. Comparación de estado de BD (pre/post)

Los tests sin Postgres no tocan la BD. No hay mutación que registrar.

Los tests de integración/concurrencia (sesión principal) siembran sus propios datos con
el patrón `@us037-int.test` / `@us037-conc.test` y los eliminan en `afterAll`. La
sesión principal confirmó restauración completa tras la ejecución.

| tabla | pre (agente QA) | post (agente QA) | mutación |
|-------|-----------------|------------------|----------|
| reservas | n/a (sin BD) | n/a | ninguna |
| audit_log | n/a (sin BD) | n/a | ninguna |
| fecha_bloqueada | n/a (sin BD) | n/a | ninguna |

### Estado esperado en BD tras un barrido real (verificado por tests de integración)

Los tests de integración validaron los efectos exactos que un barrido produce:

- **Transición archivada**: `RESERVA.estado` pasa de `post_evento` a `reserva_completada`.
- **AUDIT_LOG — entrada de transición**: `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores = {"estado":"post_evento"}`,
  `datos_nuevos = {"estado":"reserva_completada","causa":"T+7d"}`,
  `usuario_id = null` (actor Sistema), `canal_entrada = null`.
- **AUDIT_LOG — alerta FA-01**: cuando la fianza no está resuelta, se inserta una entrada
  con `tipo = 'fianza_pendiente_t7d'` (en `datos_nuevos`), `usuario_id = null`, sin
  transicionar la RESERVA.
- **Anti-duplicación (D-4=4.2)**: en un segundo barrido sobre la misma RESERVA con fianza
  pendiente sin cambios en `fianza_status`/`fianza_eur`, no se inserta una segunda alerta.
- **Idempotencia (FA-02)**: una RESERVA ya en `reserva_completada` no genera ninguna fila
  nueva en `audit_log` y no modifica `estado`.
- **Fallo aislado**: si una candidata falla, las demás se archivan; el `audit_log` refleja
  solo las transiciones que sí se completaron.

---

## 6. Restauración

No aplica para los tests sin Postgres (ninguna mutación de BD).
Los tests de integración/concurrencia (sesión principal) limpian sus datos en `afterAll`.

---

## Outcome

**PASS** — Los 55 tests no-Postgres verificados en verde por este agente.
Los 19 tests Postgres verificados en verde por la sesión principal (19/19, 2 bugs
corregidos antes de la verificación final).

**Total combinado: 74 tests verdes (0 fallos, 0 skipped).**

Pendiente de ejecución HTTP real: ver Step N+2 (curl).
