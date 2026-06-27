# ADDENDUM — Code Review (re-revisión) us-040-bloquear-fecha-atomicamente

**Rama:** feature/us-040-bloquear-fecha-atomicamente (vs master)
**Fecha:** 2026-06-27
**Agente:** code-reviewer (solo lectura)
**Skills:** review-checklist, architecture-guardrails
**Informe base:** `2026-06-27-step-review-code-review.md` (Veredicto APTO, hallazgos Media M1-M3 + Baja B1-B4)

> Alcance de esta re-revisión: cierre de los hallazgos Media **M1/M2/M3** tras
> aplicar los fixes. Se re-leen los cuatro ficheros tocados, el esquema Prisma
> (nombres de índices UNIQUE) y los tests nuevos. El change sigue en working tree
> (untracked + `reservas.module.ts`/`prisma.service.ts` modificados); no hay
> commits por delante de master. Sin endpoint HTTP (D-7), contrato sin tocar.

---

## Estado de los hallazgos previos

### [M1] Guard anti-degradado firme→blando en `extend` — **RESUELTO**
- Nuevo error de dominio `ExtensionSobreBloqueoFirmeError`
  (`EXTENSION_SOBRE_BLOQUEO_FIRME`), en español, con payload de diagnóstico
  (`domain/bloquear-fecha.service.ts:198-211`).
- Guard en `aplicarExtension` (`infrastructure/fecha-bloqueada.prisma.adapter.ts:177-179`):
  si `existente !== null && existente.tipo_bloqueo === 'firme'` → rechaza antes de
  calcular `ttlBase`. Colocado **después** del check de "otra reserva" y **antes**
  del UPDATE, por lo que ya no hay ruta que degrade un firme a blando.
- No rompe flujos válidos: el `extend` (fase 2.c) sobre fila **blanda** no dispara
  el guard (`tipo_bloqueo === 'blando'`); el `extend` con `existente === null` sigue
  por el INSERT blando. La comparación es segura: el `$queryRaw` devuelve el enum DB
  (`blando`/`firme`) tipado como `TipoBloqueoDominio`.
- Test nuevo: `debe_rechazar_un_extend_sobre_un_bloqueo_firme_sin_degradarlo`
  (`__tests__/bloquear-fecha-integracion.spec.ts:230-254`) verifica el rechazo y que
  la fila queda FIRME e intacta (mismo `idBloqueo`, `ttl` null).

### [M2] Traducción de `P2002` discriminada por `target` — **RESUELTO**
- `traducirError` (`fecha-bloqueada.prisma.adapter.ts:209-230`) ahora discrimina por
  `meta.target` con `objetivoP2002` (`:232-237`):
  - `target` se normaliza a texto en minúsculas manejando **string** y **string[]**
    (`Array.isArray(target) ? target.join(',') : String(target ?? '')`) — robusto
    ante ambas formas de la API de Prisma, sin lanzar si es `undefined`.
  - `objetivo.includes('reserva_id')` → `ReservaYaTieneBloqueoError`
    (`RESERVA_YA_TIENE_BLOQUEO`).
  - `objetivo.includes('fecha') || includes('tenant_id')` → `FechaYaBloqueadaError`.
  - cualquier otro `P2002` / error → se propaga sin traducir (no engaña).
- **Orden correcto y necesario**: el constraint de PostgreSQL `fecha_bloqueada_reserva_id_key`
  contiene el substring "fecha" (por el prefijo de tabla `fecha_bloqueada`); por eso
  `reserva_id` se evalúa **primero**. Si se invirtiera, una colisión de `reserva_id`
  se clasificaría erróneamente como `FechaYaBloqueadaError`. El código y su comentario
  (`:220-221`) lo hacen explícito. Verificado contra el esquema: `reservaId @unique
  @map("reserva_id")` y `@@unique([tenantId, fecha])` (`schema.prisma:325,333`).
- Sin regresión en los tests de concurrencia/colisión: dos reservas distintas sobre la
  MISMA fecha colisionan en `(tenant_id, fecha)` (no en `reserva_id`) → sigue dando
  `FechaYaBloqueadaError`.
