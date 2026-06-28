# Code Review (RE-REVIEW) — US-003 Alta de consulta exploratoria sin fecha

- **Change**: `us-003-alta-consulta-exploratoria`
- **Rama**: `feature/us-003-alta-consulta-exploratoria`
- **Fecha**: 2026-06-28
- **Revisor**: code-reviewer (solo lectura; no aplica fixes)
- **Alcance**: re-revisión tras los 2 fixes Mayores señalados en
  `2026-06-28-step-review-code-review.md`. Diff de la feature (working tree vs master).
- **Skills**: `review-checklist`, `architecture-guardrails`.

## Veredicto: APTO

No hay Bloqueantes. Los 2 Mayores del informe previo quedan **RESUELTOS** sin introducir
nuevos Bloqueantes/Mayores ni violar guardrails. Quedan Menores residuales de seguimiento
(no impiden el merge).

---

## Estado de los Mayores previos

### Mayor #1 — RESUELTO
**[manejo de errores] El controller enmascaraba `P2002` como 500 y anulaba `P2002 → 409`.**
- `apps/api/src/reservas/interface/alta-consulta.controller.ts`:
  - `aHttp` ahora tiene firma `: never` (líneas 96-105): mapea SOLO
    `AltaConsultaValidacionError` → `BadRequestException` (400) y **relanza el resto**
    con `throw error` (línea 104). Eliminado el branch `HttpException` passthrough y el
    fallback `HttpException(500)`; eliminado el import de `HttpException` (solo se importa
    `BadRequestException`).
  - Consecuencia: un `Prisma P2002` (colisión del `codigo`) ya NO se convierte en 500;
    se propaga intacto al `HttpExceptionFilter` global → 409. El control de flujo de
    `crear` queda correcto gracias al tipo de retorno `never` de `aHttp`.
- Test nuevo `apps/api/src/reservas/__tests__/alta-consulta.controller.spec.ts`: cubre
  éxito→DTO, `AltaConsultaValidacionError`→400, `P2002` relanzado intacto (no 500) y
  error inesperado relanzado sin envolver. Verde (4 casos).

### Mayor #2 — RESUELTO
**[robustez] Generación de `codigo` (count+1) no atómica bajo concurrencia.**
- `apps/api/src/reservas/infrastructure/unidad-de-trabajo.prisma.adapter.ts`:
  - `ejecutar` (líneas 255-272) implementa retry-on-conflict: bucle hasta
    `MAX_INTENTOS_CODIGO=3` que delega en `ejecutarTransaccion` (líneas 274-289).
  - **El reintento REABRE la transacción**: cada iteración invoca un nuevo
    `prisma.$transaction` dentro de `ejecutarTransaccion`; NO se continúa una transacción
    abortada (correcto: en PostgreSQL la `P2002` aborta la tx en curso). Verificado por
    el test que afirma `$transaction` llamado 2 veces tras una colisión.
  - **`fijarTenant` es la PRIMERA operación de cada (re)intento** (línea 280, dentro del
    callback de `$transaction`, antes de construir los repos). Multi-tenancy/RLS intacta.
  - `esColisionCodigo` (líneas 231-241) discrimina `P2002` por `meta.target` que incluya
    `codigo`; un `P2002` ajeno (p. ej. otro índice) o un error no-Prisma NO se reintenta y
    se propaga de inmediato → comportamiento correcto.
  - El índice `reserva_codigo_key` se mantiene como red de seguridad final; agotados los
    reintentos, el `P2002` se propaga → 409 vía filtro global. Sin migración, sin locks
    distribuidos. Coherente con el patrón UNIQUE+PostgreSQL del proyecto.
- Test nuevo `apps/api/src/reservas/__tests__/unidad-de-trabajo.prisma.adapter.spec.ts`:
  reintento tras colisión, éxito al primer intento sin reintento, propagación tras agotar
  los 3 intentos, no-reintento ante `P2002` ajeno, no-reintento ante error no-Prisma, y
  `fijarTenant` con el tenant del JWT. Verde (6 casos).

