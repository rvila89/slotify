# Step N+1 — Unit tests + verificación de estado BD

**Change**: `2026-07-20-ajustes-ui-sidebar-toasts`
**Fecha**: 2026-07-20
**Alcance**: 100% frontend (`apps/web`). Sin backend, sin dominio, sin BD.

## Lint

`npx eslint` sobre los ficheros cambiados: **sin errores**. Solo warnings
pre-existentes del plugin `boundaries` (deprecación de `entry-point`/
`element-types`), ajenos a este change.

## Typecheck

`npx tsc --noEmit` en `apps/web`: **limpio** (0 errores).

## Unit tests

`npx vitest run` (suite completa de `apps/web`):

```
Test Files  60 passed (60)
     Tests  362 passed (362)
```

Incluye:
- **`src/lib/__tests__/notify.test.ts`** (nuevo, 5 tests): verifica que
  `notify.{success,error,warning,info}` llama a `toast.dismiss()` **antes** del
  `toast.*()` correspondiente (orden de invocación) y reenvía mensaje + opciones.
  Confirmado RED (módulo inexistente) antes de crear `lib/notify.ts`.
- **AppShell** (`AppShellResponsive`, `AppShellNavigation`, `AppShellCatchAll`,
  `AppShellPlaceholder`, `LayoutSeparation`): verdes tras `w-72 → w-48`; no
  aseveran clases de ancho (usan role/aria queries).
- **Toasts migrados** (`RevisarEnviarBorradorDialog`, `AccionReenviarE3`,
  `toaster-montado`): verdes tras migrar a `notify` y añadir `dismiss: vi.fn()`
  a los mocks de `sonner`.

## Verificación de estado BD

**N/A**. Change exclusivamente de presentación (frontend). No hay migraciones,
queries ni endpoints; no se muta ningún estado de base de datos. No procede
baseline/restore de BD.
