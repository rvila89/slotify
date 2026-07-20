# Proposal — Ajustes UI: sidebar 12rem + toast único por acción

## Why

Dos ajustes de UX menores solicitados por el usuario sobre el App Shell de
`apps/web`, sin impacto de dominio ni de contrato:

1. **Sidebar demasiado ancho en escritorio.** El menú lateral abierto mide hoy
   288px (`w-72` / 18rem), robando ancho útil al área de contenido. Se quiere un
   sidebar más compacto de **12rem (192px)**.
2. **Los toasts se apilan y confunden.** Sonner acumula varios toasts a la vez
   (no hay `toast.dismiss()` en el código ni límite de visibles). Tras encadenar
   acciones, el usuario ve mensajes viejos superpuestos al último. Se quiere que
   **a cada acción solo quede el último mensaje** visible.

Fuente: petición directa del usuario. Artefactos:
`apps/web/src/components/layout/AppShell.tsx` (sidebar);
`apps/web/src/components/ui/sonner.tsx` + `App.tsx:36` (Toaster); patrón de
helper previo `apps/web/src/features/facturacion/lib/toastLiquidacion.ts`.

## What Changes

- **Ancho del sidebar en escritorio → 12rem.** En `AppShell.tsx` el `<aside>`
  abierto pasa de `w-72` a `w-48` (líneas 41 y 44), y el docstring se actualiza
  (288px → 192px). El colapso a `w-0`, el drawer/hamburguesa en `<lg`, el
  `inert`+`aria-hidden` y la persistencia al navegar **no cambian**.
- **Toast único por acción.** Nuevo helper compartido
  `apps/web/src/lib/notify.ts` que hace `toast.dismiss()` antes de cada
  `toast.*()` (success/error/warning/info), garantizando de forma determinista
  que solo el último quede visible. Se migran los call-sites de `toast.*()` a
  `notify.*()` en **9 ficheros de producción** (features de reservas,
  comunicaciones, facturación y condiciones-firmadas; +2 mocks de test),
  incluido `toastLiquidacion.ts`, que reusa `notify`. La configuración del
  `<Toaster/>` (posición, colores, close button) **no cambia**.

## Out of Scope

- Backend, dominio, máquina de estados de reservas y contrato OpenAPI/SDK: sin
  cambios (change 100% frontend).
- Rediseño del Toaster (posición, colores) o uso de `visibleToasts`: descartado
  a favor del wrapper `notify`, que es determinista.
- Drawer móvil (Sheet) del sidebar: fuera de alcance (deuda ya conocida).

## Impact

- **Specs**: capability `app-shell` (un requisito MODIFIED — ancho del sidebar;
  un requisito ADDED — toast único por acción).
- **Código**: solo `apps/web` — `components/layout/AppShell.tsx`, nuevo
  `lib/notify.ts`, y los ~24 call-sites de `toast.*()`.
- **Riesgo**: bajo. Cambios de presentación; sin migraciones ni efectos de
  dominio. Verificable en 3 viewports (390 / 768 / 1280) y con dos acciones
  encadenadas.
