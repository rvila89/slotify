---
name: frontend-feature
description: Usar cuando haya que crear o estructurar una feature del frontend (carpeta por dominio, hooks Query, shadcn, RHF+Zod).
---

# Estructura de una feature de frontend

## Cuándo usar
- Al crear una nueva pantalla/feature en `apps/web`.
- Para organizar componentes, hooks y formularios de un dominio.

## Reglas
- Stack: **Vite (SPA pura, sin SSR)** + React 18 + TypeScript strict + TailwindCSS + shadcn/ui.
- **Estructura por dominio de feature**, no por tipo técnico: `reservas/`, `calendario/`, `presupuestos/`, `facturacion/`.
- Estado servidor: **TanStack Query** (`useQuery`/`useMutation`). Estado UI local: `useState`.
- Auth: access token en memoria (state); refresh token en cookie httpOnly.
- Formularios: **React Hook Form + Zod**.
- Calendario: react-big-calendar o FullCalendar (vistas mes/semana con bloqueos).
- **No inventar tipos de API**: usar los generados en `apps/web/src/api-client/`.

## Patrón de referencia (estructura)
```
src/features/reservas/
  api/        # hooks TanStack Query sobre el cliente generado
  components/ # componentes shadcn/ui
  forms/      # esquemas Zod + RHF
  pages/      # vistas de ruta
```
```ts
// api/useReservas.ts
export const useReservas = () =>
  useQuery({ queryKey: ['reservas'], queryFn: () => apiClient.getReservas() });
```

## Errores comunes
- Organizar por tipo técnico (`components/`, `hooks/` globales) en vez de por dominio.
- Tipar respuestas a mano en vez de usar el cliente generado.
- Poner estado de servidor en `useState` en vez de TanStack Query.
- Guardar el refresh token fuera de la cookie httpOnly.

## Fuentes
- `docs/frontend-standards.md`.
- Skills: `tanstack-forms`, `shadcn-tailwind`, `contract-sync`, `figma-design-consume`.
