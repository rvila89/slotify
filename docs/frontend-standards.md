---
description: Estándares, buenas prácticas y convenciones del frontend de Slotify (Vite + React + TypeScript) incluyendo patrones de componentes, estado de servidor, consumo del cliente OpenAPI, UI con Tailwind + shadcn/ui, autenticación y testing.
globs: ["apps/web/src/**/*.{ts,tsx}", "apps/web/tests/**/*.{ts,tsx}", "apps/web/tsconfig.json", "apps/web/vite.config.ts", "apps/web/package.json"]
alwaysApply: true
---

# Estándares y buenas prácticas del Frontend — Slotify

## Índice

- [Visión general](#visión-general)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Cliente de API (OpenAPI)](#cliente-de-api-openapi)
- [Estado de servidor y de cliente](#estado-de-servidor-y-de-cliente)
- [Autenticación en el frontend](#autenticación-en-el-frontend)
- [Convenciones de código](#convenciones-de-código)
- [Componentes](#componentes)
- [UI/UX (Tailwind + shadcn/ui)](#uiux-tailwind--shadcnui)
- [Calendario y disponibilidad](#calendario-y-disponibilidad)
- [Formularios y validación](#formularios-y-validación)
- [Manejo de errores y estados de carga](#manejo-de-errores-y-estados-de-carga)
- [Accesibilidad](#accesibilidad)
- [Testing](#testing)
- [Rendimiento](#rendimiento)
- [Flujo de desarrollo](#flujo-de-desarrollo)

---

## Visión general

El frontend de Slotify es una **SPA pura** servida como **archivos estáticos desde un CDN** (ver [architecture.md §2.3](./architecture.md)). Es un producto interno tras login (sin SEO/SSR), por lo que no se usa un framework full-stack: la frontera front/back es limpia y la SPA consume la API NestJS por HTTP cross-origin (CORS). Es la pieza `apps/web` del monorepo.

**Lenguaje:** dominio en español (ver [base-standards.md §2](./base-standards.md)); andamiaje de React en su forma nativa (`useState`, `useEffect`…); textos de UI, comentarios y mensajes al usuario en español.

## Stack tecnológico

| Área | Tecnología | Notas |
|---|---|---|
| Build / dev server | **Vite** | SPA, HMR, build a estáticos |
| Lenguaje | **TypeScript** (strict) | |
| Librería UI | **React 18** | Componentes funcionales + hooks |
| Routing | **React Router** | Rutas protegidas por sesión |
| Estilos | **Tailwind CSS** | Utilidades; sin CSS suelto salvo casos puntuales |
| Componentes | **shadcn/ui** | Componentes accesibles sobre Radix |
| Estado de servidor | **TanStack Query** (React Query) | Caché, revalidación, estados de carga/error |
| Cliente HTTP | Cliente **generado desde el OpenAPI** del backend | Type-safe |
| Formularios | **React Hook Form** + **Zod** | Validación declarativa |
| Calendario | **react-big-calendar** o **FullCalendar** | Vistas mensual/semanal con bloqueos |
| Testing | **Vitest** + **Testing Library** + **Playwright** | Unitario/componentes + e2e |

## Estructura del proyecto

Organización **por dominio de feature** (estilo *Bulletproof React*), no por tipo
técnico de fichero. Cada feature es **autónoma** y se consume **solo por su barrel**
(`index.ts`); las páginas complejas **co-localizan** sus partes (schema, constantes,
sub-componentes). Alineada con los módulos del backend en [c4-diagrams.md](./c4-diagrams.md).

```
apps/web/
├── src/
│   ├── api-client/        # Cliente OpenAPI GENERADO (no se edita; eslint ignore)
│   ├── features/          # Dominios: reservas/, auth/, calendario/, cola-espera/…
│   │   └── <dominio>/
│   │       ├── api/        # hooks TanStack Query sobre el cliente generado
│   │       ├── components/ # componentes del dominio usados por 2+ páginas
│   │       ├── lib/        # helpers puros del dominio
│   │       ├── model/      # tipos del dominio (alias de api-client) + tipos locales
│   │       ├── pages/      # vistas de ruta; una página compleja = carpeta propia
│   │       │   └── <Pagina>/
│   │       │       ├── <Pagina>Page.tsx   # solo orquesta (estado + composición)
│   │       │       ├── schema.ts          # Zod + valores iniciales
│   │       │       ├── constants.ts
│   │       │       └── components/         # sub-componentes PRIVADOS de la página
│   │       └── index.ts    # API PÚBLICA del dominio (único punto de import externo)
│   ├── components/
│   │   ├── ui/            # shadcn/ui (compartido, agnóstico de dominio)
│   │   └── layout/        # chrome de la app (AppShell, Sidebar…) — compone features
│   ├── hooks/             # hooks transversales (sesión, tenant)
│   ├── lib/               # utilidades puras agnósticas (cn, formatters)
│   ├── pages/             # páginas aún no migradas a feature (p. ej. LoginPage)
│   ├── App.tsx            # árbol de rutas + provider de estado de servidor
│   └── main.tsx           # entry point: SessionProvider → Router → App
├── index.html · vite.config.ts · tsconfig.json · eslint.config.js
```

### ¿Dónde va cada cosa?

| Artefacto | Ubicación |
|-----------|-----------|
| Componente usado por **2+ páginas** del dominio | `features/<d>/components/` |
| Componente usado **solo por una página** | `features/<d>/pages/<Pagina>/components/` |
| Componente genérico (2+ dominios / agnóstico) | `components/ui/` |
| Chrome de la app (shell, nav) | `components/layout/` |
| Hook de datos de un dominio | `features/<d>/api/` |
| Hook transversal (sesión, tenant) | `hooks/` |
| Schema Zod + constantes de un formulario | junto a su página |
| Tipo del dominio / alias de API | `features/<d>/model/types.ts` (desde `@/api-client`) |
| Helper puro de dominio | `features/<d>/lib/` |
| Helper puro agnóstico | `lib/` |

### Reglas duras de estructura (ESLint)

- Una feature **solo** se importa por su barrel `@/features/<dominio>` — nunca por
  un archivo interno (`@/features/<dominio>/api/…`). Dentro del dominio, imports **relativos**.
- `components/`, `hooks/` y `lib/` (capa compartida) **no** importan de `features/`.
  El chrome `components/layout/` y la capa de rutas (`App.tsx`, `pages/`) sí componen features.
- Tamaño de archivo **≤ 300 líneas** de código: si crece, pártelo (extrae schema,
  sub-componentes, helpers).
- **Pureza de `components/`**: dentro de una feature, `features/<d>/components/`
  aloja **solo componentes React** (`.tsx`). Los módulos **no-componente** —helpers,
  constantes, tipos, schemas, clases de estilo Tailwind— van en `features/<d>/lib/`
  (o los tipos en `model/`). Cuando `react-refresh/only-export-components` obligue a
  extraer una constante/helper de un `.tsx`, el archivo extraído va a `lib/`/`model/`,
  **no** a `components/`. (No aplica a los folders de página `pages/<Pagina>/`, que sí
  co-localizan `schema.ts`/`constants.ts`.)
- Lo imponen `eslint-plugin-boundaries`, `no-restricted-imports`, `max-lines` y la
  regla de pureza de segmento (un `.ts` no-componente bajo `features/*/components/`
  dispara `no-restricted-syntax`) en `apps/web/eslint.config.js`; **`pnpm lint` falla**
  si se viola.

## Cliente de API (OpenAPI)

- El cliente HTTP se **genera a partir de [api-spec.yml](./api-spec.yml)** (p. ej. `orval` u `openapi-typescript`), no se escribe a mano. Esto recupera el type-safety extremo a extremo y demuestra que el contrato OpenAPI se consume realmente.
- Comando: `pnpm generate:api` (regenerar tras cualquier cambio del contrato del backend).
- **Nunca** se editan a mano los ficheros generados; si falta un endpoint, se actualiza primero `api-spec.yml` en el backend.
- Los tipos del dominio (Reserva, Presupuesto, Factura, enums) provienen del cliente generado: no se duplican manualmente.

## Estado de servidor y de cliente

- **Estado de servidor** (datos de la API): siempre vía **TanStack Query**. No guardar datos de servidor en `useState` global.
  - `useQuery` para lecturas; `useMutation` + invalidación de queries para escrituras.
  - Claves de query consistentes por recurso: `['reservas', filtros]`, `['reserva', id]`.
- **Estado de cliente** (UI local): `useState`/`useReducer`. Para estado compartido ligero, Context.
- **Tras una mutación** (p. ej. transición de estado de una reserva), invalidar las queries afectadas para refrescar la UI.

```tsx
// src/features/reservas/api/useReserva.ts (arrow functions, regla dura)
export const useReserva = (id: string) =>
  useQuery({ queryKey: ['reserva', id], queryFn: () => apiClient.GET('/reservas/{id}', { params: { path: { id } } }) });

export const useTransicionarReserva = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransicionInput) => apiClient.POST('/reservas/{id}/fecha', { params: { path: { id: input.id } }, body: input.body }),
    onSuccess: (_data, { id }) => qc.invalidateQueries({ queryKey: ['reserva', id] }),
  });
};
```

## Autenticación en el frontend

(Ver [architecture.md §2.8](./architecture.md) y [architecture.md §2.9](./architecture.md) para la deuda técnica registrada.)

- El **access token vive en memoria** (`accessTokenEnMemoria` a nivel de módulo en `session.tsx`), **nunca** en `localStorage` ni `sessionStorage`. Las funciones `iniciarSesion`/`cerrarSesion` solo mutan memoria.
- El **refresh token** está en una cookie `httpOnly + Secure + SameSite` que el JS no puede leer. El cliente HTTP usa `credentials: 'include'` para que el navegador envíe la cookie en las peticiones a `/auth/refresh`.
- **Interceptor de refresh:** ante un 401 en cualquier petición, el interceptor intenta `POST /auth/refresh` una vez y reintenta la petición original. Si el refresh también devuelve 401, el interceptor limpia la sesión en memoria y redirige a `/login`. **Guarda anti-recursión:** si el 401 proviene de la propia llamada a `/auth/refresh`, el interceptor retorna sin reintentar para evitar bucles infinitos.
- **Login:** `LoginPage.tsx` ejecuta una **mutación TanStack Query** contra el SDK generado. El cliente HTTP generado **nunca se edita a mano**; si el contrato cambia, se regenera con `pnpm generate-client`. Tras login exitoso la sesión se puebla en memoria y la app redirige al calendario (respetando el `state.from` preservado por `RequireAuth`).
- **Validación en el frontend:** el formulario de login bloquea el envío y muestra mensajes por campo si el email o la contraseña están vacíos, o si el email tiene formato inválido — antes de hacer ninguna llamada a la API.
- **Prohibido** guardar cualquier token en `localStorage`. Ver DT-AUTH-04 en [architecture.md §2.9](./architecture.md) para la deuda del codegen.

## Convenciones de código

- **Componentes**: `PascalCase` con nombre de dominio en español (`TarjetaReserva`, `CalendarioDisponibilidad`, `FormularioPresupuesto`).
- **Variables/funciones**: `camelCase` con verbo de negocio en español (`crearReserva`, `manejarEnvio`).
- **Hooks**: prefijo `use` + español (`useReserva`, `useCalendario`).
- **Constantes**: `UPPER_SNAKE_CASE` (`MAX_INVITADOS_POR_TRAMO`).
- **Ficheros de componente**: `PascalCase.tsx`; utilidades/hooks: `camelCase.ts`.
- **Clases CSS** (cuando no se use Tailwind): `kebab-case`.
- **Textos de UI, comentarios y mensajes de error en español.**

```tsx
type TarjetaReservaProps = {
  reserva: Reserva;
  onSeleccionar: (reserva: Reserva) => void;
};

export function TarjetaReserva({ reserva, onSeleccionar }: TarjetaReservaProps) {
  // Maneja la selección de la reserva
  const manejarClic = () => onSeleccionar(reserva);
  return (
    <button className="rounded-lg border p-4 text-left" onClick={manejarClic}>
      {/* contenido */}
    </button>
  );
}
```

## Componentes

- **Solo componentes funcionales** con hooks; nada de clases.
- **Props tipadas** con `type`/`interface` y desestructuradas.
- Componentes pequeños y enfocados; extraer lógica reutilizable a hooks.
- Usar los componentes de **shadcn/ui** como base (Button, Dialog, Form, Table…) en lugar de reinventarlos.

## UI/UX (Tailwind + shadcn/ui)

- Estilado con **utilidades Tailwind**; tokens de diseño centralizados en la config de Tailwind.
- Componentes accesibles de **shadcn/ui** (sobre Radix): diálogos, menús, formularios, toasts.
- **Opinado por fuera, configurable por dentro**: la UX expone un único flujo claro aunque la configuración por tenant exista por debajo.

## Responsive Design (Obligatorio)

> Regla **dura** (ver [CLAUDE.md](../CLAUDE.md)). Toda UI debe funcionar en móvil, tablet y escritorio. No se entrega una pantalla "solo desktop".

- **Mobile-first**: los estilos base son para móvil; los breakpoints Tailwind (`md:`, `lg:`…) añaden el comportamiento de pantallas mayores. No al revés.
- **Breakpoints** (defaults de Tailwind): `sm 640` · `md 768` · `lg 1024` · `xl 1280`. Convención del proyecto: **`lg:` es el corte mobile↔desktop** (el login tiene diseño Figma desktop `0:3` y móvil `0:304`).
- **Layout adaptativo con grid/flex**, no anchos fijos en px que rompan en móvil. La **navegación lateral colapsa a drawer + hamburguesa** en `<lg`; el header se compacta (ocultar/colapsar elementos secundarios); los paddings se reducen (`p-4 md:p-6 lg:p-8`).
- **Sin overflow horizontal** en ningún breakpoint; objetivos táctiles cómodos (≥40px).
- **Verificación obligatoria en 3 viewports**: **390** (móvil), **768** (tablet), **1280** (escritorio). Se comprueba en code-review y en QA (E2E con `page.setViewportSize`).
- Si el diseño de Figma **no trae versión móvil** (p. ej. el App Shell solo tiene frame desktop), se diseña la adaptación móvil con los tokens del proyecto y se señala; nunca se entrega solo-desktop.
- Patrones útiles: `w-full md:w-1/2 lg:w-1/3` · `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` · `hidden lg:flex` / `lg:hidden`. Usar el `Sheet`/`Dialog` de shadcn (Radix) para drawers/modales accesibles.

## Calendario y disponibilidad

- Vista de calendario (mensual/semanal) que muestra reservas y **fechas bloqueadas** (blando/firme), consumiendo `GET /api/calendario`.
- El bloqueo/liberación de fechas (`UC-30`/`UC-31`) refleja el resultado del backend; ante un **409** (fecha ya bloqueada) se muestra un mensaje claro de doble reserva evitada.
- Distinguir visualmente estados/sub-estados de la reserva y tipo de bloqueo.

## Formularios y validación

- **React Hook Form** para el estado del formulario + **Zod** para el esquema de validación (reutilizando, cuando aplique, los tipos del cliente OpenAPI).
- Componentes controlados; validación en tiempo real donde aporte.
- **Deshabilitar el botón de envío** durante el submit; limpiar/cerrar tras éxito.
- Los errores de validación del backend (400/422) se mapean a los campos del formulario.

## Manejo de errores y estados de carga

- TanStack Query expone `isLoading`/`isError`: **siempre** manejar ambos.
- Mensajes de error **en español y orientados al usuario** (no volcar el error técnico):

```tsx
if (isError) {
  return <Alert variant="destructive">No se pudieron cargar las reservas. Inténtalo de nuevo.</Alert>;
}
```

- Usar toasts/alerts de shadcn/ui para feedback de mutaciones.

## Accesibilidad

- `aria-label` en elementos interactivos sin texto visible.
- HTML semántico y navegación por teclado (shadcn/ui ya lo facilita).
- Texto alternativo en imágenes; foco visible.

## Testing

- **Unitario / componentes**: Vitest + Testing Library. Probar comportamiento, no detalles de implementación.
- **End-to-end**: Playwright para los flujos clave del gestor (alta de lead, generar presupuesto, confirmar señal, ver calendario). Usar `data-testid` para selección estable.
- **Responsive (obligatorio si hay UI)**: ejercitar el flujo en 3 viewports con `page.setViewportSize` — **390** (móvil), **768** (tablet), **1280** (escritorio) — verificando que no hay overflow, que la nav colapsa a drawer en `<lg` y es sidebar fijo en `≥lg`.
- Tras crear/actualizar datos por la UI en e2e, verificar persistencia y restaurar el estado.

```ts
// tests/reservas.spec.ts (Playwright)
test('el gestor da de alta una consulta con fecha', async ({ page }) => {
  await page.goto('/reservas/nueva');
  await page.getByLabel('Fecha del evento').fill('2026-09-12');
  await page.getByRole('button', { name: 'Crear consulta' }).click();
  await expect(page.getByText('SLO-2026-')).toBeVisible();
});
```

## Rendimiento

- **Code splitting** por ruta (lazy loading de páginas).
- `useMemo`/`useCallback` solo cuando haya un coste real medible.
- Aprovechar la caché de TanStack Query para evitar refetches innecesarios.
- Optimizar imágenes y vigilar el tamaño del bundle (build de Vite).

## Flujo de desarrollo

- Rama `feature/<nombre>` (sufijo `-frontend` si se trabaja en paralelo con backend).
- `pnpm lint && pnpm typecheck && pnpm test` antes de cada commit.
- Regenerar el cliente API (`pnpm generate:api`) tras cambios del contrato del backend.
- Mensajes de commit descriptivos; ramas pequeñas y enfocadas.

---

*Este documento es la base para mantener calidad y consistencia en el frontend de Slotify. Consistente con [architecture.md](./architecture.md), [api-spec.yml](./api-spec.yml) y [c4-diagrams.md](./c4-diagrams.md).*