---

## Verificación de guardrails duros (re-check)

| # | Guardrail | Resultado |
|---|-----------|-----------|
| 1 | Hexagonal/DDD: `domain/` sin `@nestjs/*`/`@prisma/*`/infra; adaptador sigue en `infrastructure/` | OK |
| 2 | Bloqueo/atomicidad: sin Redis/Redlock/ioredis/EventBridge/Lambda; retry reabre `$transaction` | OK |
| 3 | Multi-tenancy/RLS: `tenant_id` del JWT; `fijarTenant` primera op de CADA reintento | OK |
| 4 | Contrato/SDK: cliente generado no editado a mano | OK |
| 5 | Errores en español; tipos sin `any` injustificado; arrow-functions (helpers `esColisionCodigo`/`duracionHorasAPrisma` son flecha; métodos de clase exentos) | OK |
| 6 | Máquina de estados declarativa mínima; sin if/else dispersos | OK |
| 7 | Web responsive (sin cambios de UI en estos fixes; cobertura previa intacta) | OK |

### Evidencia de verificación
- Las dos suites nuevas pasan en local: **10/10** (`alta-consulta.controller.spec` 4,
  `unidad-de-trabajo.prisma.adapter.spec` 6).
- Búsqueda de patrones prohibidos en `apps/api/src/reservas` y `comunicaciones`: las únicas
  coincidencias de "Redis/locks distribuidos" están en **comentarios** que afirman su NO uso.
- Reportado por el implementador y consistente con lo revisado: `lint` verde, suite completa
  178/178 (33 suites), depcruise de arquitectura sin violaciones.

---

## Bloqueantes
Ninguno.

## Mayores
Ninguno (los 2 previos resueltos).

## Menores residuales (seguimiento, no bloquean)
1. **[scope contrato]** `fechaEvento` se acepta en el DTO pero controller/use-case lo
   IGNORAN en 2a (coherente con anti-scope de US-003; conviene documentarlo para el
   consumidor del SDK). — Carryover.
2. **[idempotencia cliente]** find-or-create por `findFirst`+`create` sin `UNIQUE(tenant_id,
   email)` visible; bajo concurrencia podría duplicar CLIENTE. Aceptable en MVP monogestor;
   recomendable la restricción única. — Carryover.
3. **[robustez mapeo errores frontend]** mapeo 400 por substring del mensaje en español;
   frágil ante cambios de copy. Futuro: `campo` estructurado en `ErrorResponse`. — Carryover.
4. **[tipado]** `UnidadDeTrabajoPort.ejecutar` retorna `Promise<unknown>` y el use-case
   castea con `as`; podría tiparse genérico `ejecutar<T>`. Cosmético. — Carryover.
5. **[test, nuevo]** En `unidad-de-trabajo.prisma.adapter.spec`, el fake de `$transaction`
   rechaza ANTES de invocar el callback, por lo que el test de "`fijarTenant` primera
   operación en cada intento" solo puede asertar la invocación del intento exitoso (1 vez).
   El código real sí ejecuta `fijarTenant` como primera op de cada reintento (verificado por
   lectura); la atomicidad/RLS reales se cubren en QA contra BD. Mejora opcional de fixture
   para asertar `fijarTenant` por intento. No afecta correctitud.

Menores 2-3 de "convención formularios" (react-hook-form vs TanStack) del informe previo
siguen igual y aceptados; no se repiten aquí.

---

## Conclusión
Ambos Mayores resueltos correctamente y de forma coherente con los guardrails del proyecto
(hexagonal, atomicidad sin locks distribuidos, RLS por reintento, arrow-functions). Sin
nuevos Bloqueantes/Mayores. **Apto para merge.**

Veredicto: APTO
