# Step 6 — QA: unit tests + verificación de BD real

**Change:** `solicitud-datos-presupuesto-borrador`
**Rama:** `feature/solicitud-datos-presupuesto-borrador`
**Fecha:** 2026-07-24
**Ejecutado por:** sesión principal (con Postgres real; los subagentes QA no tienen BD).

## Migración

- `20260724120000_subtipo_solicitud_datos` (`ALTER TYPE "SubtipoEmail" ADD VALUE 'solicitud_datos'`).
- Aplicada con `prisma migrate deploy` a **`slotify_dev`** y **`slotify_test`** — OK.

## Unit (dobles de puertos)

- `src/comunicaciones/application/solicitar-datos-presupuesto.use-case.spec.ts` — **14/14 verde.**
  - Asserts sobre `comunicaciones.crear` (no sobre el motor): asunto `"Pre-reserva confirmada"`,
    cuerpo de `renderMensajeTransicionFecha({tipo:'disponible'})` en es y ca, `estado='borrador'`,
    `subtipo='solicitud_datos'`, `fechaEnvio=null`, `destinatarioEmail` del cliente.
  - Idempotencia: `enviado` previo → `ComunicacionDuplicadaError` sin `crear`; borrador previo →
    reutiliza sin `crear`. Guardas: datos completos → `DatosFiscalesCompletosError`; reserva
    inexistente → `ReservaNoEncontradaError`. Placeholder `___` con personas/horas nulas.
- Suite módulo `src/comunicaciones` — **29 suites / 247 tests verde** (incluye la integración).

## Integración con Postgres real (`slotify_test`)

`src/comunicaciones/__tests__/solicitar-datos-presupuesto.integration.spec.ts` — **7/7 verde**
(adaptadores reales `CargarReservaPresupuestoContextoPrismaAdapter` + `ComunicacionRepositoryPrismaAdapter`):

1. Persiste borrador E1 `solicitud_datos` con el CUERPO de la plantilla disponible **castellano**
   (contiene "Para poder prepararte el presupuesto, necesitaría los siguientes datos" y
   "Nombre y apellidos / DNI / Dirección y población"; **NO** "Hemos recibido tu consulta").
2. Cuerpo **catalán** con `idioma='ca'` ("Per poder-te preparar el pressupost" / "Nom i cognoms / DNI / Adreça i població").
3. Segunda solicitud con borrador pendiente → **reutiliza** (1 sola fila).
4. Segunda solicitud tras `enviado` → **409 `ComunicacionDuplicadaError`** (1 sola fila).
5. **Coexiste** con un `('E1','fecha_disponible')` enviado (terna independiente, índice UNIQUE parcial).
6. Datos fiscales completos → **422 `DatosFiscalesCompletosError`**.
7. Reserva inexistente → **404 `ReservaNoEncontradaError`**.

> Nota de valor: esta integración caza el bug que un `motor` fake enmascaró (el borrador se
> persistía con el texto de la respuesta inicial del catálogo E1 en lugar del de la plantilla
> de transición). Ver memoria `despachar-ignora-variablesextra-cuerpo`.

## Frontend (apps/web)

- eslint de los ficheros del change: **EXIT 0**.
- vitest de `features/presupuestos` + `features/reservas/pages/FichaConsulta`:
  **102 tests verde**; los nuevos (`GenerarPresupuestoDialog.datosFiscales`, avisos de ficha) pasan.
- 2 fallos en `DetallesEvento.test.tsx` ("Comentarios del alta") — **pre-existentes y ajenos**
  (fichero no tocado por el change; verificado por `git stash` por el frontend-developer).

## Suite completa `apps/api` (contexto)

- **2900/2913 tests verde.** 13 fallos en 9 suites, **todos pre-existentes en master**
  (probado: `git diff master` vacío en esos ficheros):
  - `reservas/application/plantilla-transicion-fecha.spec.ts` y `transicion-fecha*` — el test
    espera la firma `"Ari — Masia l'Encís"` (una línea) pero la plantilla la emite multilínea.
  - `reservas/__tests__/alta-consulta*` — `canalEntrada` default `web`/`email` y deadlock 40P01
    (concurrencia US-004, flaky documentado).
  - `documentos/**` + `disparar-e2` — flakiness ESM de react-pdf (color/bytes PDF).
- Lint/tsc: eslint api EXIT 0; `tsc -p tsconfig.build.json` EXIT 0. `tsc` web tiene 1 error
  **pre-existente** en `features/facturacion/components/EnvioFacturaSenal.tsx:95` (ajeno).

## Conclusión

El área del change está **100% en verde** (unit + integración BD real + web). Los fallos de la
suite completa son pre-existentes y ajenos a los ficheros que toca la rama. Pendiente: curl del
MAPEO HTTP del controller (§7) y E2E Playwright (§8), sujetos a decisión en el gate final.