- Test nuevo: `debe_lanzar_RESERVA_YA_TIENE_BLOQUEO_y_no_FECHA_YA_BLOQUEADA`
  (`bloquear-fecha-integracion.spec.ts:262-283`): misma reserva bloquea una segunda
  fecha → `ReservaYaTieneBloqueoError` y `not.toBeInstanceOf(FechaYaBloqueadaError)`.

### [M3] `SET LOCAL` parametrizado, sin escape manual — **RESUELTO**
- `fijarTenant` en ambos sitios usa el tagged-template `$executeRaw` (parametrizado),
  no `$executeRawUnsafe` ni `replace(/'/g, "''")`:
  - `fecha-bloqueada.prisma.adapter.ts:81-86`
  - `shared/prisma/prisma.service.ts:31-36`
- `SELECT set_config('app.tenant_id', ${tenantId}, true)`: el tercer argumento `true`
  (`is_local`) hace que el ajuste sea **local a la transacción en curso**, equivalente
  a `SET LOCAL`. Se invoca con el cliente transaccional `tx` dentro del `$transaction`,
  por lo que el ámbito LOCAL se mantiene (correcto incluso con pooling en modo
  transacción). RLS sigue activo y filtrando por `app.tenant_id`.

---

## Hallazgos nuevos

### Bloqueantes / Alta
- Ninguno.

### Baja (informativo, no bloqueante)
- **[B5] La rama `string[]` de `objetivoP2002` asume nombres con guion bajo.** En
  PostgreSQL + Prisma, `meta.target` del `P2002` es el **nombre del constraint**
  (string, p. ej. `fecha_bloqueada_reserva_id_key`), forma que casa con los substrings
  `reserva_id`/`tenant_id`/`fecha` y queda fijada por el test de integración en verde.
  Si una versión de Prisma devolviera el **array de nombres de campo** del schema
  (camelCase: `['reservaId']`/`['tenantId','fecha']`), el join no contendría
  `reserva_id` y esa colisión caería al `else` (se propaga el `P2002` crudo, sin
  traducir). No es un fallo actual —el comportamiento está pinneado por el test— sino
  una nota de robustez ante un futuro cambio de forma de `meta.target`.
- **[B1] (arrastrado) DRY: `fijarTenant` duplicado.** El adaptador reimplementa
  `PrismaService.fijarTenant` por el tipado del constructor
  (`Pick<PrismaClient,'$transaction'>`). Ambas copias ya usan la versión parametrizada,
  así que no hay divergencia de seguridad; sigue siendo deuda menor de unificación.

---

## Guardrails (re-verificados)

| Guardrail | Estado |
|-----------|--------|
| Hexagonal: `domain/` sin `@nestjs/*`, `@prisma/*`, ni `infrastructure/` | OK (grep limpio; solo comentarios) |
| Bloqueo SOLO `UNIQUE(tenant_id,fecha)` + `SELECT … FOR UPDATE`; sin Redis/lock distribuido | OK |
| Multi-tenancy / RLS: `SET LOCAL` (set_config local) dentro de `$transaction` | OK |
| Errores de dominio en español (incl. los 2 nuevos) | OK |
| TS strict, sin `any` injustificado en ficheros tocados | OK (grep sin `any`) |
| Máquina de estados como tabla declarativa (`resolverPlanBloqueo`) | OK (sin cambios) |
| Tests primero / suite verde (73/73), lint/typecheck/depcruise limpios | OK (reportado) |
| Contrato OpenAPI / cliente frontend | N/A (D-7, sin endpoint; no tocados) |

---

## Veredicto: APTO

Los tres hallazgos Media **M1, M2 y M3 quedan RESUELTOS**, con tests nuevos que cubren
M1 y M2 y la suite en verde. No se introducen regresiones ni hallazgos Bloqueantes o de
severidad Alta. Los puntos B5 (robustez de la forma de `meta.target`) y B1 (DRY) son
mejoras menores no bloqueantes, abordables aquí o en seguimiento sin frenar el merge.
