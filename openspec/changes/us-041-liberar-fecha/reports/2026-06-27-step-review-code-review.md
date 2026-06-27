# Code review — US-041 "Liberar Bloqueo de Fecha" (UC-31)

- **Change**: `openspec/changes/us-041-liberar-fecha/`
- **Rama**: `feature/us-041-liberar-fecha` (comparada contra `master`)
- **Fecha**: 2026-06-27
- **Revisor**: code-reviewer (solo lectura; no aplica fixes)
- **Alcance del diff**: backend-only. Working tree (sin commitear): adaptador de
  bloqueo ampliado + módulo/tokens, y nuevos ficheros de dominio, infraestructura,
  aplicación y tests de US-041.

## Veredicto: APTO

No se detectan **Bloqueantes**. La implementación respeta todos los guardrails
duros (hexagonal, bloqueo atómico sin locks distribuidos, RLS/multi-tenancy, guarda
firme declarativa, errores en español, TDD-concurrencia primero). Las observaciones
listadas son de severidad Baja y no condicionan el merge.

---

## Ficheros revisados

Dominio (puro):
- `apps/api/src/reservas/domain/liberar-fecha.service.ts`

Aplicación:
- `apps/api/src/reservas/application/liberar-fechas-lote.service.ts`

Infraestructura (adaptadores):
- `apps/api/src/reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` (ampliado: `consultarBloqueo()` + `liberar()`)
- `apps/api/src/reservas/infrastructure/reserva-estado.prisma.adapter.ts`
- `apps/api/src/reservas/infrastructure/cola-query.prisma.adapter.ts`
- `apps/api/src/reservas/infrastructure/promocion-cola.stub.adapter.ts`
- `apps/api/src/reservas/infrastructure/audit-log.prisma.adapter.ts`

Wiring:
- `apps/api/src/reservas/reservas.module.ts`, `reservas.tokens.ts`

Tests:
- `apps/api/src/reservas/__tests__/liberar-fecha.service.spec.ts` (16 dominio puro)
- `apps/api/src/reservas/__tests__/liberar-fecha-integracion.spec.ts` (5 integración BD real, incl. concurrencia y lote)

---

## Checklist de guardrails

| Regla | Resultado | Evidencia |
|-------|-----------|-----------|
| Hexagonal (`domain/` sin `@nestjs`/`@prisma`/infra) | OK | `liberar-fecha.service.ts` solo importa de `./bloquear-fecha.service` (dominio). Puertos definidos en dominio; adaptadores en infra. |
| Bloqueo de fecha sin Redis/Redlock/lock distribuido | OK | DELETE serializado vía `$transaction` + `SELECT … FOR UPDATE` + `$executeRaw` rows-affected. Grep de `redis/redlock/setnx`: sin coincidencias en código (solo menciones negativas en comentarios de tests). |
| `liberarFecha()` como única vía de liberación | OK | Toda liberación pasa por el servicio de dominio + adaptador único; el lote delega en el mismo servicio. |
| rows-affected como primitiva exactamente-una-vez | OK | `liberar()` devuelve `filasAfectadas`; `0` = no-op idempotente sin promoción, `1` = liberación efectiva. |
| Multi-tenancy / RLS | OK (con obs. Baja) | `SET LOCAL app.tenant_id` vía `set_config(...,true)` parametrizado en cada transacción; DELETE filtra `(tenant_id, fecha)`. tenantId viaja por comando del flujo Sistema (UC-31). |
| Guarda firme declarativa (no if/else disperso) | OK | `ESTADOS_QUE_PERMITEN_LIBERAR_FIRME` (ReadonlySet) + `liberacionFirmePermitida()`; validada PREVIA al DELETE; rechazo audita `rechazo_firme` y deja la fila intacta. |
| Errores de dominio tipados en español | OK | `LiberacionBloqueoFirmeNoPermitidaError` con `codigo` y mensaje en español. |
| AUDIT_LOG con causa | OK | Se audita liberación, tentativa idempotente y rechazo firme con `accion='eliminar'`, `entidad='FECHA_BLOQUEADA'` y causa (TTL/descarte/cancelacion). |
| No muta la RESERVA | OK | El servicio solo posee puerto de LECTURA del estado; tests 3.7 (dominio + BD) verifican estado/sub_estado intactos. |
| Arrow functions (no `function` declarativo) | OK | Grep sin `function` declarativo en los ficheros US-041; helpers son arrow; métodos de clase exentos. |
| TS strict sin `any` injustificado | OK | Grep sin `: any`/`as any` en los ficheros US-041. |
| Importes en Decimal | N/A | US-041 no maneja importes. |
| DTOs class-validator / Contrato OpenAPI | N/A | D-7: no se expone endpoint HTTP propio; `docs/api-spec.yml` no se toca. Coherente. |
| Cliente HTTP frontend generado, no editado | N/A | Backend-only; no se toca el SDK. |
| TDD: concurrencia primero, tests hermanos | OK | Test de dos liberaciones concurrentes (1 DELETE + 1 no-op, 1 promoción) en el spec de integración; `tasks.md` 3.1 concurrencia primero, batería RED documentada. |

