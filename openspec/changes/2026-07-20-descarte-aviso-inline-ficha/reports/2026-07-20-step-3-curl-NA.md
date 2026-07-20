# Step 3 — Pruebas curl
**Change:** `2026-07-20-descarte-aviso-inline-ficha`
**Fecha:** 2026-07-20

---

## N/A — Sin endpoints nuevos

Este change es exclusivamente frontend (`apps/web`). No introduce ni modifica ningún endpoint de la API. El contrato OpenAPI no se ha modificado y no se ha regenerado el SDK.

Los únicos archivos de producción tocados son:

- `features/reservas/pages/FichaConsulta/components/AvisoDescarte.tsx` (nuevo componente)
- `features/reservas/pages/FichaConsulta/components/AvisosFicha.tsx` (nueva prop `descarte`)
- `features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx` (nuevo estado `resultadoDescarte`)
- `features/reservas/components/DescartarPreReservaDialog.tsx` (eliminada llamada `toast.success`)
- `features/reservas/components/DescartarConsultaDialog.tsx` (eliminada llamada `toast.success`)

Ninguno de estos archivos define o consume endpoints nuevos. El cambio reutiliza los mismos endpoints de descarte ya existentes (PATCH de transición de estado), que ya cuentan con pruebas curl en sus respectivos steps de QA.

**Las pruebas curl no aplican en este step.**

---

## Veredicto

N/A — change solo frontend, sin endpoints nuevos ni cambios de contrato.
