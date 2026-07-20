# Informe de code-review FINAL (re-revisión del delta) — presupuesto-edicion-reenvio-email-real

- Fecha: 2026-07-20
- Revisor: code-reviewer (solo lectura)
- Base: `master` · Rama: `feature/presupuesto-edicion-reenvio-email-real` (diff sin commitear)
- Alcance de ESTA revisión: DELTA sobre el primer informe APTO (`2026-07-20-code-review.md`).
  Cambios nuevos: (1) persistencia de `pdf_url` (nuevo puerto/adaptador/token + regeneración
  defensiva en reenvío) y (2) limpieza del código muerto `ComunicacionesRepositoryPort` /
  `ComunicacionesPrismaRepository` (los dos hallazgos Media del primer informe).

## Comprobaciones ejecutadas

| Check | Resultado |
|-------|-----------|
| `tsc --noEmit` (apps/api) | OK, sin errores |
| `tsc --noEmit` (apps/web) | OK, sin errores |
| `eslint` sobre los 6 ficheros backend del delta | OK, sin hallazgos |
| Jest unit (editar/generar use-case, reenviar adapter, despachar service, catálogo E2) | 5 suites · 139 tests — PASSED |
| Integración BD real (`editar-reenviar-email-real-integracion.spec.ts`) | NO ejecutada aquí (subagente sin Postgres) — lanzar desde sesión principal |
| Contrato / cliente generado tocados | NINGUNO |

## Delta 1 — Persistencia de `pdf_url`

- **Hexagonal — OK.** El puerto `GuardarPdfUrlPresupuestoPort` es una interfaz declarada en
  `application/generar-presupuesto.use-case.ts` (dominio de aplicación); el adaptador
  `guardar-pdf-url-presupuesto.prisma.adapter.ts` vive en `infrastructure/` e importa
  Prisma/Nest. Sin imports de infra/framework en la capa de aplicación. Inyección OPCIONAL
  (`guardarPdfUrl?`) en `GenerarPresupuestoDeps` y `EditarPresupuestoDeps` (tests sin BD).
- **RLS / multi-tenancy — OK.** El adaptador abre `$transaction`, ejecuta `fijarTenant(tx,
  tenantId)` como PRIMERA operación (SET LOCAL app.tenant_id) y hace `updateMany` con
  `where: { idPresupuesto, tenantId }`. Filtro por `tenant_id` explícito ADEMÁS de RLS —
  más estricto que el espejo `FacturaRepositoryPort.guardarPdfUrl` (que usa `update` por
  PK bajo tx ya tenant-scoped). `tenantId` viene del comando (JWT aguas arriba), no del body.
- **Fuera de la tx crítica — OK.** `persistirPdfUrl` se invoca desde `generarPdfPostCommit`,
  que corre POST-commit (fuera de la UoW que crea la pre_reserva / la versión). Su propio
  `$transaction` es independiente del bloqueo de fecha.
- **Fallo NO propaga — OK.** `persistirPdfUrl` envuelve la llamada en try/catch vacío
  (best-effort): un fallo de persistencia NO revierte la pre_reserva/versión ya comprometida;
  el envío usa la `pdfUrl` en memoria. Test unit `guardarPdfUrl.mockRejectedValueOnce
  ('BD_CAIDA')` verifica que el use-case NO lanza. Solo se persiste si `pdfUrl !== null`
  (tests: llamada 1× en éxito; 0× con pdfUrl null o sin puerto).
- **Reenvío defensivo — OK.** `ReenviarPresupuestoUseCase.resolverPdfVigente` regenera el PDF
  solo si `vigente.pdfUrl === null` y hay puerto `generarPdf` (presupuestos históricos previos
  al fix); regeneración best-effort (try/catch → null, no impide el reenvío). Con `pdfUrl`
  presente lo reutiliza tal cual.
- **Bloqueo de fecha — intacto.** Ninguna ruta nueva toca `FECHA_BLOQUEADA`; sin Redis/lock.
- **Arrow functions / Decimal / `any` — OK.** El adaptador expone `readonly guardar = async
  () => {}` (arrow). Sin `Float` ni `any` en el código nuevo. Comentarios y textos en español.