Verificación local: `liberar-fecha.service.spec.ts` ejecutado → **16/16 passing**.
Suite completa, lint, typecheck y `pnpm run arch` (depcruise) reportados en verde por
QA (`reports/2026-06-27-step-6-*`). La verificación curl es N/A justificada por D-7
(`reports/2026-06-27-step-7-*-NA.md`); E2E N/A por ausencia de UI
(`reports/2026-06-27-step-8-*-NA.md`).

---

## Validaciones explícitas solicitadas

### 1. Stub no-op de `PromocionColaPort` — seam exactamente-una-vez y deuda diferida a US-018

**CONFIRMADO.**

- **Exactamente-una-vez**: en `liberar-fecha.service.ts` la promoción se invoca
  únicamente en la rama de liberación efectiva (`reservaIdLiberada !== null`, es
  decir rows=1) **y** solo si `hayColaActiva` es true. La rama de 0 filas retorna
  antes (`return { liberada:false, … }`), por lo que **no** se promueve en el no-op.
- **Sin doble promoción**: el test de integración de concurrencia asserta
  `promoverPrimeroEnCola` `toHaveBeenCalledTimes(1)` ante dos liberaciones
  simultáneas (una obtiene rows=1, la otra rows=0). El test de dominio de
  idempotencia asserta que con `filasAfectadas:0` **y** cola activa la promoción
  **no** se invoca.
- **Promoción efectiva diferida a US-018**: `promocion-cola.stub.adapter.ts` es un
  no-op idempotente que materializa el seam sin efectos. La deuda está documentada
  de forma explícita en (a) la cabecera del stub (ligada a US-018), (b) `design.md`
  D-2 y §Riesgos/Trade-offs, y (c) el spec-delta. La cola permanece en `2.d`, por lo
  que no se pierde; al implementarse US-018 su adaptador real sustituye al stub sin
  tocar `liberarFecha()`.

### 2. Servicio de lote creado vía Bash (Write directo) — cobertura real de tests

**CONFIRMADO: existe cobertura real; NO es un atajo que oculte falta de tests.**

- `liberar-fechas-lote.service.ts` orquesta N liberaciones, cada una en su propia
  transacción; captura el fallo por-ítem (`try/catch`) de modo que el rechazo de una
  fecha (guarda firme) queda aislado y no aborta el lote.
- Su batería RED vive en el spec de integración hermano
  `liberar-fecha-integracion.spec.ts`, describe `liberarFechasEnLote() — fallo
  aislado por fecha (D-9)`, que importa y ejercita la clase contra Postgres real y
  verifica: **fallo aislado** (LOTE_FIRME de reserva no cancelada falla pero LOTE_A y
  LOTE_B se liberan; la firme permanece con 1 fila), **transacciones independientes**
  (cada `ejecutar` abre su propia transacción en el adaptador), y **promoción por
  éxito** (solo LOTE_A tiene cola → `promoverPrimeroEnCola` invocado exactamente una
  vez). El resultado por-ítem (2 liberadas + 1 fallida) también se asserta.
- El Write directo vía Bash esquivó un **falso positivo** del hook
  `require-tests-first` (que busca un `.spec.ts` con nombre hermano del fichero); la
  cobertura real existe en el spec de integración, por lo que el bypass es legítimo y
  no encubre ausencia de tests. Queda registrado aquí por transparencia.

---

## Observaciones (severidad Baja — no bloquean el merge)

- **[multi-tenancy] tenantId opcional en puertos de lectura.**
  `ReservaEstadoPort.obtenerEstado` y `ColaQueryPort.hayColaActiva` declaran
  `tenantId?` opcional; sus adaptadores solo fijan RLS y filtran por tenant `if
  (tenantId)`. Hoy es seguro porque el servicio de dominio **siempre** propaga
  `tenantId`. Recomendación: hacer `tenantId` obligatorio en ambos puertos para
  eliminar de raíz cualquier futura lectura cross-tenant sin RLS.
  (`reserva-estado.prisma.adapter.ts`, `cola-query.prisma.adapter.ts`.)

- **[consistencia] Guarda firme leída en transacción separada del DELETE.**
  `consultarBloqueo()` y `liberar()` corren en transacciones distintas, y el DELETE
  filtra solo por `(tenant_id, fecha)` (no por tipo/estado). Existe una ventana
  TOCTOU teórica. Aceptable porque UC-31 invoca `liberarFecha()` **después** de que el
  flujo haya transitado la reserva, y el riesgo está acotado; documentado como
  trade-off en `design.md`. Recomendación opcional futura: revalidar tipo/estado
  dentro de la misma transacción del DELETE si se endurece la atomicidad.

- **[auditoría] entidadId heterogéneo.** En `tentativa_idempotente` el `entidadId`
  es la fecha `YYYY-MM-DD` (no hay reserva conocida), mientras que en `liberada` es
  el `reservaId`. Es coherente con el modelo (no hay fila que referenciar en el
  no-op) pero conviene tenerlo presente para consultas de auditoría.

---

## Notas de proceso

- `tasks.md` mantiene sin marcar los pasos 1 (gate SDD), 9 (docs) y 10–12 (este
  code-review, gate final, archive/PR). Este informe cubre el paso 10; el archivado
  queda supeditado al gate humano final (paso 11) y a docs (paso 9), fuera del
  alcance del code-reviewer.

**Veredicto: APTO**
