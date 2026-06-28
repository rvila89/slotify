# Code Review — us-004-alta-consulta-con-fecha

- Fecha: 2026-06-28
- Revisor: code-reviewer (gate duro, solo lectura)
- Rama: `feature/us-004-alta-consulta-con-fecha` (cambios en working tree sobre `master` b7c5928)
- Alcance: diff backend + frontend + contrato + migración del change US-004 / UC-03

## Resumen ejecutivo

La implementación del núcleo crítico es **sólida y fiel al diseño**: atomicidad D4
real, cero locks distribuidos, hexagonal limpio, multi-tenancy/RLS correcto,
divergencia `> hoy` unificada y documentada, migración aditiva aplicada y tarifa
tolerante. `pnpm lint` (api y web) pasa limpio.

Sin embargo, hay **un defecto de conformidad de contrato** en el campo decorativo
`tarifaEstimada` que rompe silenciosamente a un consumidor real (el frontend). En un
proyecto donde el contrato OpenAPI + SDK generado es la frontera dura, esto es
bloqueante.

---

## Hallazgos

### BLOQUEANTE

**B-1. `tarifaEstimada` del response NO conforma al contrato (camelCase vs snake_case) → frontend roto en silencio**

- Regla violada: «Contrato: DTOs coinciden con `docs/api-spec.yml`» + «el cliente del
  frontend (generado) es la frontera». El payload real no coincide con el esquema
  declarado que el SDK genera.
- Evidencia:
  - Contrato: `docs/api-spec.yml` → `CreateReservaResponse.tarifaEstimada` referencia
    `CalculoTarifaResponse`, que es **snake_case** (`total_eur`, `tarifa_a_consultar`,
    `precio_tarifa_eur`, `extras_total_eur`, `tarifa_id`). Reflejado en el SDK
    generado `apps/web/src/api-client/schema.d.ts:2040` y `:2172-2189`.
  - Backend: `apps/api/src/reservas/interface/create-reserva.dto.ts:117-135`
    (`TarifaEstimadaResponseDto`) y `apps/api/src/reservas/interface/alta-consulta.controller.ts:93-104`
    emiten **camelCase** (`totalEur`, `tarifaAConsultar`, `precioTarifaEur`, …).
  - Payload real (curl report `reports/...step-N+2...md:59-65`): `"totalEur": 902,
    "tarifaAConsultar": false, "precioTarifaEur": ...` → confirma camelCase; no hay
    interceptor de serialización snake_case.
  - Consumidor roto: `apps/web/src/reservas/NuevaConsultaPage.tsx:343`
    `const tarifaTotal = reserva?.tarifaEstimada?.total_eur;` lee snake_case → siempre
    `undefined` → el guard `typeof tarifaTotal === 'number'` (líneas 377-382) es
    siempre falso → la línea «tarifa estimada» del aviso 2b **nunca se muestra**, aun
    cuando el motor calculó la tarifa. El e2e (`e2e/us-004-...spec.ts`) no asserta la
    tarifa, por eso no se detectó.
- Impacto: el contrato publicado miente sobre la forma del payload; el SDK generado es
  inconsistente con la respuesta real; un consumidor in-repo (UI) queda roto de forma
  silenciosa. No corrompe datos ni rompe el alta (degradación grácil), pero viola la
  frontera dura del proyecto.
- Recomendación (elegir una y rehacer SDK + ajustar consumidor; dueño: contract-engineer):
  - (a) Definir en el contrato un esquema camelCase propio para `tarifaEstimada`
    (p. ej. `TarifaEstimada`), regenerar el SDK y dejar el frontend leyendo `totalEur`; o
  - (b) Hacer que el adapter/DTO emitan snake_case para conformar realmente a
    `CalculoTarifaResponse` (y que el frontend siga leyendo `total_eur`).
  - Añadir una assertion e2e/curl que verifique el render del importe estimado en el
    aviso 2b para evitar regresión.

---

## Verificado correcto (puntos de atención especial)

- **Atomicidad D4**: RESERVA `2b` + `FECHA_BLOQUEADA` se crean dentro de la MISMA
  `$transaction` (`unidad-de-trabajo.prisma.adapter.ts:406-425`, todo el `trabajo` del
  use-case corre en una sola tx). El bloqueo reutiliza `bloquearEnTx(tx, …)`
  (`fecha-bloqueada.prisma.adapter.ts:147-172`) con el `tx` del alta; el `bloquear()`
  público de US-040 queda como wrapper idéntico (regresión cero). En `2d`/`2a` NO se
  inserta `FECHA_BLOQUEADA` (no doble bloqueo): `alta-consulta.use-case.ts:514-521`.
