# Tasks — presupuesto-edicion-reenvio-email-real

> Pasos obligatorios del harness (SDD + TDD), en orden. El AGENTE ejecuta él mismo todas
> las pruebas (unit, curl, E2E); NUNCA las delega en el usuario. Cada `[x]` se marca solo
> tras ejecutar y verificar. Los tests de integración/concurrencia con BD real se lanzan
> desde la sesión principal (los subagentes QA no tienen Postgres).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Branch `feature/presupuesto-edicion-reenvio-email-real` creada y checkouteada
      en el worktree `slotify-presupuesto-edicion-reenvio-email-real` (ya hecho)
- [ ] 0.2 Verificar la branch activa antes de cualquier escritura de código

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano proposal + spec-delta + design; ESPERAR OK explícito
- [ ] 1.2 Resolver D1/D2/D3 con el humano y reflejar la resolución en `design.md`
      (tabla "Resumen de decisiones al gate"):
      D1 = fuente única post-commit vs patch de la fila tx + proyección `comunicacion`;
      D2 = propagación de `esEdicion` derivado en servidor + reenvío sin marca de edición;
      D3 = prefill `numAdultosNinosMayores4` + `duracionHoras` acotada {4,8,12}/fallback 4
- [ ] 1.3 NO avanzar a contrato/TDD/implementación hasta el OK

## 2. Contrato OpenAPI + SDK (post-gate — dueño: contract-engineer)
- [ ] 2.1 Verificar que `/presupuesto/edicion` y `/presupuesto/reenvio` NO requieren
      cambios (`esEdicion` es server-side; sin endpoints nuevos)
- [ ] 2.2 Si D1 obliga a ajustar la proyección `EdicionPresupuestoResponse.comunicacion`,
      aplicarlo en `docs/api-spec.yml` (no rompedor) y `spectral lint` OK; regenerar el
      SDK (nunca a mano). Si no hay cambio, dejar constancia de que el contrato queda igual

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 3.1 Unit plantilla E2 con `esEdicion`: `renderE2`/`renderE2Ca` con `esEdicion=true`
      → asunto "Hemos actualizado…"/"Hem actualitzat…" + párrafo tras el saludo; con
      `esEdicion=false`/ausente → texto E2 estándar; `variablesRequeridas` sigue
      `['nombre','codigoReserva']`
      → `apps/api/src/comunicaciones/infrastructure/plantillas/catalogo-plantillas-e2.spec.ts`
      (RED verificado: 4 casos de marca fallan por render que ignora `esEdicion`)
- [x] 3.2 Unit use-case edición: el envío enruta por `despacharReenvio` (NO `despachar`
      idempotente) y persiste **una única** `COMUNICACION` E2 (`es_reenvio=true`), sin
      fila duplicada en la transacción; propaga `esEdicion=true` hasta el render
      → `apps/api/src/presupuestos/__tests__/editar-presupuesto.use-case.spec.ts`
      (RED verificado: `NO_debe_registrar…tx` + `esEdicion=true` en el disparo fallan;
      resto del spec en verde) + motor `despachar-email.service.spec.ts`
      (propagación de `esEdicion` a `construirVariables` → RED)
- [x] 3.3 Unit reenvío sin cambios: el adaptador DEJA DE SER no-op — invoca el motor
      (`despacharReenvio`), una única `COMUNICACION` E2, texto estándar (sin marca)
      → `apps/api/src/presupuestos/infrastructure/__tests__/reenviar-presupuesto.prisma.adapter.spec.ts`
      (RED verificado: el stub no invoca `despacharReenvio`)
- [x] 3.4 **Test de INTEGRACIÓN con BD real + `EMAIL_SANDBOX=true`** que verifica que el
      **transporte se invoca de verdad** en edición y en reenvío (fake transport/spy con
      conteo de invocaciones) y que existe exactamente UNA fila `COMUNICACION` E2 nueva
      por envío. CLAVE: el stub sobrevivió por falta de este test real.
      → `apps/api/src/presupuestos/__tests__/editar-reenviar-email-real-integracion.spec.ts`
      (ESCRITO y compila; PENDIENTE de correr desde la sesión principal — sin Postgres)
