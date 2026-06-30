# Tasks — us-039-consultar-calendario

> Pasos obligatorios de `openspec/config.yaml`, en orden. Esta US **toca API**
> (endpoint nuevo `GET /calendario`) y tiene **capa back + front**. El AGENTE DEBE
> ejecutar él mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el
> usuario. Cada `[x]` solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-039-consultar-calendario/reports/`.
>
> Recordatorio de alcance: **lectura pura**, sin mutación; **sin tests de
> concurrencia** (heredados de US-040, ya archivada); la **vista de cola (US-017)**
> queda fuera de alcance (solo se enlaza desde el indicador `🔁`).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-039-consultar-calendario` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/calendario/spec.md`) +
      `design.md` (en especial **D-1**: un endpoint de lectura agregado por rango;
      **D-2**: derivación del color como tabla de datos; **D-6**: librería de calendario
      negociable; **D-7**: por qué NO hay tests de concurrencia) y **ESPERAR su OK
      explícito**
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Definir `GET /calendario` (query `desde`, `hasta`, `vista`; respuesta 200 con
      `rango` + `fechas[]` agregadas: `fecha`, `color`, `estado`, `subEstado`,
      `reservaId`, `cliente`, `ttlRestante`, `enCola`; 401 sin sesión; 422 rango
      inválido) según `design.md §D-1`. Endpoint de **solo lectura**
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde (o validación equivalente vía
      `validate-openapi` si spectral no está instalado)
- [x] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
> Sin tests de race condition (lectura pura; garantías de concurrencia en US-040 — D-7).
- [x] 3.1 Test de la **función pura de derivación de color** (D-2): todas las filas de la
      tabla — gris (`2a`/`2b`/`2c`/`2v`), ámbar (`pre_reserva`), verde
      (`reserva_confirmada`/`evento_en_curso`/`post_evento`), azul (`reserva_completada`),
      rojo (`reserva_cancelada`); herencia verde de en_curso/post_evento; exclusión de
      terminales `2x`/`2y`/`2z` (en rojo)
- [x] 3.2 Test del use-case de agregación: por fecha ocupada del tenant devuelve
      color/estado/subEstado + `reservaId`/`cliente`/`ttlRestante`; las fechas **libres
      no aparecen** en la respuesta (en rojo)
- [x] 3.3 Test del **conteo de cola** (D-3): `enCola = N` cuando hay N reservas en `2d`
      con `consulta_bloqueante_id` apuntando a la reserva bloqueante; `enCola = 0` sin
      cola (en rojo)
- [x] 3.4 Test de **aislamiento multi-tenant** (D-4): con `tenant_id` T-001 la query no
      devuelve fechas de otros tenants (en rojo)
- [x] 3.5 Test de **no-mutación**: el use-case no escribe `RESERVA` ni `FECHA_BLOQUEADA`
      (en rojo)
- [x] 3.6 Test de edge cases: mes vacío → `fechas: []`; fechas pasadas con consulta
      activa se muestran (auditoría) y no se bloquean en UI (en rojo)
- [x] 3.7 Confirmar que toda la batería está **en rojo** antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests existentes que toquen el modelo de `RESERVA`/`FECHA_BLOQUEADA`
      o el contexto de tenant/RLS; confirmar regresión cero (esta US no modifica esas
      escrituras, solo lee)

## 5. Implementación backend + frontend (post-gate — dueño: `backend-developer` / `frontend-developer`)
- [x] 5.1 Backend: función pura de dominio de **derivación de color** (tabla de datos, no
      `if` dispersos) (D-2)
- [x] 5.2 Backend: puerto de consulta (interfaz en `domain/`) + adaptador Prisma en
      `infrastructure/` con filtro **obligatorio por `tenant_id`** + RLS; use-case
      `obtener-calendario` que agrega fechas ocupadas del rango y calcula `enCola`
      (D-1/D-3/D-4/D-5). `domain/` no importa Prisma/NestJS
- [x] 5.3 Backend: controller NestJS `GET /calendario` (DTO de query `desde`/`hasta`/
      `vista`, mapeo 200/401/422) (D-1); registrar el módulo `calendario`
- [x] 5.4 Frontend: feature `apps/web/src/features/calendario/` (Bulletproof React:
      `api/ components/ lib/ model/ pages/` + barrel); render mes/semana/día/lista con la
      librería elegida (FullCalendar o react-big-calendar — D-6), código de colores
      consistente entre vistas usando los **tokens** de US-000A, navegación entre
      períodos; indicador `🔁 N en cola`; popover de detalle al clic (cliente/subEstado/
      TTL/enlace a ficha) sin segunda llamada; clic en `🔁` → navega a la cola (US-017,
      placeholder/enlace). Mobile-first responsive (390/768/1280)
- [x] 5.5 Frontend: cablear el Calendario como **página de inicio** del slot Calendario
      del App Shell (sidebar → primera opción)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `fecha_bloqueada`) para confirmar
      **lectura pura** (sin cambios tras los tests)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (derivación de color,
      use-case de agregación, conteo de cola, aislamiento, no-mutación)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar que la BD queda **idéntica** al baseline (la vista no muta nada);
      restaurar si hace falta
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 GET `/calendario?desde=...&hasta=...&vista=mes` sobre un mes con reservas en
      distintos estados → 200; verificar color/estado/subEstado por fecha y que las
      fechas libres no aparecen
- [x] 7.3 GET sobre una fecha bloqueante con reservas en `2d` → `enCola = N` correcto;
      sin cola → `enCola = 0`
- [x] 7.4 GET sobre un mes vacío → 200 con `fechas: []`
- [x] 7.5 GET sobre un mes pasado → completadas (azul), canceladas (rojo) y terminales
      `2x`/`2y`/`2z` ausentes (sin color)
- [x] 7.6 GET con **JWT de otro tenant** → no aparecen datos del primero (aislamiento)
- [x] 7.7 Casos de error: sin sesión → 401; rango inválido → 422; verificar que el
      formato de error coincide con el contrato OpenAPI
- [x] 7.8 Confirmar que ningún GET muta la BD (lectura pura: counts intactos)
- [x] 7.9 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Login y verificar que el **Calendario es la página de inicio** (sidebar →
      primera opción) (`browser_navigate`)
- [x] 8.3 Verificar la vista mensual con el código de colores canónico por estado
- [x] 8.4 Cambiar a semana/día/lista y navegar entre períodos: el código de colores se
      mantiene idéntico
- [x] 8.5 Verificar el indicador `🔁 N en cola` sobre la fecha bloqueante; clic en `🔁`
      → navega/abre la vista de cola (US-017, enlace)
- [x] 8.6 Clic en una fecha con bloqueo activo → popover con cliente/subEstado/TTL/enlace
      a ficha (sin mutación)
- [x] 8.7 Verificar mes vacío navegable sin errores
- [x] 8.8 Verificar responsive en 3 viewports (390 / 768 / 1280) sin overflow horizontal
- [x] 8.9 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD (la vista no muta)
- [x] 8.10 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (nueva capability `calendario`: vista de
      lectura agregada, derivación de color desde estado/sub_estado, conteo de cola,
      aislamiento multi-tenant/RLS) y la trazabilidad de la US (`docs/use-cases.md` UC-29,
      `docs/er-diagram.md` lectura de `RESERVA`/`FECHA_BLOQUEADA`,
      `docs/architecture.md`). Reflejar el nuevo `GET /calendario` documentado por el
      `contract-engineer`. Sin migración (no hay cambios de esquema)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal — `domain/` sin
      Prisma/NestJS; RLS + filtro por `tenant_id`; **lectura pura sin mutación**; sin
      bloqueo distribuido; sin editar cliente generado; derivación de color como tabla de
      datos; tokens de color de US-000A, no hex inline; responsive 390/768/1280;
      código de colores consistente entre vistas)
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [x] 12.1 `openspec archive us-039-consultar-calendario` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [x] 12.2 Actualizar `openspec/specs/` y abrir PR