- **Cola serializada (D-5)**: `siguientePosicionCola` hace `SELECT … FOR UPDATE` sobre
  la fila bloqueante de `fecha_bloqueada` y luego `MAX(posicion_cola)+1`
  (`unidad-de-trabajo.prisma.adapter.ts:313-335`). Defensa en profundidad con índice
  UNIQUE parcial.
- **Re-derivación D4 (D-6)**: el `P2002` crudo del INSERT se propaga; la UoW lo
  reconoce como reintentable (`esColisionReintentable`, target `fecha`/`codigo`/
  `posicion_cola`; `reserva_id` excluido correctamente) y REABRE la tx; como
  `resolverPlanAlta` corre dentro del `trabajo`, re-deriva `libre→2b`→colisión→
  `bloqueada-por-2b`→`2d` (`unidad-de-trabajo...:348-404`, `alta-consulta.use-case.ts:591-651`).
- **Sin locks distribuidos**: solo `UNIQUE(tenant_id,fecha)` + `SELECT … FOR UPDATE`;
  ningún Redis/Redlock/timer. Cumple el guardrail.
- **Hexagonal**: `domain/maquina-estados.ts` y `domain/bloquear-fecha.service.ts` son
  puros (sin `@nestjs/*`/`@prisma/*`/infra). El use-case (application) solo importa
  dominio y puertos `type`. Adaptadores en `infrastructure/`. Tabla declarativa
  `REGLAS_ALTA_CON_FECHA` + `determinarAltaConFecha` (no if/else disperso).
- **Multi-tenancy/RLS**: `fijarTenant(tx, tenantId)` es la primera operación de cada
  tx (alta y cola); todas las queries filtran `tenant_id`; el `tenantId`/`usuarioId`
  vienen del JWT (`@CurrentUser`), nunca del body (`alta-consulta.controller.ts:45-47`).
- **No regresión 2a (US-003)**: sin `fechaEvento` → `entradaInicialConsultaExploratoria`
  (`2a`, ttl NULL, sin bloqueo) y sin tocar `fechaBloqueada` (use-case:596-605).
- **Divergencia `> hoy`**: regla única `esFechaEstrictamenteFutura`
  (`bloquear-fecha.service.ts:233-238`) compartida por US-040 y el alta; rechazo 400
  sin efectos (use-case:431-438); documentada como divergencia intencional aprobada en
  Gate 1 (design D-1, spec-delta «Validación de fecha_evento estrictamente futura»).
- **Migración aditiva D-8**: `20260628120000_us004_cola_posicion_unique/migration.sql`
  crea índice UNIQUE PARCIAL `reserva_cola_posicion_key` `WHERE posicion_cola IS NOT
  NULL`; aditiva, comentada en `schema.prisma`.
- **Tarifa tolerante (D-4)**: `calcularTarifaTolerante` solo invoca el puerto con
  fecha+invitados+horas, degrada a `null` ante faltas/errores (try/catch); no se
  persiste; no bloquea el alta (use-case:684-707). El cuerpo de E1 se construye con el
  tipo interno camelCase, correcto (`construirCuerpoE1`).
- **Frontend**: usa exclusivamente el SDK generado (`apiClient.POST('/reservas')`), no
  editado a mano; RHF+Zod con regla `> hoy` y `min=mañana` en el date picker; avisos
  2a/2b/2d/borrador/auto-envío; mobile-first (`grid-cols-1 sm:grid-cols-2`,
  `p-4 sm:p-6 lg:p-10`, sin anchos px fijos rompibles; el chrome sidebar→drawer lo
  aporta el AppShell); arrow functions; `pnpm lint` web limpio.
- **Lint**: `apps/api` y `apps/web` ESLint sin errores.

## Observaciones menores (no bloqueantes)

- O-1: `siguientePosicionCola` calcula `MAX` por `(tenant_id, fecha_evento)` mientras el
  índice UNIQUE es por `(tenant_id, consulta_bloqueante_id, posicion_cola)`. Coinciden
  mientras haya un único bloqueante activo por fecha (caso de US-004); se recomienda
  documentar/alinear la partición de cara a la promoción de cola (UC-11/12/13).
