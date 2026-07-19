# Informe de code review — descarte-consulta-scroll-alert-ficha

- **Fecha:** 2026-07-19
- **Rama:** `feature/descarte-consulta-scroll-alert-ficha` (base `master`)
- **Change:** `2026-07-19-descarte-consulta-scroll-alert-ficha`
- **Ámbito declarado:** SOLO frontend (`apps/web`)
- **Revisor:** code-reviewer (solo lectura)

## Alcance revisado

Diff contra `master` (cambios aún sin commitear en el worktree):

- Producción: `apps/web/src/App.tsx` (+4), `apps/web/src/features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx` (+6/-2).
- Tests nuevos: `components/ui/__tests__/toaster-montado.test.tsx`, `features/reservas/components/__tests__/DescartarConsultaDialog.test.tsx`.
- OpenSpec: `proposal.md`, `specs/ficha-consulta-ui/spec.md`, `tasks.md`.

Verificado por el revisor: `git diff master --name-only` no lista ningún archivo
fuera de `apps/web/` y `openspec/`. Sin cambios en contrato, backend, Prisma, BD
ni SDK generado. El ámbito declarado se cumple.

## Verificación contra guardrails de arquitectura

Los guardrails backend (hexagonal, bloqueo atómico de fecha, multi-tenancy/RLS,
jobs, Decimal, cliente generado) **no aplican**: el change no toca `apps/api`, ni
`api-spec.yml`, ni `api-client/`. No hay imports de infra en dominio, ni Redis /
locks distribuidos, ni `tenant_id` de path/body, ni `Float` para importes,
porque no se toca ninguna de esas capas. OK por no-aplicabilidad.

## Hallazgos

### Bloqueantes
- Ninguno.

### Alta
- Ninguna.

### Media
- **[QA / evidencia responsive] Falta evidencia en 3 viewports (390/768/1280).**
  `apps/web/App.tsx` (Toaster) y `FichaConsulta/FichaConsultaPage.tsx`
  (`onDescartado`). El checklist exige verificar la UI en móvil/tablet/escritorio
  y aportar evidencia; `tasks.md` Step 4 (QA en 3 viewports) y el report E2E siguen
  sin marcar. El riesgo real es bajo (el `<Toaster/>` de Sonner ya nace
  mobile-first — `bottom-right`, ancho fluido `<sm`, sin px fijos — y el
  `scrollTo` no afecta al layout), pero por regla dura del proyecto se deja como
  hallazgo hasta que el gate de QA aporte capturas. Recomendación: completar
  Step 4 y adjuntar evidencia antes del gate final.

### Baja
- **[trazabilidad] Reports pendientes.** `tasks.md` deja abiertos
  `reports/2026-07-19-step-2-unit-test.md` y
  `reports/2026-07-19-step-4-e2e-playwright.md`. No bloquea el merge de código,
  pero cierra el rastro del change. Recomendación: generarlos antes de archivar.
- **[nota de alcance, no defecto] El fix del `<Toaster/>` es transversal.** Se
  confirma que 8 componentes de otras features (comunicaciones, facturación,
  condiciones-firmadas, reservas: Archivar/DescartarPreReserva) ya invocaban
  `toast.*()` y **ninguno se renderizaba** porque el host nunca estuvo montado. El
  cambio los repara a todos, lo cual es deseable, pero amplía el impacto real del
  change más allá del descarte de consulta. No es un defecto; conviene que QA dé
  un vistazo rápido a que esos toasts ahora visibles no se solapen ni molesten.
  Deuda previa documentada en memoria (overflow 768 del app-shell) no se ve
  afectada por este change.

## OK (cumple)

- **Arrow functions (regla dura).** `App` y `FichaConsultaPage` son expresiones de
  flecha; el nuevo handler `onDescartado` es una arrow inline. Sin `function`
  declarativo. `Toaster` en `sonner.tsx` también es arrow.
- **`components/` solo `.tsx` (regla dura).** No se añade ni mueve ningún `.ts`
  no-componente a `components/`. El único archivo bajo `components/ui/` afectado es
  un test `.tsx` en `__tests__/`.
- **Estructura por dominio / imports por barrel.** El diff de producción no
  introduce imports que crucen barrels de forma indebida. `App.tsx` importa el
  `Toaster` desde `./components/ui/sonner` (capa compartida, correcto) y las
  features por sus barrels (`@/features/...`). El test de `DescartarConsultaDialog`
  importa el componente por ruta relativa interna (`../DescartarConsultaDialog`),
  lo cual es correcto por co-localización dentro de la misma feature.
- **Coherencia spec ↔ código.** El requisito ADDED de `ficha-consulta-ui` describe
  exactamente (a) `window.scrollTo({ top: 0, behavior: 'smooth' })` solo en éxito
  y (b) toast de éxito con el código de la consulta. El código lo implementa:
  `onDescartado` (solo se invoca en `onSuccess`) hace el scroll, y el
  `toast.success` del diálogo incluye `${codigo}`. El escenario de error (sin
  scroll ni alert, error inline) también se respeta: `scrollTo` y `toast.success`
  cuelgan de `onSuccess`; el error se pinta vía `mutation.error` inline.
- **Patrón reutilizado.** El scroll replica el ya existente en
  `NuevaConsulta/NuevaConsultaPage.tsx:78` (verificado). Consistencia mantenida.
- **Tests significativos (TDD).** `toaster-montado.test.tsx` es una regresión real:
  monta `<App/>` y comprueba que un `toast.success` aparece en el DOM — habría
  fallado (RED) antes de montar el host. `DescartarConsultaDialog.test.tsx` cubre
  la conducta de negocio: confirma que al descartar con éxito se ve el alert
  (texto "marcada como descartada por el cliente") y se llama `onDescartado` con la
  reserva. El doble del hook resuelve `onSuccess` con la reserva en `2z`, como el
  backend. Cubren alert visible; el scroll en sí (`window.scrollTo`) no se asere en
  el test unit del diálogo (queda cubierto por spec + QA), aceptable para un jsdom.
- **Convenciones en español.** Nombres, comentarios y el mensaje del toast en
  español. `describe/it` descriptivos.
- **Ámbito.** Confirmado que NO toca backend / contrato / Prisma / BD / SDK.
- **Lint y tests.** Reportados verdes por el harness: `pnpm lint` exit 0 y
  `pnpm test` 316 tests verdes (no re-ejecutados por el revisor; el entorno de
  subagente no aporta valor adicional aquí).

## Conclusión

Cambio de presentación acotado, correcto y bien probado. Repara además un bug
transversal real (host de toasts nunca montado) que afectaba a toda la app. No hay
hallazgos bloqueantes ni de severidad alta. Los hallazgos Media/Baja son de
evidencia de QA y trazabilidad (reports pendientes), a resolver en el gate final,
no impedimentos del código.

Veredicto: APTO
