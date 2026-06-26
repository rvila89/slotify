# Addendum de Code-Review — US-016 Motor de Cálculo de Tarifa

> Re-revisión ACOTADA. Complementa (no sustituye) el informe
> `2026-06-26-code-review.md` (Veredicto: APTO sobre el estado anterior).
> Alcance exclusivo: cambios introducidos por el commit `adf872a`
> (`fix(us-016): fecha estrictamente futura + 400 con envelope codigo/detalle`).

- Fecha: 2026-06-26
- Revisor: code-reviewer (solo lectura)
- Rama: `feature/us-016-motor-calculo-tarifa`
- Diff revisado: `git diff adf872a~1 adf872a` (5 ficheros, +47 / -7)
- Contexto de calidad (ya ejecutado): suite 44/44, lint 0, typecheck 0, openspec validate OK.

---

## Veredicto: APTO

Los cambios atienden correctamente los hallazgos del informe previo (paridad del
400) y la nueva regla de producto (fecha estrictamente futura, no mismo día). No
se detectan bloqueantes ni regresiones de guardrails.

---

## Verificación punto por punto

### 1. Regla de fecha (estrictamente futura, por día natural UTC) — CORRECTA
`calculadora-tarifa.service.ts:236-243`. La comparación pasa de instante
(`getTime()`) a día natural UTC mediante el helper `inicioDiaUtc`:
`Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())`, y rechaza con
`inicioDiaUtc(fechaEvento) <= inicioDiaUtc(clock.ahora())`.
- Mismo día → `<=` se cumple (igualdad) → rechazado. Correcto.
- Día siguiente → estrictamente mayor → aceptado. Correcto.
- Determinismo: la frontera depende solo del `ClockPort` inyectado, no de
  `Date.now()`; los tests fijan el reloj (`relojFijo('...T14:00...')`) y la
  comparación por día ignora la hora → resultado determinista e independiente de
  la hora del instante actual.
- Coherencia de husos: usa exclusivamente componentes UTC, alineado con el
  `getUTCMonth()` ya empleado para resolver la temporada (`:179`). No mezcla
  zona local con UTC. `new Date('2026-06-26')` (ISO date-only) se interpreta en
  UTC, consistente con la comparación.

### 2. Respuesta 400 con envelope — CORRECTA y EN PARIDAD
`tarifas.controller.ts:81-89`. El 400 ahora emite
`{ statusCode, error: 'Bad Request', message, codigo: 'VALIDACION', detalle: { campo } }`,
en la misma forma que los 404/422 (`:90-126`). `codigo` y `campo` provienen del
error de dominio tipado (`ValidacionTarifaError`, `:100-108`), no se hardcodean
en el controller.
- Contrato: el 400 referencia `responses/ValidationError` → `ErrorResponse`
  (`api-spec.yml:1013-1017`, `:1606-1618`), que es `type: object` con
  `required:[statusCode,message]` y SIN `additionalProperties:false`. Por tanto
  el envelope ampliado con `codigo`/`detalle` es válido contra el contrato; no
  hay desajuste contrato↔implementación.

### 3. Convención arrow functions — RESPETADA
`inicioDiaUtc` es arrow (`const inicioDiaUtc = (d: Date): number => ...`),
tipada, sin `any`. Coherente con el estilo funcional del módulo.

### 4. Tests — SIGNIFICATIVOS Y DETERMINISTAS
`calculadora-tarifa.service.spec.ts:635-655`. Cubren ambos lados de la frontera:
`debe_rechazar_fecha_de_evento_del_mismo_dia` (reloj 14:00, evento ese día →
`ValidacionTarifaError`) y `debe_aceptar_fecha_de_evento_del_dia_siguiente`
(evento día+1 → cálculo normal, asserts sobre `tarifaAConsultar=false` y
`precioTarifaEur>0`). Sin regresión: el `relojFijo()` por defecto
(`2026-01-01`) y el `inputBase` por defecto (`fechaEvento 2026-09-15`) mantienen
todas las fechas de los tests previos en el futuro respecto al reloj.

### 5. Coherencia SDD — FIEL
`spec.md` (Requirement "Validación de inputs": "estrictamente futura ... no el
mismo día —comparación por día natural en UTC"; nuevo Scenario "Fecha del día
siguiente es aceptada") y `US-016-motor-calculo-tarifa.md` §Reglas de Validación
reflejan la regla implementada y los dos escenarios frontera.

### 6. Guardrails — SIN REGRESIÓN
Cambio en `domain/` sin imports de `@nestjs/*`/`@prisma/*`/`infrastructure/`
(usa el puerto `ClockPort`). No introduce Redis ni locks distribuidos (motor de
lectura pura). Multi-tenancy intacto: `tenant_id` sigue derivando del JWT
(`@TenantId`) en el controller; este commit no toca queries ni RLS.

---

## Hallazgos

Ninguno bloqueante. Observación informativa (severidad Baja, fuera del alcance
estricto del commit, NO condiciona el merge):

- **[Baja / doc-contrato]** El 400 reutiliza el `ErrorResponse` genérico y, a
  diferencia de los 404/422, no dispone de un schema dedicado (p. ej.
  `CalculoTarifaValidacionError`) que documente `codigo: VALIDACION` y
  `detalle.campo`. Es válido contra el contrato (objeto abierto) y la
  implementación es correcta; solo es una oportunidad de completitud documental
  del contrato si se quiere paridad total de documentación con 404/422.
  Recomendación: considerarlo en un cambio de contrato posterior (dueño:
  `contract-engineer`); no requiere acción para esta US.

---

## Conclusión

Los cambios del commit `adf872a` son correctos, deterministas y coherentes con
SDD y guardrails. Se mantiene el veredicto favorable.

Veredicto: APTO
