# Tasks — us-012-expirar-consulta-ttl

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-012-expirar-consulta-ttl/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-012-expirar-consulta-ttl` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) +
      `design.md` y **ESPERAR su OK explícito**. Puntos de gate a decidir:
      **D-2** (exponer `POST /cron/barrido-expiracion` en el contrato, auth `X-Cron-Token`
      vía `CronTokenGuard`, no JWT) y **D-8** (US-012 solo **dispara** el seam de
      promoción; NO reimplementa A15 — deuda hasta US-018). Usuario aprobó D-2 y D-8 (01/07/2026)
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Definir en `docs/api-spec.yml` el endpoint interno protegido
      `POST /cron/barrido-expiracion` (seguridad `X-Cron-Token`; respuestas 200 con
      resumen `{ candidatas, expiradas, promocionesDisparadas, fallos }`, 401 sin
      token/ token inválido) según `design.md §D-2`
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde (o validación equivalente vía
      `validate-openapi` si spectral no está instalado). Spectral/redocly no instalados:
      validación equivalente = parse YAML + carga OpenAPI por `openapi-typescript` (0
      errores) durante el codegen; hook `validate-openapi` en verde
- [x] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano). Sin
      superficie de usuario: `pnpm generate-client` OK, `tsc --noEmit` (typecheck) en
      verde; el endpoint queda tipado en `schema.d.ts` (no se usa desde UI, lo invoca el
      cron; se genera por coherencia whole-spec)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test del **mapa/guarda declarativos** `resolverExpiracionTtl(estado, subEstado)`:
      `2b/2c/2v → 2x`, `pre_reserva → reserva_cancelada`; terminales
      (`2x/2y/2z/reserva_cancelada/reserva_completada`) y no-candidatos → `null` (en
      rojo) → `__tests__/maquina-estados-expiracion-ttl.spec.ts`
- [x] 3.2 Test del use-case **2.b sin cola**: RESERVA → `2x` + `FECHA_BLOQUEADA`
      liberada (causa TTL) + `AUDIT_LOG accion='transicion'` (`2b→2x`), en una
      transacción; **sin** disparar promoción (en rojo) →
      `__tests__/expirar-consultas.use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.3 Test del use-case **2.b con cola**: además de lo anterior, el seam
      `PromocionColaPort` se invoca **exactamente una vez**; el stub no reordena la cola
      (queda en `2d`) (en rojo)
- [x] 3.4 Test del use-case **2.c** (`2c→2x`, sin promoción posible) y **2.v** con y sin
      cola heredada (promoción solo si hay `2d` apuntándola) (en rojo)
- [x] 3.5 Test del use-case **pre_reserva** (`→ reserva_cancelada`, `sub_estado=NULL`,
      fecha liberada, sin promoción) + `AUDIT_LOG` con
      `datos_anteriores.estado='pre_reserva'` / `datos_nuevos.estado='reserva_cancelada'`
      (en rojo)
- [x] 3.6 Test de **idempotencia**: 2.ª ejecución del barrido sobre RESERVA ya terminal →
      cero cambios, cero auditorías duplicadas; RESERVA candidata con `FECHA_BLOQUEADA`
      ya eliminada → transición a `2x` sin error (DELETE 0 filas éxito silencioso) (en
      rojo)
- [x] 3.7 Test de **TTL extendido antes del barrido** (US-006): tras extensión
      `ttl_expiracion > now()` → RESERVA no seleccionada, sin cambios (en rojo)
- [x] 3.8 Test de **selección por instante** (D-7): la candidatura se decide por
      `ttl_expiracion < now()` (`timestamptz`), no por fecha formateada (blindaje del
      off-by-one de TZ) (en rojo)
- [x] 3.9 Test de **atomicidad / fallo aislado**: fallo en una candidata → rollback solo
      de esa; las demás se expiran; el resumen refleja el fallo aislado (en rojo) →
      `…use-case.spec.ts` + `…-integracion.spec.ts`
- [x] 3.10 **Tests de concurrencia REALES (skill `concurrency-locking`)**: **RC-1** doble
      barrido sobre la misma RESERVA → 1 transición, 0 duplicados; **RC-2** expiración vs
      extensión manual US-006 → exactamente una gana, sin estado intermedio; **RC-3**
      liberación por expiración vs nuevo bloqueo de la misma fecha → nunca doble bloqueo
      (`UNIQUE`) (en rojo) → `__tests__/expirar-consultas-concurrencia.spec.ts`
- [x] 3.11 Test del **endpoint/guard**: `X-Cron-Token` ausente/ inválido → 401; token
      válido → 200 con resumen (en rojo) → `__tests__/barrido-expiracion.controller.spec.ts`
- [x] 3.12 Confirmar que toda la batería está **en rojo** antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de US-041 (`liberar-fecha`, `liberar-fechas-lote`,
      `promocion-cola.stub`), US-006 (extensión/concurrencia) y de la máquina de estados
      afectados por el reuso; confirmar **regresión cero** de la liberación, del lote y
      del seam de promoción; ajustar sin cambiar su comportamiento

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 Máquina de estados: añadir el **mapa declarativo** `MAPA_EXPIRACION_TTL` +
      `resolverExpiracionTtl(estado, subEstado)` (tabla de datos, no `if` dispersos)
      (D-3); reutilizar `EstadoReserva`/`SubEstadoConsulta` existentes
