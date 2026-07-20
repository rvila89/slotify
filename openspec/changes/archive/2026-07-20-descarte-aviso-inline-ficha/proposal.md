# Change: descarte-aviso-inline-ficha

> Ajuste de UX en la **Ficha de consulta** al descartar. Cambio **SOLO frontend**
> (`apps/web`): NO toca el contrato OpenAPI, el backend NestJS, Prisma, la BD ni el
> SDK generado. Refina la confirmación visual de los descartes (pre-reserva US-011 y
> consulta US-013) sin alterar la transición de dominio ni la máquina de estados.
> Es presentación pura.

## Why

Al descartar una **PRE-RESERVA** (US-011, `pre_reserva → reserva_cancelada`) o una
**CONSULTA** (US-013, `2a/2b/2c/2d/2v → 2z`) desde la Ficha de consulta
(`FichaConsultaPage`), la confirmación de éxito aparece como un `toast.success()` de
Sonner en la esquina inferior derecha (`components/ui/sonner.tsx`,
`position="bottom-right"`). Ese "tooltip lateral inferior" **rompe con el patrón del
resto de transiciones de la ficha**, que confirman con un **AVISO INLINE en la
cabecera**: un banner de color (verde esmeralda para el éxito) con ícono + título en
negrita + descripción informativa, cerrable y con auto-scroll al inicio de la página.
Los componentes canónicos de ese patrón son los `AvisoXxx` de
`apps/web/src/features/reservas/pages/FichaConsulta/components/`, orquestados por
`AvisosFicha.tsx` (ejemplo vivo: `AvisoVisitaProgramada.tsx`, verde
`border-emerald-200 bg-emerald-50 text-emerald-900`).

La inconsistencia es doble:

1. **Pre-reserva:** al descartar, el callback `onDescartadoPreReserva` de la ficha es
   un **no-op** (`FichaConsultaPage.tsx` `onDescartadoPreReserva={() => {}}`); la única
   señal es el toast lateral del diálogo. No hay aviso inline ni scroll al inicio.
2. **Consulta:** el descarte ya desplaza la vista al inicio (change hermano
   `2026-07-19-descarte-consulta-scroll-alert-ficha`, código ya en master), pero
   sigue confirmando con el toast lateral en vez del aviso inline homogéneo con el
   resto de la ficha.

El resultado buscado: **ambos descartes confirman con el mismo aviso inline verde en
la cabecera** (coherencia visual con las demás transiciones), con desplazamiento al
inicio, en lugar del toast lateral.

## What Changes

Un ajuste acotado de presentación en `apps/web/src`, sobre la Ficha de consulta:

1. **Aviso inline verde para el descarte (NUEVO, reutilizable).** Se añade un
   componente `AvisoDescarte.tsx` (banner esmeralda, mismo patrón visual que
   `AvisoVisitaProgramada`) que informa de que la pre-reserva/consulta se descartó
   correctamente, con el código. Props `{ tipo: 'consulta' | 'prereserva'; codigo:
   string; onCerrar }` para reutilizarlo en ambos descartes.

2. **Orquestación en `AvisosFicha.tsx`.** Nueva prop `descarte` (+ `onCerrarDescarte`)
   con render condicional del nuevo aviso, junto al resto de avisos de desenlace.

3. **Estado y wiring en `FichaConsultaPage.tsx`.** Nuevo estado `resultadoDescarte`;
   `onDescartadoPreReserva` deja de ser no-op y `onDescartado` (consulta) pasan a
   **setear el aviso inline** con `tipo` y `codigo`, y ambos ejecutan
   `window.scrollTo({ top: 0, behavior: 'smooth' })` (patrón vivo del proyecto).

4. **Eliminar los dos toasts de descarte.** Se quitan las llamadas `toast.success` de
   `DescartarPreReservaDialog.tsx` y `DescartarConsultaDialog.tsx` (la confirmación
   pasa a ser el aviso inline). **Se conserva `<Toaster/>` montado en `App.tsx`**:
   otros dominios siguen usando toasts; solo se retiran estas dos llamadas.

