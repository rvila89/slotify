# Informe FINAL de code-review — `presupuesto-confirmar-ux-e2-idioma`

Fecha: 2026-07-20
Rama: `feature/layout-appshell-ancho-titulos-sidebar` (worktree `presupuesto-confirmar-ux-e2-idioma`)
Base de comparación: árbol de trabajo (tracked + untracked del change) vs `master`.
Alcance: E2 bilingüe (ES/CA) en el catálogo + propagación de idioma del disparo, UX de
confirmación de presupuesto (scroll, badge de estado siempre visible, refresco de
comunicaciones) **y** la ampliación del workstream C: "estado siempre visible" extendido a
los estados TERMINALES.

Este informe CONSOLIDA y sustituye al previo
(`2026-07-19-step-review-code-review.md`, Veredicto: APTO), incorporando la ampliación
posterior.

## Resumen ejecutivo

El cambio completo sigue siendo correcto, coherente con los guardrails y bien cubierto por
tests (TDD, con trazabilidad al spec-delta). La ampliación (terminales en el badge) es una
extensión mínima, declarativa y sin deriva de la fuente de verdad. Sin bloqueantes.

- Backend: 55/55 tests verdes en las 4 suites tocadas (E2 catálogo, motor, adaptador).
- Frontend: `Badge.test.tsx` 7/7 verde (los 5 previos + 2 nuevos de terminales); resto del
  workstream previo (scroll, invalidación de comunicaciones) sin cambios.
- Lint frontend de los ficheros de la ampliación sin errores (solo warnings de deprecación
  de `eslint-plugin-boundaries`, ajenos al change).
- `openspec validate presupuesto-confirmar-ux-e2-idioma --strict` → válido.

## Revisión de la ampliación (workstream C — terminales)

- **`features/reservas/lib/etiquetaEstado.ts`**: OK.
  - Vive en `lib/` (no en `components/`): respeta el guardrail «`components/` solo `.tsx`».
  - `etiquetaEstadoPrincipal` es arrow function; el módulo no exporta componentes.
  - NO duplica ni diverge de `COLUMNAS_KANBAN`: las fases del pipeline siguen saliendo del
    kanban (`LABEL_POR_COLUMNA` derivado de `COLUMNAS_KANBAN` vía `columnaDeReserva`). Solo
    los TERMINALES —que por diseño no tienen columna en el pipeline
    (`columnasKanban.ts` los devuelve `null`)— se declaran aparte en `LABEL_TERMINAL`
    (`reserva_cancelada → «Cancelada»`, `reserva_completada → «Completada»`). No hay cadena
    duplicada entre ambos mapas.
  - Fallback correcto: si hay columna usa la etiqueta del kanban; si no, cae a
    `LABEL_TERMINAL`; en último término `null`.
  - Solo `consulta` sin sub-estado devuelve `null`: verificado por lógica —
    `columnaDeReserva({ estado: 'consulta' })` sin `subEstado` activo → `null`, y
    `LABEL_TERMINAL['consulta']` es `undefined` → `null`. Los demás estados no-consulta
    resuelven a columna o a terminal. `Reserva['estado']` incluye
    `reserva_cancelada`/`reserva_completada` (miembros de `EstadoReserva` usados en todo el
    dominio front), por lo que el mapa está bien tipado (sin `any`).
- **`FichaConsulta/components/Badge.tsx`**: OK (sin cambios respecto al informe previo).
  - Muestra siempre `subEstado` o, en su defecto, la etiqueta del estado principal/terminal.
  - Los terminales caen al `tono` neutro por defecto
    (`border-border-default bg-surface-muted text-text-secondary`): solo `2b`/`2d`
    especializan color; ningún terminal rompe el estilo.
  - Responsive intacto: `inline-flex … rounded-full px-3 py-1`, sin anchos px fijos ni
    overflow. La ampliación es de datos (texto), no de layout; no aplica evidencia de 3
    viewports con impacto real (no hay nuevo layout ni ancho fijo).
- **`Badge.test.tsx`**: OK. +2 casos (`reserva_cancelada → «Cancelada»`,
  `reserva_completada → «Completada»`). Suite completa 7/7 verde (ejecutada).
- **spec-delta `pipeline-ui`**: OK. El requirement "El estado de la reserva es siempre
  visible en la FichaConsulta" y sus scenarios se ampliaron para incluir los terminales
  (nuevo scenario "Los estados terminales también muestran su etiqueta"), consistente con el
  código. `openspec validate --strict` pasa.

## Confirmación del resto del change (sigue como en el informe previo APTO)

- **E2 bilingüe ES/CA (`apps/api`)**: sin cambios respecto al informe previo. Registros
  ES/CA en `catalogo-plantillas.ts`, `seleccionar` devuelve `null` para idiomas ≠ es/ca
  (fallback+auditoría delegados al motor `DespacharEmailService`). Motor de email NO
  reimplementado; idempotencia `(reserva_id, codigo_email)` intacta; fire-and-forget
  post-commit conservado.
- **Propagación de idioma**: `disparar-e2.adapter.ts` añade `idioma: reserva.idioma` (un
  campo de la RESERVA ya filtrada por `tenantId` de JWT); sin fugas de tenant desde
  path/body; hexagonal respetado (cambio en `infrastructure/`, `domain/` intacto).
- **UX scroll**: `FichaConsultaPage` sube al top tras confirmar presupuesto (precedente
  `NuevaConsultaPage`), con guarda `typeof window !== 'undefined'`.
- **Invalidación de comunicaciones**: `useConfirmarPresupuesto` invalida
  `comunicacionesReservaQueryKey(id)` importado desde el barrel `@/features/comunicaciones`;
  no edita el cliente HTTP generado a mano.

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Alta
- Ninguna.

### Media
- Ninguna.

### Baja
- **[higiene de repo]** `apps/api/_verify_e2.cjs` (untracked) es un script de verificación
  ad-hoc de QA (findUnique de una reserva concreta hardcodeada + FECHA_BLOQUEADA). No forma
  parte del change y no debe commitearse. Recomendación: eliminarlo antes de PR/archive (o
  moverlo a `reports/` si se quiere conservar la evidencia). No bloquea el merge.
- **[claridad, ya reportado]** `Badge.tsx` mantiene `data-testid="badge-sub-estado"` aunque
  ahora renderiza también estados principales y terminales. Comportamiento correcto; solo el
  nombre del testid queda desactualizado. Recomendación (opcional): renombrar a
  `badge-estado`. No bloquea.
- **[DRY, ya reportado]** Conviven `etiquetaEstadoPrincipal` (nuevo, `lib/etiquetaEstado.ts`)
  y `etiquetaEstado` (existente, `ReservasPage/estadoLabel.ts`). No divergen (ambos anclados
  a `COLUMNAS_KANBAN`), difieren de forma intencionada en firma y caso "sin columna". A
  futuro, unificar en un único helper de `lib/`. No bloquea.

## Notas

- Todo el change sigue sin commitear (tracked modificados + varios untracked del change:
  `etiquetaEstado.ts`, `__tests__/Badge.test.tsx`, `api/__tests__/`, `FichaConsulta/__tests__/`,
  `openspec/changes/...`). Debe commitearse antes de PR/archive. Excluir `_verify_e2.cjs`.

## Veredicto

El change completo y su ampliación están alineados con los guardrails, con TDD real y suites
verdes (backend 55/55, Badge 7/7). Los hallazgos Baja son higiene/mejoras opcionales, no
bloqueantes.

Veredicto: APTO
