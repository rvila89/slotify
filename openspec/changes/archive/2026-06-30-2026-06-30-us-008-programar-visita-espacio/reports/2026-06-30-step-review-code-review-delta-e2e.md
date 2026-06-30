# Code-review (DELTA E2E) — US-008 Programar visita al espacio

- **Change**: `2026-06-30-us-008-programar-visita-espacio`
- **Fecha**: 2026-06-30
- **Tipo**: re-revisión del DELTA aplicado tras el E2E (step 8). Solo lectura.
- **Informe base**: `reports/2026-06-30-step-review-code-review.md` (Veredicto: APTO) — sigue vigente sobre el grueso de la US.
- **Rama**: `feature/us-008-programar-visita-espacio` vs `master`.

## Alcance de esta re-revisión

Únicamente el fix del **bucle de render infinito** (`Maximum update depth exceeded`) detectado en `/reservas/:id` durante el E2E real. El bug era invisible a curl y a la revisión estática porque React corta el bucle; solo el E2E lo destapó (6710 errores de consola).

Ficheros del delta:
- `apps/web/src/features/reservas/components/ProgramarVisitaDialog.tsx` (fichero nuevo de US-008; el fix forma parte de su versión inicial)
- `apps/web/src/features/reservas/components/AnadirFechaDialog.tsx` (US-005, modificado)
- `apps/web/src/features/reservas/components/PendienteInvitadosDialog.tsx` (US-007, modificado)

## Causa raíz (confirmada)

El `useEffect` de reseteo al cerrar el diálogo llamaba a `mutation.reset()` y declaraba el objeto **`mutation` completo** en sus deps. El resultado de `useMutation` (TanStack Query v5) es un objeto nuevo en cada render; con el efecto en deps el ciclo era: render → efecto → `reset()` provoca re-render → nuevo objeto `mutation` → efecto se vuelve a disparar → bucle. Patrón sistémico replicado en los 3 diálogos a partir de `AnadirFechaDialog`.

## Hallazgos

### 1. Corrección del fix — OK (sin hallazgos)
- En los 3 ficheros se extrae `const { reset: resetMutation } = mutation;` y las deps pasan a `[abierto, resetMutation, (reset)]`. Verificado por lectura directa:
  - `ProgramarVisitaDialog.tsx:114` + deps `:122` → `[abierto, resetMutation, reset]`.
  - `AnadirFechaDialog.tsx:100` + deps `:111` → `[abierto, resetMutation, reset]`.
  - `PendienteInvitadosDialog.tsx:66` + deps `:74` → `[abierto, resetMutation]`.
- Premisa de estabilidad **verificada**: los tres hooks (`useProgramarVisita`, `useAsignarFecha`, `usePendienteInvitados`) devuelven directamente `useMutation(...)` de `@tanstack/react-query` v5. En esa versión `reset` es un callback estable (memoizado por la librería); el objeto resultado no lo es. El fix ataca exactamente la dependencia inestable.
- `reset` de react-hook-form (presente en los dos diálogos con formulario) también es referencialmente estable, por lo que su inclusión en deps no reintroduce el bucle.
- **Comportamiento de reseteo preservado**: el cuerpo del efecto es idéntico al previo (mismas llamadas `setPaso`/`setError(null)`/`resetMutation()`/`reset({...})`); solo cambia la referencia invocada, no la semántica. Al cerrar el diálogo se sigue limpiando estado de mutación y formulario.

### 2. Anti-patrón residual — NINGUNO
- Barrido en `apps/web/src` de arrays de deps de `useEffect` que contengan el identificador `mutation`: **0 coincidencias** (`AnadirFechaDialog`, `PendienteInvitadosDialog`, `ProgramarVisitaDialog` ya saneados).
- Otros usos de `mutation` en la app (`NuevaConsultaPage.tsx`, `LoginPage.tsx`) lo consumen solo en handlers y JSX (`mutation.mutate`, `mutation.isPending`), nunca en deps de un efecto. No procede.

### 3. Guardrails — OK
- **Arrow functions**: los componentes y helpers afectados siguen siendo expresiones de flecha; el delta no introduce `function` declarativo.
- **Estructura por feature**: cambios contenidos en `features/reservas/components/`; sin cruces de capa ni imports fuera del barrel.
- **Cliente generado**: el delta no toca `apps/web/src/api-client/*`; el fix vive en componentes, consumiendo el SDK ya generado.
- **Responsive**: el delta no altera markup ni clases de layout (solo deps de un efecto); el E2E re-ejecutado verificó 390/768/1280 sin overflow.
- **Verificación del autor**: `typecheck` y `lint` en `@slotify/web` con exit 0; E2E re-ejecutado con 0 errores de consola, happy path 2b→2v + persistencia BD, ventana de fecha y estados 2d/2a-sin-fecha OK (`reports/2026-06-30-step-8-e2e-playwright.md`).

## Observación NO bloqueante (cross-cutting)

Zona horaria en el display del `ttlExpiracion` vía `formatearFechaHora` (helper compartido): un ttl `2026-07-04 23:59:59` se renderiza como "5 de julio" por la conversión UTC→local. Es un problema transversal del helper compartido, ajeno al fix del bucle y al alcance de US-008. **No bloquea** este veredicto; se recomienda tratarlo en un change aparte.

## Conclusión

El fix elimina la dependencia inestable que causaba el bucle, conserva intacta la semántica de reseteo al cerrar, no introduce regresiones ni viola guardrails, y no quedan otras ocurrencias del anti-patrón en la feature. El veredicto APTO del informe base se mantiene y se extiende a este delta.

Veredicto: APTO