## Delta 2 — Cleanup de código muerto (doble-registro)

- **Eliminado por completo — OK.** Se borraron la interfaz `ComunicacionesRepositoryPort`, el
  tipo `ReposEditarPresupuesto.comunicaciones`, la clase `ComunicacionesPrismaRepository`
  (que hacía `comunicacion.create` DENTRO de la tx) y su cableado en la UoW
  (`comunicaciones: new ComunicacionesPrismaRepository(tx)`). También se retiraron los imports
  Prisma ya huérfanos (`CodigoEmailPrisma`, `EstadoComunicacionPrisma`) del UoW adapter.
- **Sin referencias colgantes — verificado.** `grep` de `ComunicacionesRepositoryPort` /
  `ComunicacionesPrismaRepository` → 0 resultados. Las apariciones de `registrarE2Reenvio` que
  quedan pertenecen a OTRO puerto vigente (`ReenviarPresupuestoDeps.registrarE2Reenvio`, la
  proyección optimista del reenvío), no al puerto eliminado. `tsc` limpio lo confirma.
- **No se reintroduce el doble-registro — OK.** El bloque in-tx que escribía la fila
  COMUNICACION fue sustituido por comentario D1; la única fila la crea el motor post-commit
  (`despacharReenvio`). El `RegistrarE2ReenvioPresupuestoAdapter` dejó de hacer
  `comunicacion.create` (solo valida RESERVA/CLIENTE bajo RLS y proyecta estado optimista).
- **Tests migrados — OK.** De `expect(repos.comunicaciones.registrarE2Reenvio).not
  .toHaveBeenCalled()` a `expect(repos).not.toHaveProperty('comunicaciones')`: prueba
  estructural de que el puerto ya no existe en la UoW (no solo que no se invoca).

## Re-confirmación de lo vigente del primer informe

- **Primer envío idempotente intacto — OK.** US-014 sigue por `despachar` (idempotente) porque
  `esEdicion` es ausente. Solo edición (`esEdicion=true`, derivada server-side en
  `dispararE2PostCommit`) y reenvío enrutan por `despacharReenvio`. `DispararE2Adapter` bifurca
  con `if (params.esEdicion === true)`.
- **Fuente única de COMUNICACION — OK.** La fila la escribe el motor post-commit; edición y
  reenvío proyectan `idComunicacion:''` optimista sin fila propia. Integración asevera UNA
  fila `es_reenvio=true`.
- **`esEdicion` server-side — OK.** No entra por contrato/body; default `false` en
  `construirVariables` del despachador.
- **Contrato / cliente generado — NO tocados** (grep sin coincidencias en generated/api-spec).
- **Bloqueo de fecha — intacto.**

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Alta
- Ninguno.

### Media
- Ninguno. (Los dos Media del primer informe quedan RESUELTOS: código muerto eliminado; y la
  evidencia E2E existe en `reports/2026-07-20-e2e-playwright.md` + `reports/e2e-screenshots`.)

### Baja
- **[proyección optimista] `idComunicacion: ''`** en la respuesta HTTP de edición/reenvío.
  Igual que en el primer informe: coherente con D1 (la fila real la escribe el motor), shape
  de respuesta sin cambios. Centinela poco expresivo; opcional documentar que el consumidor no
  debe usar ese id. Sin impacto funcional.

## Recordatorio operativo (no bloqueante)
- La suite de integración con BD real (`editar-reenviar-email-real-integracion.spec.ts`) NO se
  ejecuta en este entorno (sin Postgres). Debe lanzarse desde la sesión principal para validar
  contra la base: envío real por transporte, `pdf_url` persistido no nulo, fila única
  `es_reenvio=true` (sin doble registro) e invariante `FECHA_BLOQUEADA.ttl_expiracion`.

## Veredicto

Veredicto: APTO

Sin bloqueantes. El delta (persistencia de `pdf_url` + limpieza del código muerto) es correcto
en hexagonal, RLS, best-effort fuera de la tx crítica y no reintroduce el doble-registro; `tsc`,
`eslint` y 139 tests unit en verde; contrato y cliente generado intactos. Único pendiente
operativo: ejecutar la suite de integración de BD real desde la sesión principal.
