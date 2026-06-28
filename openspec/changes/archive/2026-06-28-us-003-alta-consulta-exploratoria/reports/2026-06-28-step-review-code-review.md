# Code Review — US-003 Alta de consulta exploratoria sin fecha

- **Change**: `us-003-alta-consulta-exploratoria`
- **Rama**: `feature/us-003-alta-consulta-exploratoria`
- **Fecha**: 2026-06-28
- **Revisor**: code-reviewer (solo lectura; no aplica fixes)
- **Alcance**: diff de la feature (working tree vs master) — backend `reservas`/`comunicaciones`,
  frontend `NuevaConsultaPage`/`App`/`AppShell`, contrato `api-spec.yml` + SDK generado, tests y e2e.

## Veredicto: APTO

No hay Bloqueantes. Los guardrails duros aprobados en Gate 1 se cumplen. Quedan 2 Mayores
(correctitud/edge-case, no de scope) y varios Menores recomendados para seguimiento; ninguno
impide el merge.

---

## Verificación de guardrails duros (Gate 1)

| # | Guardrail | Resultado |
|---|-----------|-----------|
| 1 | Hexagonal/DDD: `domain/` sin `@nestjs/*`/`@prisma/*`/infra; puertos en dominio, adaptadores en infra | OK |
| 2 | Bloqueo atómico: nada de Redis/Redlock/locks distribuidos; alta usa `$transaction`+`fijarTenant`; NO crea `fecha_bloqueada` en 2a | OK |
| 3 | Multi-tenancy/RLS: `tenant_id` del JWT; `fijarTenant` primera op de la tx; all-or-nothing | OK |
| 4 | Contrato: cliente generado no editado a mano; DTOs fieles al contrato | OK |
| 5 | Estado consulta/`2a`→Prisma `s2a` reversible; ttl=NULL; sin migración; find-or-create cliente; AUDIT_LOG `crear`/`RESERVA` en tx; E1 enviado/borrador post-commit | OK |
| 6 | Máquina de estados declarativa MÍNIMA (solo entrada inicial), anti-scope respetado | OK |
| 7 | Web responsive mobile-first, drawer `<lg`, sin overflow en 390/768/1280 (e2e) | OK |
| 8 | Arrow functions siempre (ESLint `func-style`), métodos de clase exentos | OK |

### Evidencia
- **Hexagonal**: `reservas/domain/maquina-estados.ts` y `comunicaciones/domain/enviar-email.port.ts`
  no importan framework/infra/Prisma (solo comentarios mencionan la regla). El puerto
  `EnviarEmailPort` es interfaz pura; el adaptador `EnviarEmailStubAdapter` (no-op, sin red) vive en
  `comunicaciones/infrastructure/`.
