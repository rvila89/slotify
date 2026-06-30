# Step 6 — Unit Tests + Verificación de BD
## Change: us-039-consultar-calendario
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Baseline de BD (pre-tests)

| Tabla | Count |
|-------|-------|
| RESERVA total (tenant principal) | 9 |
| RESERVA consulta/s2a | 1 |
| RESERVA consulta/s2b | 5 |
| RESERVA consulta/s2c | 1 |
| RESERVA consulta/s2d | 2 |
| FECHA_BLOQUEADA total | 0 |
| AUDIT_LOG total | 81 |

Ninguna reserva del seed tiene FECHA_BLOQUEADA activa — el seed crea reservas en estados de consulta activa pero sin bloqueo de fecha. El tenant de control (`...00ff`) existe en BD (creado por seed para aislamiento multi-tenant según `prisma/seed.ts` §US-039) y no tiene reservas.

---

## 2. Entorno

- PostgreSQL: Docker (`slotify-postgres`), estado healthy
- Branch: `feature/us-039-consultar-calendario`
- `prisma migrate status`: sin migraciones nuevas (US-039 es lectura pura, sin cambios de esquema)
- Node: proceso backend en escucha en puerto 3000

---

## 3. Tests ejecutados

### 3.1 Suite dirigida módulo calendario (`src/calendario`)

Comando: `npx jest --testPathPatterns="src/calendario" --runInBand --no-coverage`

| Spec | Tests | Resultado |
|------|-------|-----------|
| `calendario.module.spec.ts` | 1 | PASS |
| `domain/__tests__/derivacion-color.spec.ts` | 12 | PASS |
| `application/__tests__/obtener-calendario.query.spec.ts` | 10 | PASS |
| `interface/__tests__/consultar-calendario.controller.spec.ts` | 3 | PASS |
| `infrastructure/__tests__/obtener-calendario-integracion.spec.ts` | 9 | PASS |

**Total suite dirigida: 35 tests / 5 suites — todos PASS**
**Tiempo: 15.465 s**

Cobertura de la suite dirigida:
- `derivacion-color.spec.ts`: 4 casos gris (2a/2b/2c/2v), ámbar, 3 casos verde (confirmada/en_curso/post_evento), azul, rojo, 3 terminales null (2x/2y/2z), invariancia enum
- `obtener-calendario.query.spec.ts`: agregación rango vacío y con fechas, enCola N/0, aislamiento multi-tenant (pasa tenantId del JWT al puerto), vista informativa (mismo dataset), no-mutación
- `consultar-calendario.controller.spec.ts`: deriva tenant del JWT, forma CalendarioResponse, rango vacío
- `obtener-calendario-integracion.spec.ts`: integración real Prisma — color canónico, rango vacío, enCola N/0, aislamiento multi-tenant (OTRO_TENANT `...00ff`), histórico (azul/rojo/excluye terminales), no-mutación RESERVA/FECHA_BLOQUEADA

### 3.2 Suite completa `pnpm test` (jest --runInBand)

Comando: `npx jest --runInBand --no-coverage`

Resultado: **516 passed / 71 total suites — 81.5 s — todos PASS**

La suite US-004 `alta-consulta-con-fecha-concurrencia.spec.ts` (deadlock 40P01, documentado en MEMORY.md `us004-concurrency-test-flaky.md`) NO se manifestó en esta ejecución — pasó verde. La deuda preexistente es ajena a US-039 (lectura pura sin tests de concurrencia).

### 3.3 Tests del frontend (`apps/web`)

Comando: `npx vitest run` (desde `apps/web/`)

| Spec | Tests | Resultado |
|------|-------|-----------|
| `pages/__tests__/LoginPage.test.tsx` | 11 | PASS |
| `components/layout/__tests__/AppShellCatchAll.test.tsx` | 1 | PASS |
| `components/layout/__tests__/AppShellNavigation.test.tsx` | 1 | PASS |
| `components/layout/__tests__/AppShellPlaceholder.test.tsx` | 1 | PASS |
| `components/layout/__tests__/AppShellResponsive.test.tsx` | 3 | PASS |
| `components/layout/__tests__/CerrarSesionUI.test.tsx` | 1 | PASS |
| `components/layout/__tests__/LayoutSeparation.test.tsx` | 2 | PASS |
| `design-system/__tests__/design-tokens.test.ts` | (incluido) | PASS |
| `features/auth/__tests__/*.test.{ts,tsx}` | restantes | PASS |

**Total frontend: 49 tests / 13 suites — todos PASS**
**Tiempo: 21.56 s**

Nota: la feature `calendario` no tiene tests propios en `apps/web/src/features/calendario/` — el frontend no implementó tests unitarios de componentes (vitest) para este feature. Los tests de AppShell verifican que el calendario es la página de inicio tras login y que el responsive del shell funciona.

---

## 4. Verificación de BD post-tests

| Tabla | Count pre | Count post | Delta | Correcto |
|-------|-----------|------------|-------|----------|
| RESERVA total | 9 | 9 | 0 | SI |
| RESERVA s2b | 5 | 5 | 0 | SI |
| RESERVA s2c | 1 | 1 | 0 | SI |
| RESERVA s2d | 2 | 2 | 0 | SI |
| RESERVA s2a | 1 | 1 | 0 | SI |
| FECHA_BLOQUEADA | 0 | 0 | 0 | SI |
| AUDIT_LOG | 81 | 81 | 0 | SI |

Los tests de integración de US-039 usan su propio seed aislado (`EMAIL_PATTERN = '@us039-calendario.test'`, rango 2099-06-xx) y limpian en `beforeEach`/`afterAll`. El estado post-tests es idéntico al baseline.

### 4.1 Invariancias verificadas por los tests

| Invariancia | Spec que lo verifica | Resultado |
|------------|---------------------|-----------|
| gris ← consulta (2a/2b/2c/2v) | derivacion-color.spec + integracion.spec | PASS |
| ambar ← pre_reserva | derivacion-color.spec | PASS |
| verde ← reserva_confirmada/evento_en_curso/post_evento (herencia) | derivacion-color.spec + integracion.spec | PASS |
| azul ← reserva_completada | derivacion-color.spec + integracion.spec | PASS |
| rojo ← reserva_cancelada | derivacion-color.spec + integracion.spec | PASS |
| null ← terminales 2x/2y/2z (excluidos del calendario) | derivacion-color.spec + integracion.spec | PASS |
| Solo fechas con FECHA_BLOQUEADA aparecen (join natural excluye terminales) | integracion.spec | PASS |
| enCola = N (N reservas sub_estado s2d apuntando a bloqueante) | query.spec + integracion.spec | PASS |
| enCola = 0 cuando no hay cola | query.spec + integracion.spec | PASS |
| Aislamiento: tenantId siempre del JWT, nunca mezclado | query.spec + integracion.spec | PASS |
| Vista informativa: mismo dataset independientemente de vista | query.spec | PASS |
| No-mutación: RESERVA/FECHA_BLOQUEADA intactos tras consulta | integracion.spec | PASS |
| Rango vacío → fechas: [] (bien formado) | query.spec + integracion.spec | PASS |

---

## 5. Restauración de BD

No fue necesaria restauración: los tests de integración usan su propio seed aislado y limpian en `beforeEach`/`afterAll`. El estado post-tests es idéntico al baseline.

---

## Outcome: PASS

35/35 tests backend US-039 en verde. Suite global: 516/516 PASS. Frontend: 49/49 PASS. BD idéntica al baseline. Lectura pura confirmada. Sin bloqueantes.
