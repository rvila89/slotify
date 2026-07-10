# Code-review — US-035 Registrar IBAN de devolución

- **Fecha**: 2026-07-09
- **Revisor**: code-reviewer (solo lectura)
- **Change**: `us-035-registrar-iban-devolucion`
- **Branch**: `feature/us-035-registrar-iban-devolucion` (base `master`)
- **Alcance**: diff completo de la branch contra `master` frente a guardrails (`architecture-guardrails`) y `review-checklist`.

> Nota de método: en el momento de la revisión los cambios están en el árbol de
> trabajo (sin commitear); HEAD == master (889c751). Se revisó `git status` +
> `git diff` de los ficheros modificados y el contenido de los nuevos.

## Verificaciones (resultado)

| # | Punto crítico | Resultado |
|---|---------------|-----------|
| 1 | Hexagonal: `validar-iban.ts` en dominio sin `@nestjs/*`/`@prisma/*`/infra; puertos en aplicación, adaptadores en infra; use-case sin Prisma | OK |
| 2 | MOD-97 como arrow function pura en dominio, no dispersa en controller/infra | OK |
| 3 | Multi-tenancy/RLS: `fijarTenant(tx, tenantId)` como primera op de cada tx; filtros `tenantId`; tenant/usuario del JWT (`@CurrentUser`), no del path/body | OK |
| 4 | Sin lock distribuido (Redis/Redlock): no se introdujo nada; solo menciones en comentarios preexistentes | OK |
| 5 | Cliente generado (`api-client/schema.d.ts`) regenerado por codegen, coherente con DTO/spec, no editado a mano | OK |
| 6 | Precondición dual `post_evento` + `fianzaEur > 0` en backend; 409 con `code` discriminado; 409 con prioridad sobre 422 | OK |
| 7 | D-3A: excepción a idempotencia (`es_reenvio=true`, `despacharReenvio`) en motor/adaptador, no en use-case; UNIQUE parcial intacto para otros códigos | OK |
| 8 | Convenciones: arrow functions (sin `function`), estructura Bulletproof + barrel, `max-lines`≤300 (web), responsive mobile-first | OK |
| 9 | Guardar-luego-enviar (FA-03): fallo de E8 no revierte el IBAN; aviso propagado sin romper la tx | OK |
| 10 | AUDIT_LOG `entidad=CLIENTE`, `datos_anteriores`/`datos_nuevos` con `iban_devolucion` | OK |

### Detalle de evidencia

- **Hexagonal / MOD-97 (1,2)**: `comunicaciones/domain/validar-iban.ts` es
  función pura (arrow), sin imports de framework/infra (verificado por grep).
  El use-case `registrar-iban-devolucion.use-case.ts` depende solo de puertos
  (`UnidadDeTrabajoIbanDevolucionPort`, `DispararE8Port`, `cargarReserva`) y del
  dominio puro; no importa Prisma ni `@nestjs/*`.
- **RLS (3)**: los tres adaptadores Prisma (`cargar-reserva…`,
  `registrar-iban-devolucion-uow…`, `disparar-e8.adapter`) invocan
  `prisma.fijarTenant(tx, tenantId)` como primera operación de la transacción y
  filtran por `tenantId`. El controller deriva `tenantId`/`usuarioId` de
  `@CurrentUser` (JWT); el `{id}` del path es solo la reserva de contexto.
  Guard `RolesGuard` + `@Roles('gestor')` (403 sin rol; 401 lo cubre el guard
  JWT global).
- **Orden 409>422 (6)**: el use-case evalúa precondición (estado/fianza → 409)
  ANTES de validar el IBAN (→ 422), sin abrir tx ni disparar E8 en ninguno de
  los dos rechazos.
- **D-3A (7)**: `despacharReenvio` en `despachar-email.service.ts` crea SIEMPRE
  fila nueva con `esReenvio=true`, saltándose el chequeo de idempotencia, y
  reutiliza `enviarYFinalizar`. La columna `es_reenvio` y el índice UNIQUE
  parcial `(reserva_id, codigo_email) WHERE es_reenvio=false` ya existían
  (migración US-028 `20260704140000`); no se altera la idempotencia de los
  disparos automáticos de otros códigos.
- **FA-03 (9)**: `dispararE8` en el use-case es post-commit y envuelto en
  try/catch; tanto `resultado='fallido'` como una excepción del proveedor
  degradan a `avisoEmail` sin revertir el IBAN. Email de cliente nulo degrada a
  `variable_nula` → `comunicacion:null` → `fallido` (sin crash), coherente con
  el camino normal `despachar`.
- **Tests (checklist "Tests primero")**: backend `validar-iban` +
  `registrar-iban-devolucion` = 45/45 PASS; frontend `iban*` = 17/17 PASS
  (re-ejecutados en esta revisión).
- **Contrato (5)**: `docs/api-spec.yml` añade op `registrarIbanDevolucion`,
  `RegistrarIbanDevolucionRequest/Response/AvisoEmail/ConflictError`;
  `schema.d.ts` es su reflejo exacto (regenerado). DTOs `class-validator`
  alineados con el `pattern`/longitudes del contrato.
- **Responsive (8)**: `IbanDevolucionCard`/`AvisoE8Fallido` mobile-first —
  `w-full` con `sm:w-auto` en botones, `p-4 sm:p-6 lg:p-8`, `break-all` en el
  IBAN, objetivos táctiles `h-12`/`h-14`, sin anchos px fijos. `max-lines`:
  todos los ficheros web bajo 300 (regla aplica solo a `apps/web`, skipComments).

## Hallazgos

### Bloqueante
- (ninguno)

### Mayor
- (ninguno)

### Menor
- **M-1 · Importe fianza vía `Number()`** — `use-case.ts` `hayFianza` y
  `lib/ibanDevolucion.ts` `tieneFianza` convierten el `Decimal(10,2)` (string) a
  `Number` solo para el test `> 0`. Es una comparación de signo, no aritmética
  monetaria, por lo que no rompe la regla "Decimal no Float"; la fuente sigue
  siendo string. Se anota por higiene (comparar sin `Number` sería más estricto).
  No bloquea.

### Nit
- **N-1 · Duplicación tabla mod-97** — `LONGITUD_POR_PAIS` y el algoritmo mod-97
  están replicados en dominio backend (`validar-iban.ts`) y en `web/lib/iban.ts`.
  Es intencional (espejo cliente para UX; backend = fuente de verdad, documentado
  en ambos ficheros). El front añade `BG:22` que el back no lista; divergencia
  benigna (el back es autoridad y rechazaría `BG` como país desconocido).
- **N-2 · Use-case backend 323 líneas** — por encima de 300, pero `max-lines`
  solo rige en `apps/web`; el grueso es documentación JSDoc. Sin acción.

## Riesgos residuales
- **E2E Playwright (§8) PENDIENTE** por ausencia de servidor Playwright MCP en
  la sesión (limitación de tooling, no de esfuerzo). No es hallazgo imputable a
  la implementación; se escala al gate humano. QA cubrió unit (45+117) y curl
  E2E contra BD real (6/7; FA-03 por unit).
- La verificación cross-tenant y de concurrencia se apoya en RLS + inspección de
  código; no se ejecutó una prueba SQL de fuga cross-tenant dedicada en esta
  revisión (los adaptadores fijan tenant correctamente por inspección).

Veredicto: APTO