- [x] 3.5 Confirmar que la suite queda en ROJO (RED) antes de implementar (motivo del
      fallo: registro en la tx + `esEdicion` inexistente en render/variables + stub del
      reenvío + prefill frontend inexistente). Unit API + frontend verificados en RED en
      el worktree; integración pendiente de sesión principal

## 4. Backend: implementación + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)
- [x] 4.1 Implementar: re-cableado del envío de edición y reenvío a `despacharReenvio`;
      propagar `esEdicion` (use-case → adaptador disparo → `DespacharEmailComando`/
      `construirVariables` → `render`); reconciliar la fila `COMUNICACION` (eliminar/ajustar
      `registrarE2Reenvio` de la tx según D1); ampliar `renderE2`/`renderE2Ca`
      (GREEN: 4 suites dirigidas 100/100; comunicaciones+presupuestos 345/345; tsc+lint OK)
- [x] 4.2 Revisar/ajustar tests de `presupuestos`/`comunicaciones` afectados por el
      cambio de camino (idempotencia → reenvío) y dobles/puertos del motor
      (sin regresiones: 36 suites verdes salvo la de integración, pendiente de sesión principal)
- [x] 4.3 Persistir `pdf_url` del PRESUPUESTO (fix reenvío, Opción A): puerto nuevo
      `GuardarPdfUrlPresupuestoPort` + token `GUARDAR_PDF_URL_PRESUPUESTO_PORT` + adaptador
      Prisma `GuardarPdfUrlPresupuestoPrismaAdapter` (`updateMany` bajo `fijarTenant`).
      Inyectado (dep opcional) en `GenerarPresupuestoUseCase` y `EditarPresupuestoUseCase`;
      llamada best-effort en `generarPdfPostCommit` cuando la URL no es nula (no bloqueante,
      fuera de la tx crítica). Reenvío defensivo: `ReenviarPresupuestoUseCase` regenera el
      PDF del vigente si `pdf_url` sigue null (histórico). Cableado en `presupuestos.module.ts`.
      Cobertura unit añadida (persiste con URL / no persiste con null / fallo no propaga /
      reenvío regenera). GREEN: 359/359 en `src/presupuestos src/comunicaciones`; tsc+lint OK
- [x] 4.4 Cleanup code-review (deuda D1): eliminado el código muerto del doble-registro —
      puerto `ComunicacionesRepositoryPort`, campo `ReposEditarPresupuesto.comunicaciones` y
      clase `ComunicacionesPrismaRepository` (con su `comunicacion.create` en la tx) + su
      cableado en la UoW de edición. Tests que lo referenciaban (`not.toHaveBeenCalled()`)
      sustituidos por la garantía equivalente `expect(repos).not.toHaveProperty('comunicaciones')`.
      Grep confirma que nada más lo usa

## 5. Frontend: implementación (prefill + scroll)
- [x] 5.1 Prefill del diálogo de edición: invitados = `reserva.numAdultosNinosMayores4`;
      duración = `reserva.duracionHoras` acotada {4,8,12} (fallback 4)
      (props `invitadosIniciales`/`duracionInicial` en `EditarPresupuestoDialog`, usadas
      en `defaultValues` + `reset()` al abrir; helper `acotarDuracionInicial` en `lib/edicion.ts`;
      cableado en `DialogosFicha.tsx` desde `reserva.numAdultosNinosMayores4`/`duracionHoras`)
- [x] 5.2 Scroll-to-top al enviar edición y al reenviar sin cambios (patrón de generar
      presupuesto de US-014); banner de éxito visible
      (`onEditadoPresupuesto`/`onReenviadoPresupuesto` en `FichaConsultaPage.tsx` → `window.scrollTo`)