- **Bloqueo/atomicidad**: `infrastructure/unidad-de-trabajo.prisma.adapter.ts` abre un único
  `prisma.$transaction` y ejecuta `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como PRIMERA
  operación; los repos son tx-bound; no hay Redis/Redlock/ioredis/setTimeout/Lambda en el diff de la US.
  En 2a no se crea `FECHA_BLOQUEADA` (confirmado en use-case, adaptador y e2e `fbCount=0`).
- **Multi-tenancy**: el controller toma `tenantId`/`usuarioId` de `@CurrentUser` (JWT), nunca del
  body/path; el caso de uso propaga `tenantId` a la UoW.
- **Contrato/SDK**: `git diff` de `apps/web/src/api-client/schema.d.ts` es coherente con
  `docs/api-spec.yml` (regenerado); `client.ts`/`index.ts` sin cambios → cliente no editado a mano.
- **Estado/auditoría**: mapper `subEstadoDominioAPrisma('2a')='s2a'` total y reversible (test verde);
  AUDIT_LOG `accion='crear'`, `entidad='RESERVA'` dentro de la tx; E1 `enviado` (sin comentarios, con
  envío post-commit) vs `borrador` (con comentarios, sin envío) verificado en unit + e2e.
- **Tests/lint**: 36/36 unit en verde (`alta-consulta.use-case`, `maquina-estados`, `enviar-email.port`);
  ESLint sin errores en los ficheros backend y frontend de la US (arrow-functions OK).
- **Responsive**: `NuevaConsultaPage` mobile-first (`grid-cols-1 sm:grid-cols-2`, paddings escalados,
  sin anchos px fijos que rompan); drawer lo aporta `AppShell`; e2e cubre 390/768/1280 con asserts de
  no-overflow y hamburguesa `<lg` / sidebar `≥lg`.

---

## Bloqueantes

Ninguno.

---

## Mayores

1. **[manejo de errores] El `try/catch` del controller enmascara `P2002` como 500 y anula el filtro
   global `P2002 → 409`.**
   `reservas/interface/alta-consulta.controller.ts` (método `crear` + `aHttp`, líneas ~68-104):
   `aHttp` solo reconoce `AltaConsultaValidacionError` (→400) y `HttpException` (passthrough); cualquier
   otro error (incluido `Prisma.PrismaClientKnownRequestError` con `code==='P2002'`) se transforma en un
   `HttpException(500)` genérico ANTES de llegar a `HttpExceptionFilter`, que es quien mapea `P2002→409`
   (`shared/filters/http-exception.filter.ts`). El comentario de `unidad-de-trabajo.prisma.adapter.ts`
   (`generarCodigo`: "una colisión P2002 → HTTP 409 vía el filtro global") es por tanto incorrecto para
   este endpoint: una colisión del `codigo` correlativo devolvería 500, no 409.
   Impacto real BAJO (en 2a no hay `fecha_bloqueada`; la única fuente de `P2002` es la colisión del
   `codigo` correlativo, cuya ventana el design declara despreciable en el MVP de un solo gestor), por
   eso no bloquea. **Recomendación**: en `aHttp` mapear `AltaConsultaValidacionError` a 400 y
   **relanzar el resto** (`throw error`) para que el filtro global aplique `P2002→409` y el resto de su
   normalización, o bien mapear explícitamente `P2002` a `ConflictException` en el controller.

2. **[robustez] Generación de `codigo` no atómica (count+1) bajo concurrencia.**
   `unidad-de-trabajo.prisma.adapter.ts` `generarCodigo` calcula `count(*)+1` por tenant; dos altas
   concurrentes pueden generar el mismo `codigo`. Hoy se apoya en el índice único + reintento manual
   inexistente (se confía en `P2002`, que además hoy degrada a 500 por el punto 1). El design lo asume
   tolerable para el MVP. **Recomendación**: documentar la limitación o, cuando deje de ser monogestor,
   sustituir por una secuencia/serial por tenant o un reintento ante `P2002`. No bloquea.

---

## Menores

1. **[scope contrato] `fechaEvento` se acepta en el DTO pero el controller/use-case lo IGNORAN.**
   `create-reserva.dto.ts` declara `fechaEvento?` (válido por contrato compartido para 2b en
   US-004/005), pero `alta-consulta.controller.ts` no lo traslada al comando: una petición con
   `fechaEvento` crea silenciosamente una RESERVA en 2a. Es coherente con el anti-scope de US-003, pero
   conviene dejar claro (doc/aviso) que en esta US el campo no produce 2b para evitar expectativas
   erróneas del consumidor del SDK.

2. **[convención formularios] La US usa `react-hook-form + zod`, no TanStack Form.**
   `tasks.md` 5.6 y la skill `tanstack-forms` citan TanStack Form, pero `NuevaConsultaPage.tsx` usa
   `react-hook-form`. Es CONSISTENTE con el precedente del proyecto (`pages/LoginPage.tsx` también usa
   `react-hook-form`), por lo que se acepta; solo se señala el desajuste de naming en tasks/skill.

3. **[robustez mapeo errores] El mapeo de errores 400 por campo en el frontend depende de substring del
   mensaje en español** (`aplicarErroresDeCampo`: `includes('apellido'|'nombre'|'email'|'tel'|'canal')`).
   Funciona con los mensajes actuales, pero es frágil ante cambios de copy. **Recomendación** (futuro):
   que el `ErrorResponse` incluya el `campo` estructurado y el cliente mapee por clave, no por texto.

4. **[idempotencia cliente] find-or-create por `findFirst` + `create` sin `UNIQUE(tenant_id, email)`
   visible.** Bajo concurrencia podría duplicar CLIENTE. Aceptable en MVP monogestor; recomendable una
   restricción única `(tenant_id, email)` para garantizar la idempotencia declarada en el spec-delta.

5. **[tipado] `UnidadDeTrabajoPort.ejecutar` retorna `Promise<unknown>` y el use-case castea con
   `as AltaConsultaResultado`.** Cast justificado por la firma genérica de la UoW; podría tiparse con un
   genérico (`ejecutar<T>(...): Promise<T>`) para eliminar el `as`. Cosmético.

---

## Cobertura de escenarios del spec-delta

Todos los Requirements/Scenarios del spec-delta `consultas` tienen cobertura:
- Alta en 2a (ttl NULL, sin `FECHA_BLOQUEADA`, cliente del tenant) — unit 3.2 + e2e 8.3 + curl 7.2.
- Sin tarifa aunque haya invitados/horas — unit 3.2 (`not.toHaveProperty importe*`).
- E1 enviado (sin comentarios, envío post-commit) vs borrador (con comentarios, sin envío) — unit 3.3 + e2e 8.3/8.4 + curl 7.2/7.3.
- Idempotencia CLIENTE por (tenant, email) — unit 3.4 + curl 7.4.
- AUDIT_LOG `crear`/`RESERVA` con `usuario_id`+`datos_nuevos` en la tx — unit 3.5 + e2e 8.3.
- Validación sin efectos (obligatorios/email/canal) e idempotencia del rechazo — unit 3.6 + e2e 8.5 + curl 7.5.
- Atomicidad/rollback (sin envío huérfano) — unit 3.7 (atomicidad real verificada en QA/BD).

No se observa sobre-construcción de US-045 (adaptador de email es stub no-op; el transporte real queda
diferido) ni de las 16+ transiciones de la máquina de estados (solo entrada inicial declarativa).

---

## Nota de proceso
`tasks.md` deja pendiente 9.1 (docs-keeper) y el Gate final humano (11.1) antes de archive/PR; este
informe cubre el paso 10.x (code-review).