- [x] 5.2 Caso de uso `ExpirarConsultasVencidasService` (aplicación): listar candidatas
      (`ttl_expiracion < now()` AND estados candidatos), y por cada una en su propia
      transacción con `SELECT … FOR UPDATE`: re-evaluar guarda, aplicar transición de
      estado, invocar `liberarFecha()` (US-041) [libera + audita + dispara seam], agregar
      resumen con fallo aislado (D-4/D-9); reutilizar la semántica de
      `LiberarFechasEnLoteService`
- [x] 5.3 Infra: adaptador Prisma para listar candidatas + UoW de transición (patrón
      `$transaction` + `SET LOCAL app.tenant_id` + `$queryRaw`/`$executeRaw`, cross-tenant
      read / RLS write, D-6); `AuditLogPort` para la transición (`accion='transicion'`,
      `entidad='RESERVA'`) sin duplicar la auditoría de la liberación
- [x] 5.4 `CronTokenGuard` (compara `X-Cron-Token` con `CRON_TOKEN`, 401 si no coincide;
      NO usa JWT) + controller `POST /cron/barrido-expiracion` que invoca el use-case y
      devuelve el resumen; provider `@Cron` (`@nestjs/schedule`) que llama al endpoint con
      el token (D-1/D-2). Registrar en `reservas.module.ts` (o módulo `cron` dedicado)
- [x] 5.5 Registro del evento para la **alerta interna** al gestor (mínimo; superficie de
      notificaciones es US-044) (D-10). Sin email al cliente (fuera de MVP)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts/estado de `reserva`, `fecha_bloqueada`,
      `audit_log`; incluir varias candidatas en `2b`/`2c`/`2v`/`pre_reserva`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real
      RC-1/RC-2/RC-3)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`); anotar el flaky conocido de US-004
      (`40P01`) si aparece, sin atribuirlo a este change
- [x] 6.4 Verificar estado posterior de BD (candidatas → `2x`/`reserva_cancelada`;
      `FECHA_BLOQUEADA` de las expiradas eliminada; `AUDIT_LOG transicion` +
      `eliminar/TTL`; RESERVA no candidatas intactas) y restaurar si hace falta
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend; sembrar RESERVA candidatas (`2b` sin/con cola, `2c`, `2v`
      con/sin cola heredada, `pre_reserva`) con `ttl_expiracion < now()`
- [x] 7.2 POST `/cron/barrido-expiracion` con `X-Cron-Token` válido → 200 + resumen;
      verificar transiciones (`2x`/`reserva_cancelada`), `FECHA_BLOQUEADA` liberada,
      `AUDIT_LOG`, seam de promoción disparado solo donde hay cola. Restaurar BD
- [x] 7.3 POST **idempotente**: repetir el barrido → segunda respuesta sin nuevas
      expiraciones ni auditorías duplicadas. Restaurar BD
- [x] 7.4 POST sin `X-Cron-Token` o con token inválido → 401; ninguna expiración
- [x] 7.5 POST tras extender el TTL de una candidata (US-006) → esa RESERVA no expira
- [x] 7.6 Verificar que el formato de error/response coincide con el contrato OpenAPI
- [x] 7.7 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (step-N+3 — NO APLICA: sin frontend — EL AGENTE DEBE JUSTIFICARLO)
- [x] 8.1 US-012 no introduce UI propia (actor Sistema). Dejar report de N/A
      `reports/YYYY-MM-DD-step-N+3-e2e-playwright-NA.md` justificando la exención (el
      único efecto visible en UI —fecha liberada en el Calendario US-039— se verifica
      indirectamente en curl/unit); opcionalmente comprobar en el Calendario que la fecha
      expirada vuelve a aparecer disponible

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas: capability `consultas` (flujo de expiración por TTL,
      mapa terminal declarativo, cron+endpoint protegido, cross-tenant read/RLS write,
      idempotencia, seam de promoción y deuda US-018), `architecture.md §2.5` (patrón
      estado en fila + barrido, `CronTokenGuard`, `@nestjs/schedule`), trazabilidad de la
      US (`use-cases.md` UC-09, `er-diagram.md §3.6/§5.3`). Registrar la **deuda US-018**
      (promoción real) y el **off-by-one de TZ** (D-7, change aparte). Contrato solo lo
      del `contract-engineer`; sin migración de esquema

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, sin bloqueo
      distribuido, sin editar cliente generado, patrón async-jobs, mapa terminal
      declarativo, atomicidad por RESERVA + fallo aislado, idempotencia, exactamente-una-
      vez de la promoción vía seam, comparación por instante (no fecha formateada),
      cross-tenant read con RLS write, guard `X-Cron-Token`)
- [x] 10.2 Dejar informe `reports/2026-07-01-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR (OK humano recibido 01/07/2026)

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [x] 12.1 `openspec archive us-012-expirar-consulta-ttl` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin APTO). Archivado como
      `2026-07-01-us-012-expirar-consulta-ttl` (01/07/2026)
- [x] 12.2 Actualizar `openspec/specs/` (capability `consultas` actualizada, +13 requisitos
      de expiración por TTL). PR: pendiente del humano (fuera del alcance de este paso)