- [x] 5.3 Tests de frontend afectados (schema/dialog) actualizados/en verde
      (`EditarPresupuestoDialog.prefill.test.tsx` — 4/4 en VERDE; `tsc --noEmit` limpio;
      `pnpm --filter web lint` exit 0; `api-client/` no tocado)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [ ] 6.1 Capturar baseline de BD (`COMUNICACION`, `PRESUPUESTO`, `AUDIT_LOG`,
      `RESERVA.estado`, `FECHA_BLOQUEADA.ttl_expiracion`)
- [ ] 6.2 Ejecutar tests dirigidos (unit E2 plantilla, use-case edición, reenvío) +
      integración con BD real y `EMAIL_SANDBOX` (transporte invocado, fila única)
- [ ] 6.3 Verificar estado posterior de BD: una única `COMUNICACION` E2 por envío;
      `RESERVA.estado`/`ttl_expiracion` inalterados
- [ ] 6.4 Report `.../reports/2026-07-20-step-N+1-unit-test-and-db-verification.md`
- [ ] 6.5 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [ ] 7.1 Levantar el backend (BD real, RESERVA en pre_reserva + PRESUPUESTO v1)
- [ ] 7.2 `POST .../presupuesto/edicion` con `enviar=true`: verificar en logs/sandbox que
      el proveedor se invoca, `COMUNICACION` E2 única (`es_reenvio=true`, `estado=enviado`),
      asunto "Hemos actualizado…" y párrafo de edición
- [ ] 7.3 `POST .../presupuesto/reenvio`: proveedor invocado, `COMUNICACION` E2 única,
      texto E2 estándar (sin marca de edición), no crea versión nueva
- [ ] 7.4 Idioma CA: verificar asunto/párrafo catalanes cuando el tenant/idioma es `ca`
- [ ] 7.5 Verificar: `RESERVA.estado` y `FECHA_BLOQUEADA.ttl_expiracion` no cambian;
      restaurar BD al estado previo
- [ ] 7.6 Report `.../reports/2026-07-20-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [ ] 8.1 Stack levantado (web + api); BD en estado conocido (baseline capturado)
- [ ] 8.2 Flujo edición: login, ficha pre_reserva, abrir diálogo → verificar **prefill**
      de invitados y duración; enviar al cliente → verificar **scroll-to-top** y banner
      de éxito visible
- [ ] 8.3 Flujo reenvío sin cambios: confirmar y verificar banner + no crea versión
- [ ] 8.4 Verificar en 3 viewports (390 / 768 / 1280): sin overflow, diálogo usable,
      banner visible tras el scroll
- [ ] 8.5 Verificar persistencia: `RESERVA.estado=pre_reserva` y `ttl` inalterados
- [ ] 8.6 Capturas movidas a `.../reports/e2e-screenshots/` (no en la raíz) y report
      `.../reports/2026-07-20-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [ ] 9.1 Actualizar `docs/` afectada: UC-15 (envío real del E2 en edición/reenvío,
      fuente única de `COMUNICACION`), tabla de emails E2 (variante "presupuesto
      actualizado" con `esEdicion`), nota de corrección del stub/idempotencia
- [ ] 9.2 Reflejar la resolución de D1 (proyección `comunicacion`) si el contrato cambió

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 10.1 `code-reviewer` sobre el diff (guardrails hexagonal, no-distributed-lock,
      arrow functions, responsive, componentes/lib)
- [ ] 10.2 Informe `.../reports/2026-07-20-step-review-code-review.md` con
      `Veredicto: APTO`

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Tras code-review APTO + validación manual, ESPERAR el OK humano ANTES de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 12.1 `openspec archive presupuesto-edicion-reenvio-email-real` (solo tras gate
      final y APTO); actualizar `openspec/specs/presupuestos/`; abrir PR
