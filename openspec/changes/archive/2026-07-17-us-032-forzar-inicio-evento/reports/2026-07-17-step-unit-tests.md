# Step Unit — Tests unitarios + integración + verificación BD  (2026-07-17)

## Comandos ejecutados
```
# Backend (apps/api) — dominio + use-case + controller HTTP + reuso + integración + concurrencia
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand \
  --testPathPatterns="forzar-inicio-evento|maquina-estados-dia-del-evento"
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand \
  --testPathPatterns="forzar-inicio-evento-concurrencia"
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand \
  --testPathPatterns="forzar-inicio-evento-integracion"
# Frontend (apps/web)
npx vitest run
```

## Resultados
- **Backend — suites US-032 (5)**: `Test Suites: 5 passed`, `Tests: 39 passed`.
  - `maquina-estados-dia-del-evento.spec.ts` — dominio puro `esDiaDelEvento` (matriz ayer/hoy/mañana, blindaje off-by-one TZ).
  - `forzar-inicio-evento.use-case.spec.ts` — happy path, precondiciones múltiples/caso borde, D-5, 422, 409/idempotencia, 404, orden de guardas 404→409→422→409, rama "0 filas bajo el lock" (mock).
  - `forzar-inicio-evento.controller.http.spec.ts` — frontera HTTP real (supertest + ValidationPipe + HttpExceptionFilter): 200 / 401 / 403 / 404 / 409 `conflicto_estado` / 422 `fecha_evento_no_es_hoy`.
  - `forzar-inicio-evento-reuso-dominio.spec.ts` — regresión cero US-031 (reutiliza `resolverInicioEvento`/`preconditionesEventoCumplidas`, sin aristas nuevas).
- **Backend — concurrencia real (Postgres)**: `Tests: 2 passed`.
  - RC-A doble sesión del gestor: exactamente 1 gana (`evento_en_curso`), 1 rechaza `conflicto_estado`, **1 sola** entrada de transición en AUDIT_LOG.
  - RC-B cron (US-031) ↔ gestor (US-032): exactamente 1 transición, sin estado intermedio ni doble auditoría.
- **Backend — integración real (Postgres)** [`forzar-inicio-evento-integracion.spec.ts`, añadido en QA]: `Tests: 4 passed`.
  - D-4: `AUDIT_LOG` con `accion='transicion'`, `entidad='RESERVA'`, `usuario_id` del gestor (origen Usuario), `datos_anteriores={estado:'reserva_confirmada'}`, `datos_nuevos={estado:'evento_en_curso', forzado_por_gestor:true, precondiciones_incumplidas:['liquidacion_status']}`.
  - D-5: tras el forzado, `preEventoStatus`/`liquidacionStatus`/`fianzaStatus` **intactos** (solo muta `estado`).
  - 422 `fecha_evento_no_es_hoy` (fecha ≠ hoy) sin efectos ni auditoría.
  - 409 `conflicto_estado` (reserva ya en `evento_en_curso`) sin doble auditoría.
- **Frontend (apps/web)**: `Test Files: 39 passed`, `Tests: 241 passed` (incluye 28 nuevos de US-032: `lib/forzarInicioEvento` 13, `ForzarInicioEventoDialog` 7, `FichaConsulta/ForzarInicioEvento` 8).

## Comparación BD pre/post
Todas las suites de integración/concurrencia usan `slotify_test_032` (`.env.test`) y limpian su propio sembrado (`beforeEach`/`afterAll` con `deleteMany` por `email LIKE '@us032-*'`).

| tabla | pre | post |
|-------|-----|------|
| reserva (email `@us032-*`) | 0 | 0 (limpiado) |
| cliente (email `@us032-*`) | 0 | 0 (limpiado) |
| audit_log (entidad_id de reservas de prueba) | 0 | 0 (limpiado) |

Nota: `slotify_test_032` requería el seed del tenant piloto (faltaba → FK `cliente_tenant_id_fkey`); se sembró con `DATABASE_URL=<test> pnpm run db:seed` antes de correr las suites de BD.

## Restauración
Automática por los teardown de cada suite (no quedan residuos). El seed del tenant piloto es idempotente (upsert) y forma parte del baseline esperado de la BD de test.

## Outcome
PASS
