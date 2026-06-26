# Informe de code-review — US-016 Motor de Cálculo de Tarifa

Rama `feature/us-016-motor-calculo-tarifa` vs `origin/master`. Revisión de solo lectura contra `architecture-guardrails` + `review-checklist`.

## Veredicto: APTO

No hay hallazgos Bloqueantes ni de severidad Alta. Solo notas Media/Baja de mejora, ninguna de las cuales viola un guardrail duro ni el contrato.

---

## Bloqueantes
Ninguno.

## Altos
Ninguno.

## Medios

- **[contrato/consistencia] El error 400 pierde `codigo`/`detalle` de dominio.** `apps/api/src/tarifas/interface/tarifas.controller.ts:81-83`: `ValidacionTarifaError` se mapea a `new BadRequestException(error.message)`, descartando `codigo='VALIDACION'` y `campo`. Los otros tres errores (404/422) sí propagan `codigo`+`detalle`. No es violación de contrato (el 400 referencia `ValidationError`→`ErrorResponse`, que no exige `codigo`), pero rompe la simetría de diagnóstico de la familia de errores del motor. Recomendación: emitir el 400 con el mismo envelope (`codigo: 'VALIDACION'`, `detalle: { campo }`) para paridad y trazabilidad cliente.

## Bajos

- **[determinismo/edge] Rechazo de eventos del mismo día.** `calculadora-tarifa.service.ts:234` valida `fechaEvento.getTime() < clock.ahora()`. Como `fecha_evento` (YYYY-MM-DD) se parsea a medianoche UTC (`controller:52`, `new Date(dto.fecha_evento)`), un evento de **hoy** queda en el pasado respecto a `ahora()` y se rechaza como "fecha pasada". Confirmar intención de producto (¿se exige fecha estrictamente futura?). Si se admite el mismo día, comparar por día UTC, no por instante.

- **[contrato/validación] `IsDateString` es más laxo que el contrato.** `calcular-tarifa.dto.ts:32` usa `@IsDateString()`, que acepta datetimes con offset; el contrato declara `format: date` (solo fecha). Un datetime con offset cerca del cambio de mes podría desplazar `getUTCMonth()` respecto al día local pretendido por el usuario. Recomendación: restringir a fecha pura (p. ej. regex `^\d{4}-\d{2}-\d{2}$`) para casar exactamente con el contrato.

- **[precisión] Aritmética de importes en `number` dentro del dominio.** `calculadora-tarifa.service.ts:269` y `:223` operan `precioEur * cantidad` y sumas en coma flotante. No se viola la regla de `Decimal` (en BD el importe es `Decimal`; se convierte con `.toNumber()` en el borde del adaptador, y D-1 define la salida del motor como `number` en EUR con IVA incluido). Aun así, sumas/multiplicaciones flotantes pueden introducir artefactos de redondeo a céntimos. Recomendación: confirmar estrategia de redondeo a céntimos o trabajar en céntimos enteros internamente.

- **[seguridad/pre-existente] `SET LOCAL` por interpolación.** `apps/api/src/shared/prisma/prisma.service.ts:33` fija el tenant con `$executeRawUnsafe` e interpolación con escape manual de comillas. El `tenantId` proviene del JWT (confiable, UUID) y se escapa, así que el riesgo es bajo; además es código pre-existente, no introducido por esta US. Recomendación futura: `set_config('app.tenant_id', $1, true)` parametrizado.

- **[cobertura residual] Mapeo 422 del controller no ejercitado por HTTP.** El camino dominio→envelope 422 (`codigo`+`detalle`) está cubierto por unit a nivel de dominio, pero no por curl (el sandbox impidió borrar la tarifa del seed). El código replica exactamente el patrón del 404, sí verificado por curl. Aceptable; se deja como nota.

---

## OK / Conforme (verificado)

