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

Carpeta por dominio con segmentos internos y **barrel `index.ts`** como API
pública. Las páginas complejas son **su propia carpeta** y co-localizan sus partes.
El ejemplo canónico vivo es `apps/web/src/features/reservas/`.

```
src/features/<dominio>/
  api/        # hooks TanStack Query sobre el cliente generado (useX, useCrearX…)
  components/ # componentes del dominio usados por 2+ páginas
  lib/        # helpers puros del dominio
  model/      # tipos del dominio: alias de @/api-client + tipos locales
  pages/
    <Pagina>/
      <Pagina>Page.tsx   # SOLO orquesta (estado + composición), no un JSX gigante
      schema.ts          # Zod + valores iniciales
      constants.ts
      components/         # sub-componentes PRIVADOS de esta página
  index.ts    # API PÚBLICA: lo único que importan otras partes de la app
```
```ts
// api/useReservas.ts (arrow function; cliente generado, sin tipos a mano)
export const useReservas = () =>
  useQuery({ queryKey: ['reservas'], queryFn: () => apiClient.GET('/reservas') });
```

## Reglas duras (las impone ESLint; `pnpm lint` falla)
- Importa una feature **solo por su barrel** `@/features/<dominio>`, nunca un archivo
  interno. Dentro del dominio, imports **relativos**.
- `components/`, `hooks/`, `lib/` (compartido) **no** importan de `features/`.
- Archivo **≤ 300 líneas** de código: si una página crece, extrae schema/constantes/
  sub-componentes a archivos hermanos. Ver `docs/frontend-standards.md` §Estructura.

## Errores comunes
- Meterlo todo en el componente de página (schema + sub-componentes + helpers inline).
- Poner sub-componentes de una página directamente en la raíz de `<Pagina>/` en vez de en `<Pagina>/components/` — todos los `.tsx` que no sean la propia página van en esa subcarpeta (ejemplo canónico: `NuevaConsultaPage/components/`).
- Organizar por tipo técnico (`components/`, `hooks/` globales) en vez de por dominio.
- Importar archivos internos de otra feature en vez de su barrel.
- Tipar respuestas a mano en vez de usar el cliente generado.
- Poner estado de servidor en `useState` en vez de TanStack Query.
- Guardar el refresh token fuera de la cookie httpOnly.

## Fuentes
- `docs/frontend-standards.md`.
- Skills: `tanstack-forms`, `shadcn-tailwind`, `contract-sync`, `figma-design-consume`.
