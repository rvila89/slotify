# Step N+2 — Pruebas manuales de endpoints con curl

**Change**: `2026-07-20-ajustes-ui-sidebar-toasts`
**Fecha**: 2026-07-20

## Resultado: N/A (justificado)

Este change es 100% frontend (`apps/web`): ajusta el ancho del menú lateral
(`AppShell.tsx`) y centraliza los toasts en `lib/notify.ts` con la conducta
"solo el último".

- **No se crea ni modifica ningún endpoint** del backend.
- **No cambia el contrato OpenAPI** (`docs/api-spec.yml`) ni el SDK generado.
- Las llamadas de red existentes (envío de emails, descartes, facturación) usan
  los mismos endpoints y payloads que antes; solo cambia la presentación del
  feedback (toast).

Por tanto no hay superficie de API que probar con curl. La verificación
funcional de este change se cubre con los unit tests (Step N+1) y, opcionalmente,
con E2E Playwright (Step N+3).
