# Informe de code-review — `presupuesto-confirmar-ux-e2-idioma`

Fecha: 2026-07-19
Rama: `feature/layout-appshell-ancho-titulos-sidebar` (worktree `presupuesto-confirmar-ux-e2-idioma`)
Base de comparación: cambios en árbol de trabajo vs `master` (no commiteados).
Alcance: E2 bilingüe (ES/CA) en el catálogo + propagación de idioma del disparo, UX de confirmación de presupuesto (scroll, badge de estado, refresco de comunicaciones).

## Resumen ejecutivo

El cambio es correcto, coherente con los guardrails y bien cubierto por tests (TDD, con
comentarios RED y trazabilidad al spec-delta). Backend: 55 tests verdes en las 4 suites tocadas.
Frontend: 7 tests verdes en las 3 suites nuevas. Lint frontend de los 4 ficheros tocados sin
errores. No hay bloqueantes.

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Alta
- Ninguna.

### Media
- Ninguna.

### Baja
- **[DRY / convenciones]** Existen dos helpers de etiqueta de estado que comparten la
  fuente de verdad (`COLUMNAS_KANBAN` + `columnaDeReserva`):
  - `apps/web/src/features/reservas/lib/etiquetaEstado.ts` (nuevo) — `etiquetaEstadoPrincipal(estado)`, devuelve `null` para estados sin columna.
  - `apps/web/src/features/reservas/pages/ReservasPage/estadoLabel.ts` (existente) — `etiquetaEstado(reserva)`, cae al `estado` crudo.
  No divergen (ambos reutilizan el mapa declarativo del Kanban, sin duplicar cadenas), por lo
  que NO es una violación del guardrail. Difieren de forma intencionada en firma y en el
  caso "sin columna". Recomendación (opcional): a futuro unificar en un único helper en
  `features/reservas/lib/` con dos exportaciones (con/sin fallback) para evitar deriva. No
  bloquea el merge.
- **[claridad]** `Badge.tsx` mantiene `data-testid="badge-sub-estado"` aunque ahora también
  renderiza estados principales; el `tono` solo especializa `2b`/`2d` y cae a neutral para
  el estado principal. Comportamiento correcto (sin estilo roto), solo nombre del testid algo
  desactualizado. Recomendación (opcional): renombrar a `badge-estado`. No bloquea.

## Verificación del checklist

- **Hexagonal (backend)**: OK. Los cambios viven en `infrastructure/` (`catalogo-plantillas.ts`,
  `disparar-e2.adapter.ts`). `domain/` no se toca; el adaptador depende del puerto
  `DispararE2Port` y del motor de aplicación, sin fugas de framework hacia dominio.
- **Motor de email NO reimplementado**: OK. `DispararE2Adapter` sigue delegando en
  `DespacharEmailService.despachar(...)`. El único cambio del adaptador es propagar
  `idioma: reserva.idioma` (línea 82). No se duplica ni bypassa el motor.
- **Idempotencia E2 `(reserva_id, codigo_email)`**: intacta. El paso 2 del motor
  (`buscarPorReservaYCodigo` → `idempotente`) no se toca; el índice UNIQUE parcial sigue siendo
  la frontera.
- **Fire-and-forget post-commit**: OK. El adaptador lee la reserva en su propia `$transaction`,
  arma adjuntos (con `.catch(() => null)` para no propagar fallos de PDF) y despacha; un fallo
  del proveedor se traza en COMUNICACION sin propagar excepción → no revierte `pre_reserva`.
- **Cambio en `seleccionar` (null para idiomas ≠ es/ca)**: correcto y NO oculta regresión.
  Antes, un idioma no soportado recibía silenciosamente el registro `es`. Ahora `seleccionar`
  devuelve `null` y el FALLBACK+AUDIT lo aplica el motor (`DespacharEmailService`, líneas
  162-181: reintento con `es` + `auditar('fallback_idioma')`). Es una MEJORA (añade traza de
  auditoría del fallback) verificada de extremo a extremo por la batería 3.3 del motor
  (`fr` → asunto ES + AUDIT_LOG `fallback_idioma`+`fr`). La aserción ajustada en
  `catalogo-plantillas.spec.ts` (E1 con `fr` ahora `toBeNull()`) refleja fielmente el cambio
  de responsabilidad, no lo enmascara.
- **Multi-tenancy / RLS**: sin cambios de riesgo. `DispararE2Adapter.disparar` sigue tomando
  `tenantId` del parámetro del use-case (origen JWT), `fijarTenant(tx, tenantId)` y filtra
  `where: { idReserva, tenantId }`. El `idioma` es un campo de la propia RESERVA ya filtrada
  por tenant. Sin `tenant_id` desde path/body.
- **Máquina de estados**: no aplica (sin cambios de transiciones).
- **Tipos/Decimal/DTOs**: sin importes ni DTOs nuevos; `reserva.idioma` es `String` en el
  schema Prisma (línea 360, `@default("es")`). Sin `any` injustificado (solo casts de test).
- **Cliente HTTP generado no editado a mano**: OK. Ningún fichero del SDK generado aparece en
  el diff. `useConfirmarPresupuesto` usa `apiClient` y solo añade una invalidación de query.
- **Frontera de features (barrel)**: OK. `useConfirmarPresupuesto.ts` importa
  `comunicacionesReservaQueryKey` desde `@/features/comunicaciones` (barrel, exportado en
  `features/comunicaciones/index.ts` línea 10), no de un archivo interno.
- **Guardrail `components/` solo `.tsx`**: OK. El mapa/lógica de etiqueta vive en
  `features/reservas/lib/etiquetaEstado.ts` (no en `components/`). `Badge.tsx` (componente)
  solo lo consume.
- **Arrow functions (regla dura)**: OK. Todo lo nuevo (`etiquetaEstadoPrincipal`, `Badge`,
  `renderE2`, `renderE2Ca`, callbacks) es arrow function.
- **Responsive del Badge**: no roto. El Badge es un `inline-flex ... rounded-full` sin anchos
  fijos; los cambios no introducen overflow ni anchos px. Cambio de texto/prop, no de layout.
  No se aporta evidencia de 3 viewports, pero el cambio no afecta a la maqueta responsive
  (no hay nuevo layout ni ancho fijo); hallazgo de evidencia no aplicable con impacto real.
- **Errores/textos en español (y catalán)**: OK. Textos de marca ES/CA correctos; comentarios
  en español.
- **Tests primero y en verde**: OK.
  - Backend: `catalogo-plantillas-e2.spec.ts`, `catalogo-plantillas.spec.ts`,
    `despachar-email.service.spec.ts`, `disparar-e2.adapter.spec.ts` → 55/55 verdes.
  - Frontend: `Badge.test.tsx`, `FichaConsultaScroll.test.tsx`,
    `useConfirmarPresupuesto.invalidacion.test.tsx` → 7/7 verdes.
  - Cobertura: registro/render/asunto/htmlEscape/no-referencia de E2 CA; E2 ES con texto de
    marca (asertando explícitamente que NO usa el cuerpo genérico viejo); propagación de
    idioma del adaptador; selección por idioma + fallback auditado en el motor; scroll al top;
    invalidación de comunicaciones; badge de estado principal siempre visible.

## Notas

- Los cambios están sin commitear en el árbol de trabajo del worktree (el diff `master...HEAD`
  sale vacío; el contenido revisado es el working tree). Debe commitearse antes de PR/archive.

## Veredicto

Cambio limpio, alineado con los guardrails, con TDD real y suites verdes. Los dos hallazgos
Baja son mejoras opcionales, no bloqueantes.

Veredicto: APTO