- O-2: Entre `leerEstadoFecha` (sin lock) y el `FOR UPDATE` de la cola, una liberación
  concurrente del bloqueante (fuera de alcance US-004) podría dejar un `2d` apuntando a
  un bloqueante ya sin `FECHA_BLOQUEADA`. La FK self-relation a `reserva` sigue siendo
  válida; aceptable para el alcance actual, revisar al implementar la promoción.
- O-3: Importes de tarifa viajan como `number` (no `Decimal`); aceptable por ser
  decorativos y no persistirse (D-4), pero conviene vigilar precisión si en el futuro
  se persisten.

---

Veredicto inicial (superado por la re-revisión posterior): NO APTO

---

## Re-revisión — 2026-06-28 (tras fix de B-1)

- Revisor: code-reviewer (gate duro, solo lectura)
- Alcance: verificación del fix de B-1 + comprobación de no-regresión sobre el resto de guardrails ya validados.

### B-1 — RESUELTO y conforme

El campo `tarifaEstimada` queda alineado en **camelCase** en toda la cadena, sin reutilizar `CalculoTarifaResponse`:

- **Contrato** (`docs/api-spec.yml:1282-1312`): nuevo schema `TarifaEstimada` camelCase
  (`temporada`, `tarifaAConsultar`, `precioTarifaEur`, `extrasTotalEur`, `totalEur`,
  `tarifaId`), todos opcionales y los importes/ids `nullable`. `CreateReservaResponse.tarifaEstimada`
  (`:1272-1273`) apunta a `TarifaEstimada` con `nullable: true` y descripción que aclara que NO es
  el `CalculoTarifaResponse` del motor.
- **Motor UC-16 intacto**: `CalculoTarifaResponse` (`:1490-1520`) sigue snake_case y con `required`
  completo; no se tocó.
- **SDK** (`apps/web/src/api-client/schema.d.ts:2042-2058`): `TarifaEstimada` regenerado en camelCase.
  `pnpm generate-client` reproduce EXACTAMENTE el fichero versionado (diff vacío) → el cliente
  generado conforma al contrato y NO está editado a mano.
- **Backend** (`create-reserva.dto.ts:117-135` `TarifaEstimadaResponseDto`;
  `alta-consulta.controller.ts:93-104`): emiten camelCase, coincidiendo con el contrato; el tipo
  interno `TarifaEstimadaResultado` (`alta-consulta.use-case.ts:270-276`) es camelCase y casa 1:1
  con la emisión.
- **Frontend** (`NuevaConsultaPage.tsx:343`): `reserva?.tarifaEstimada?.totalEur` (camelCase). El
  importe se renderiza dentro de `alerta-fecha-bloqueada` (2b) en
  `data-testid="tarifa-estimada-importe"` (`:377-382`) bajo el guard `typeof tarifaTotal === 'number'`.
- **Test de regresión** (`e2e/us-004-alta-consulta-con-fecha.spec.ts:168-176`): asserta visibilidad
  del importe en el aviso 2b y el valor concreto (`/1[.,]?076/`), cerrando el hueco que ocultó B-1.
- No quedan lecturas/emisiones snake_case del objeto decorativo en `apps/web/src/reservas`,
  `interface/` ni `application/` (grep limpio).

### No-regresión por el fix

- `pnpm --filter web exec tsc --noEmit`: OK. `pnpm --filter web lint`: OK.
- `pnpm --filter api lint`: OK. `pnpm --filter api tsc --noEmit`: OK.
- Diff del SDK acotado a `TarifaEstimada` + campos transitorios de `CreateReservaResponse`; sin
  marcas de edición manual.
- El fix es aditivo en contrato (nuevo schema + cambio de `$ref` del campo decorativo) y no altera
  la atomicidad D4, el bloqueo (`UNIQUE` + `FOR UPDATE`, sin locks distribuidos), la jerarquía
  hexagonal, RLS/multi-tenancy, la migración aditiva D-8, la tolerancia de tarifa (D-4), la
  no-regresión 2a/`bloquear()` público ni la divergencia `> hoy` documentada — todos ya verificados
  en la revisión anterior y no tocados por este cambio.

### Bloqueantes nuevos

Ninguno.

### Observaciones menores pendientes

- O-1, O-2 y O-3 de la revisión anterior siguen abiertas como no bloqueantes (partición de cola de
  cara a la promoción UC-11/12/13; ventana leer/`FOR UPDATE` en liberación concurrente; importes de
  tarifa como `number` decorativo). No requieren acción en US-004.

Veredicto: APTO