Ante error del backend (409 `transicion_no_permitida`, 422 `origen_invalido` o
genérico) **no** hay aviso de éxito ni desplazamiento: el error se mantiene inline en
el diálogo, tal como hoy.

## Nota de coordinación (change hermano — CRÍTICO)

La capability frontend es **`ficha-consulta-ui`**. Su primer requisito lo introdujo el
change hermano `2026-07-19-descarte-consulta-scroll-alert-ficha`, cuyo **código ya
está en master** (`<Toaster/>` montado en `App.tsx` + scroll en `onDescartado` de
consulta) **pero cuyo change OpenSpec NO está archivado** (GATE final pendiente). Por
tanto `openspec/specs/ficha-consulta-ui/spec.md` **todavía no existe como spec viva**.

Ese requisito hermano describe la confirmación de descarte de consulta como
"desplazamiento al inicio + alert de éxito (toast)". **Este change EVOLUCIONA ese
comportamiento** (toast lateral → aviso inline verde en cabecera) para consulta y lo
**AÑADE** para pre-reserva.

Enfoque OpenSpec elegido: como el spec hermano aún no es vivo, este delta se expresa
como **`ADDED`** de un único requisito de `ficha-consulta-ui` que cubre la
confirmación de descarte (pre-reserva **y** consulta) mediante **aviso inline verde en
la cabecera + desplazamiento al inicio**, sin toast. Se usa **una sola sección
`## ADDED Requirements` con un único requisito** (evita el fallo conocido de dos
secciones ADDED duplicadas).

**Reconciliación pendiente (no es tarea de este change):** el change hermano deberá
archivarse/reconciliarse por separado. Como su código (Toaster + scroll) ya está en
master y este change lo supera en la parte de confirmación, al archivar ambos habrá
que resolver la superposición: recomendación es que, al archivar `ficha-consulta-ui`,
la conducta viva sea la de **este** change (aviso inline), superando la redacción
"toast" del hermano. Se deja constancia aquí para el humano en el GATE final.

## Impact

- **Ámbito:** exclusivamente `apps/web` (frontend SPA).
- **NO afectado:** contrato OpenAPI (`docs/api-spec.yml`), backend NestJS, Prisma, BD,
  SDK generado (`api-client/`), auth, tokens de diseño, las transiciones de dominio
  US-011 (`descartar-pre-reserva`) y US-013 (`descartar-consulta`) y la máquina de
  estados. El `<Toaster/>` global permanece montado (otros dominios lo usan).
- **Specs afectadas:** capability frontend **`ficha-consulta-ui`** (1 requisito
  `ADDED`). Ver nota de coordinación arriba.
- **Archivos de producción tocados (5):**
  - NUEVO `apps/web/src/features/reservas/pages/FichaConsulta/components/AvisoDescarte.tsx`
  - `apps/web/src/features/reservas/pages/FichaConsulta/components/AvisosFicha.tsx`
    (prop `descarte` + `onCerrarDescarte`, render condicional)
  - `apps/web/src/features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx`
    (estado `resultadoDescarte`; `onDescartado` y `onDescartadoPreReserva` setean el
    aviso + `window.scrollTo`)
  - `apps/web/src/features/reservas/components/DescartarPreReservaDialog.tsx`
    (quitar `toast.success`)
  - `apps/web/src/features/reservas/components/DescartarConsultaDialog.tsx`
    (quitar `toast.success`)
- **Tests añadidos/actualizados:** unit de `AvisoDescarte` (render de ambos `tipo`,
  código, cierre) y actualización de los tests de los dos diálogos (ya no esperan
  `toast`, sí notifican `onDescartado`/`onDescartadoPreReserva`); test de wiring en la
  ficha (al descartar aparece el aviso inline y sube al inicio).
- **Riesgo:** bajo; cambio de presentación sin lógica de negocio ni datos.
- **Verificación:** `pnpm lint` + `pnpm test` en `apps/web` verdes; **curl N/A** (sin
  endpoints); QA manual/E2E en **3 viewports (390 / 768 / 1280)** comprobando que al
  descartar (pre-reserva y consulta) la página sube al inicio y aparece el aviso
  inline verde con el código, y que ya NO aparece el toast lateral.
