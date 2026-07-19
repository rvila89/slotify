# Step 2 — Unit tests + lint (2026-07-19)

Change: `descarte-consulta-scroll-alert-ficha` · rama `feature/descarte-consulta-scroll-alert-ficha`.

## Comandos

Ejecutados en `apps/web` del worktree:

- `pnpm lint` → **exit 0** (solo warnings de deprecación del plugin `boundaries`, no bloqueantes).
- `pnpm test` → **51 archivos / 316 tests en VERDE**.

## Tests añadidos (TDD)

1. `src/components/ui/__tests__/toaster-montado.test.tsx`
   Regresión de la causa raíz: monta `<App/>` y verifica que `toast.success(...)`
   se renderiza en el DOM. Confirmado **RED antes del fix** (sin `<Toaster/>`
   montado el texto nunca aparece), **GREEN tras montar `<Toaster/>` en `App.tsx`**.

2. `src/features/reservas/components/__tests__/DescartarConsultaDialog.test.tsx`
   Al confirmar el descarte con éxito, el diálogo muestra el alert
   ("marcada como descartada por el cliente") y notifica `onDescartado`.

## Causa raíz documentada

El alert no aparecía porque el host global `<Toaster/>` de Sonner
(`components/ui/sonner.tsx`) se creó en US-028 pero **nunca se montó** en el árbol
(`App.tsx`/`main.tsx`). Sin él, ninguna llamada `toast.*()` de la app se renderiza.
Fix: montar `<Toaster/>` una vez en `App.tsx` (repara todos los toasts).

Resultado: **APTO** para unit + lint.
