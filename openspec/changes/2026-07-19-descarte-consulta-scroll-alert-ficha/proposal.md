# Change: descarte-consulta-scroll-alert-ficha

> Ajuste de UX en la **Ficha de consulta** al descartar una consulta. Cambio
> **SOLO frontend** (`apps/web`): NO toca el contrato OpenAPI, el backend NestJS,
> Prisma ni la BD. Refina la confirmación visual de la acción de descarte sin
> alterar la transición de dominio (`2a/2b/2c/2d/2v → 2z`, US-013), que permanece
> intacta.

## Why

Cuando el Gestor marca una consulta como **descartada por cliente** desde la
Ficha de consulta (`FichaConsultaPage`), la acción se completa correctamente en
el backend, pero la retroalimentación en la interfaz es incompleta:

1. **La vista no vuelve al inicio.** Tras confirmar el descarte, el callback
   `onDescartado` de la ficha es un no-op (`FichaConsultaPage.tsx`
   `onDescartado={() => {}}`), de modo que si el Gestor había desplazado la
   página (la ficha es larga: datos del lead, detalles del evento, acciones,
   secciones), se queda en la misma posición de scroll. No hay una señal clara de
   cierre que devuelva el foco visual a la cabecera de la consulta, donde el
   `Badge` de estado ya refleja el resultado.

2. **El alert de éxito NO se mostraba (bug real).** El diálogo
   `DescartarConsultaDialog` sí invoca `toast.success('Consulta {codigo} marcada
   como descartada por el cliente.')` al recibir el 200, pero **ningún toast se
   renderizaba** en toda la app: el host global de Sonner
   (`components/ui/sonner.tsx` → `<Toaster/>`) se creó en US-028 pero **nunca se
   montó** en el árbol (`App.tsx`/`main.tsx`). Sin un `<Toaster/>` montado, Sonner
   no tiene dónde pintar y toda llamada `toast.*()` es invisible. Es la causa raíz
   de que la prueba del usuario no mostrara el alert.

El resultado buscado: al descartar con éxito, la interfaz **desplaza el puntero
hacia el inicio** de la página y **muestra un alert** confirmando que la acción
se realizó correctamente, informando al usuario de forma inequívoca.

## What Changes

Un único ajuste acotado de presentación en `apps/web/src`, sobre la Ficha de
consulta:

1. **Desplazamiento al inicio tras el descarte (NUEVO).**
   El callback `onDescartado` de `FichaConsultaPage` pasa de no-op a **desplazar
   la vista al inicio** de la página, reutilizando el patrón ya existente en el
   proyecto: `window.scrollTo({ top: 0, behavior: 'smooth' })` (mismo patrón que
   `NuevaConsulta/NuevaConsultaPage.tsx`).

2. **Alert de éxito (ARREGLADO).**
   Para que el toast que ya dispara `DescartarConsultaDialog` (y cualquier otro de
   la app) sea visible, se **monta el host global `<Toaster/>` una única vez** en
   `App.tsx` (dentro del `QueryClientProvider`, junto a `InterceptorRegistrar`).
   Es un arreglo transversal de bajo riesgo: repara todos los toasts, no solo el
   del descarte. El spec-delta recoge la conducta esperada del alert.

Ante error del backend (409 `transicion_no_permitida`, 422 `origen_invalido` o
genérico) **no** hay desplazamiento ni alert de éxito: el error se mantiene
inline en el diálogo, tal como hoy.

## Impact

- **Ámbito:** exclusivamente `apps/web` (frontend SPA).
- **NO afectado:** contrato OpenAPI (`api-spec.yml`), backend NestJS, Prisma, BD,
  SDK generado (`api-client/`), auth, tokens de diseño, la transición de dominio
  US-013 (`descartar-consulta`) y la máquina de estados.
- **Specs afectadas:** nueva capability frontend **`ficha-consulta-ui`** (1
  requisito ADDED). Se abre esta capability porque la UX de la ficha no está
  cubierta por `consultas` (estrictamente backend/dominio); sigue el patrón de
  capabilities frontend dedicadas (`pipeline-ui`, `app-shell`).
- **Archivos de producción tocados:**
  `apps/web/src/App.tsx` (monta `<Toaster/>`) y
  `apps/web/src/features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx`
  (callback `onDescartado` → `window.scrollTo`).
- **Tests añadidos:** `components/ui/__tests__/toaster-montado.test.tsx`
  (regresión: la app monta el host de toasts) y
  `features/reservas/components/__tests__/DescartarConsultaDialog.test.tsx`
  (el descarte muestra el alert y notifica `onDescartado`).
- **Riesgo:** bajo; cambio de presentación sin lógica de negocio ni datos.
- **Verificación:** `pnpm lint` + `pnpm test` en `apps/web` verdes, y QA manual en
  **3 viewports (390 / 768 / 1280)** comprobando que al descartar la página vuelve
  al inicio y aparece el alert de éxito.
