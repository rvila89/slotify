# Step 4 — QA / E2E: cubierto-por-unit (decisión humana)

**Fecha:** 2026-07-20
**Change:** `2026-07-20-descarte-aviso-inline-ficha` (SOLO frontend, presentación)

## Decisión

No se ejecuta el E2E full-stack (Playwright, 3 viewports). Motivos:

1. **Sin datos usables en la BD dev.** `slotify_dev` contenía 1 sola reserva, ya en
   `reserva_cancelada`. No había ninguna `pre_reserva` ni consulta en sub-estado no
   terminal sobre la que ejecutar los descartes. Generar los datos requería (a) sembrar
   vía SQL en la BD compartida o (b) crear la pre-reserva por el flujo largo de la app.
2. **Alcance del cambio.** Es un ajuste de **solo presentación** (sustituir un toast por
   un aviso inline verde + scroll). No hay lógica de dominio, contrato ni datos.
3. **Elección del usuario (2026-07-20):** ante las opciones "tomar 5173 + sembrar datos"
   vs "apoyarse en unit tests", el usuario eligió **no ejecutar el E2E full-stack**.

## Cobertura equivalente (unit, en verde)

`pnpm test` en `apps/web` → 61 files / 362 tests PASSED (ver
`2026-07-20-step-2-unit-test.md`). En concreto:

- `AvisoDescarte.test.tsx` — el aviso se renderiza como banner **verde** (`border-emerald-200
  bg-emerald-50 text-emerald-900`), con el **texto y el código** correctos para
  `tipo='prereserva'` y `tipo='consulta'`, `role="status"`, y el botón cerrar invoca
  `onCerrar`.
- `DescartarPreReservaDialog.test.tsx` — al éxito **NO** emite `toast.success` y notifica
  `onDescartado(reserva)`; error inline sin cerrar.
- `DescartarConsultaDialog.test.tsx` — ídem (sin toast, notifica callback).
- `toaster-montado.test.tsx` — `<Toaster/>` sigue montado (sin regresión en otros dominios
  que sí usan toasts).

## Riesgo residual (no cubierto por unit)

El único tramo no verificado en navegador es el **wiring de página end-to-end**:
`FichaConsultaPage` → `onDescartado`/`onDescartadoPreReserva` → `setResultadoDescarte`
→ `AvisosFicha` renderiza `AvisoDescarte` **+** `window.scrollTo({ top: 0 })`, y la
comprobación visual responsive en 390/768/1280. Es lógica de paso de props y un efecto de
scroll de bajo riesgo, reutilizando patrones ya vivos en la ficha (mismo cableado que
`resultadoVisita`, `resultadoPresupuesto`, etc.).

**Recomendación para el GATE final:** si se quiere cerrar este residual, ejecutar una
verificación manual rápida (descartar una pre-reserva y una consulta en la app real) o
sembrar los 2 registros y correr el E2E. Queda a criterio del humano en el GATE final.