- **Hexagonal (PASS):** `domain/calculadora-tarifa.service.ts` no importa `@nestjs/*`, `@prisma/*` ni `infrastructure/`. Puertos definidos en dominio; adaptadores en `infrastructure/`; tokens (Symbol) fuera del dominio (`tarifas.tokens.ts`); composición por `useFactory` en `tarifas.module.ts`.
- **Multi-tenancy / RLS (PASS):** `tenantId` siempre del JWT vía `@TenantId` (`controller:49`), nunca del body. Los tres adaptadores (`tarifa`, `extra`, `temporada-calendario`) envuelven la lectura en `$transaction` + `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) y además filtran `where: { tenantId }`. El extra cross-tenant devuelve `null` → `EXTRA_NO_ENCONTRADO` motivo `inexistente`, sin fuga de existencia (verificado por test `debe_lanzar_EXTRA_NO_ENCONTRADO_para_un_extra_de_otro_tenant_por_RLS`).
- **Bloqueo atómico (PASS):** no se introduce Redis/Redlock ni lock distribuido; la lógica de bloqueo no se toca (el cambio en `fecha-bloqueada-concurrencia.spec.ts` es solo conversión a arrow functions).
- **Determinismo / pureza (PASS):** sin mutación de entidades; puertos de solo lectura; `ClockPort` inyectado; orden D-5 correcto (validar → temporada → corte >50 → tarifa → extras). `getUTCMonth()+1` es la **elección correcta**: al parsearse `fecha_evento` como medianoche UTC, evita el desfase de mes que `getMonth()` (local) produciría en husos negativos. Tests de determinismo y no-mutación presentes.
- **Filtro global compartido (PASS / retro-compatible):** `http-exception.filter.ts` añade `codigo`/`detalle` **solo** mediante spread condicional (`...(codigo !== undefined ? ... : {})`). `path` y `timestamp` son líneas de contexto preexistentes (no modificadas). El envelope del resto de endpoints queda intacto. Cambio puramente aditivo y seguro.
- **Contrato vs implementación (PASS):** la respuesta snake_case del controller (`aResponse`) casa campo a campo con `CalculoTarifaResponse` (D-1). Los errores 404 (`CalculoTarifaExtraNoEncontradoError`) y 422 (`oneOf` TARIFA/TEMPORADA) del contrato coinciden con los envelopes del controller, incluidas las claves snake_case del `detalle` (`duracion_horas`, `num_invitados`, `extra_id`, `mes`).
- **Convención arrow functions (PASS):** regla `func-style: ['error','expression']` + `prefer-arrow-callback` añadida en ESLint de `apps/api` y `apps/web` y documentada en `CLAUDE.md`. El código nuevo cumple; las funciones declarativas existentes (`validarEntorno`, `bootstrap`, helpers del spec de concurrencia) se convirtieron a flecha. Grep repo-wide: **0** declaraciones `function` nombradas restantes → `pnpm lint` no se rompe. Métodos de clase quedan correctamente exentos.
- **Tipos / datos (PASS):** TS strict mantenido (`noImplicitAny: true`); sin `any` ni `Float` en el código nuevo. BD `Decimal` → `.toNumber()` en el borde del adaptador, documentado. DTOs validados con `class-validator`.
- **Tests significativos (PASS):** 42 casos cubren resolución de temporada, versionado de tarifa por fecha, distinción de tramos/duración, exclusión de menores de 4, corte >50 (a consultar con nulos), suma de extras, extra inactivo, RLS cross-tenant, esquema canónico en ambos casos, validaciones y determinismo/no-mutación. No es smoke.
- **Convenciones de nombres (PASS):** ficheros kebab-case, clases PascalCase, variables camelCase, errores y mensajes en español. Sin código muerto.

---

## Resumen
- **Veredicto: APTO** (sin bloqueantes; mejoras Media/Baja opcionales).
- Hallazgos: 1 Media (400 sin `codigo`/`detalle`), 5 Bajas (mismo-día rechazado, `IsDateString` laxo vs contrato, aritmética float de importes, `SET LOCAL` interpolado pre-existente, 422-HTTP no ejercitado por curl).
- Guardrails duros (hexagonal, RLS/multi-tenancy, sin lock distribuido, contrato, arrow convention, filtro retro-compatible): todos conformes.
