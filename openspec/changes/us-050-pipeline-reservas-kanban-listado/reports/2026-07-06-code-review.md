# Informe de code-review - US-050 Visualizar Pipeline de Reservas (Kanban + Listado)

- **Change:** us-050-pipeline-reservas-kanban-listado
- **Fecha:** 2026-07-06
- **Revisor:** code-reviewer (solo lectura)
- **Base de comparacion:** working tree (cambios US-050) vs `master`; US-049 ya archivada.

## Veredicto: APTO

El unico hallazgo BLOQUEANTE detectado en la primera pasada (reformateo accidental de
`apps/api/prisma/schema.prisma` que perdia los 6 `@db.Text` y el comentario de GARANTIA
ATOMICA) **ha sido corregido por revert** y re-verificado de forma independiente (ver
seccion "Resolucion del bloqueante"). El resto del diff (backend de conformidad, frontend
del pipeline, ediciones de tests) es correcto y conforme a los guardrails. Quedan dos
hallazgos MENORES como deuda documentada, no bloqueantes.

---

## Resolucion del bloqueante (revert + re-verificacion)

- **Origen:** era una modificacion NO commiteada del working tree (un `prisma format`
  accidental). `master..HEAD` nunca tuvo diff en ese archivo.
- **Accion:** `git checkout HEAD -- apps/api/prisma/schema.prisma`.
- **Re-verificacion independiente del code-reviewer:**
  - `git status --porcelain apps/api/prisma/schema.prisma` -> vacio (limpio).
  - `git diff --stat HEAD -- apps/api/prisma/schema.prisma` -> vacio (identico a HEAD/master).
  - `grep -c '@db.Text'` -> 6 (restaurados; antes 0).
  - Comentario `@@unique([tenantId, fecha]) // GARANTIA ATOMICA ANTI-DOBLE-RESERVA` presente.
  - `npx prisma validate` -> "The schema is valid" (reportado por el coordinador).
  - `npx jest listar-reservas` -> 4 suites / 43 tests passed (incluye integracion SQL real
    del filtro subEstado y conformidad de contrato).
- **Conclusion:** sin drift schema<->migraciones. Bloqueante RESUELTO.

---

## Hallazgos

### BLOQUEANTE

- (resuelto) `apps/api/prisma/schema.prisma`: reformateo `prisma format` en working tree que
  perdia los 6 `@db.Text` (`FichaOperativa.menuSeleccionado`, `timingDetallado`, `notasOperativas`,
  `briefingEquipo`, `Comunicacion.cuerpo`, `Reserva.notas`) y borraba el comentario de garantia
  del `@@unique([tenantId, fecha])`, provocando drift respecto a la migracion `init` (que las define
  como `TEXT`). **Corregido por revert a HEAD** y re-verificado (ver arriba). No forma parte del scope
  de US-050. No quedan bloqueantes abiertos.

### MAYOR

- (ninguno)

### MENOR (deuda documentada, no bloqueante)

- **[test-design] E2E `e2e/us-050-pipeline-reservas.spec.ts` test 8.2 acoplado a BD global vacia.**
  El test 8.2 pega contra la API real y asserta FA-01 (estado vacio / CTA "Nueva Reserva"), lo que SOLO se
  cumple si `slotify_dev` no tiene reservas activas. En cuanto hay datos activos (p. ej. el seed de la suite
  5c4) el test falla -- como reporto QA. No es un defecto de producto: FA-01 ya esta cubierto de forma
  determinista por el test mockeado 8.6b.
  - **Recomendacion:** convertir 8.2 a un escenario controlado (mock de ruta con `data:[]`, como el resto de
    la suite) o sembrar/limpiar su propia precondicion. Deuda de test, no bloquea el merge.

- **[barrel] `features/reservas/index.ts` expone sub-componentes internos de pagina.**
  El barrel exporta `ReservaKanbanCard` y `ListadoView` (ademas de `ReservasPage`), porque los tests RED los
  importan via barrel (coherente con la regla de "solo se importa una feature por su barrel"), pero son partes
  internas de `pages/ReservasPage/`.
  - **Recomendacion:** valorar mantener en el barrel solo `ReservasPage` + hook y tipos publicos. No bloquea
    (la regla de boundaries se cumple y `pnpm lint` esta en verde).

---

## Checklist verificado (OK)

- **Contrato OpenAPI (§1):** OK. `Reserva` en `docs/api-spec.yml` usa `idReserva` (required) y declara `fechaEvento`
  (date, nullable), `numInvitadosFinal`, `numAdultosNinosMayores4`, `numNinosMenores4`, `notas` (todos nullable). La
  proyeccion del use-case, el `ReservaPipelineItemDto` (con `@ApiPropertyOptional`) y el mapeo del controlador emiten
  exactamente esos campos. `fechaEvento` se serializa como `date` (`toISOString().slice(0,10)`), no date-time. El SDK
  del frontend NO se edito a mano: `useReservasActivas` usa `apiClient.GET('/reservas')` y el tipo `Reserva` se alias de
  `components['schemas']['Reserva']` (regenerado del contrato).

- **Bloqueo atomico de fecha (§2):** OK. Ninguna ruta de bloqueo se toco. Sin Redis/locks distribuidos en el diff.
  El comentario de garantia del `@@unique` esta restaurado tras el revert.

- **Multi-tenancy / RLS (§2):** OK. El adaptador `listarActivas` fija el tenant como primera operacion de la transaccion
  (`this.prisma.fijarTenant(tx, filtros.tenantId)`) y filtra siempre por `tenantId`. El tenant viene del comando (JWT).

- **Hexagonal / DDD (§3):** OK. `application/listar-reservas.use-case.ts` no importa infra/Prisma/Nest; el adaptador vive
  en `infrastructure/` e implementa el puerto. `aFechaDate` y `proyectar` estan en la capa de aplicacion.

- **Fix del filtro `subEstado` (adaptador):** OK. Sin filtro, se admite `subEstado IS NULL` via `OR` colgado de `where.AND`
  (no pisa el `OR` de `search`), resolviendo que `NULL NOT IN (...)` excluia reservas de pre_reserva/reserva_confirmada/etc.
  Verificado por test unitario del adaptador, integracion (5c.1) y E2E con datos reales (5c4).

- **Ediciones de tests -- sin debilitamiento (§4):**
  - Backend `use-case.spec.ts`: `as Record<...>` -> `as unknown as Record<...>` es solo saneamiento de TS; se ANADIERON
    3 tests de conformidad y se actualizo `id` -> `idReserva`. Endurece, no debilita.
  - Backend `prisma.adapter.spec.ts`: assertion `where.subEstado` -> `where.AND` refleja la estructura correcta y sigue
    verificando exclusion de terminales + admision de NULL. Intencion conservada.
  - Frontend RED `.tsx` (3): imports de `model/types` al barrel `@/features/reservas` -- refuerza boundaries; aserciones de
    render conservadas.
  - Frontend shell (`AppShellNavigation`, `AppShellResponsive`): actualizados porque `/reservas` ahora monta `ReservasPage`;
    la assertion pasa del testid del placeholder al `<h1>` "Reservas". Se dobla SOLO `apiClient.GET` (lista vacia). Intencion
    conservada. Sin regresion ocultada.

- **Reglas duras frontend (§5):** OK. Arrow functions (0 `function`), sin `any`, todos <=300 lineas (max 89). Estructura por
  dominio con barrel. Responsive mobile-first: Kanban `overflow-x-auto` (scroll horizontal <lg, no apila); Listado refluye a
  tarjetas apiladas (<lg `flex flex-col`, >=lg `lg:table-row-group`), `thead` `sr-only` en movil. Accesibilidad:
  role=tablist/tab/tabpanel + aria-selected, role="alert" en error, aria-label en enlaces/columnas. Evidencia QA 390/768/1280
  sin overflow.

- **Salud de la suite (§6):** Backend 1329/1329, frontend 84/84, lint+typecheck en verde (QA 5c4). Flaky US-004 (`40P01`) paso;
  deuda pre-existente documentada, NO regresion de US-050.

- **Convenciones e idioma:** OK. Nombres, comentarios y errores en espanol.

---

## Cierre

Bloqueante resuelto y re-verificado. No quedan bloqueantes ni hallazgos mayores. Los dos hallazgos menores (E2E 8.2 acoplado a
BD vacia; superficie del barrel) se dejan como deuda documentada. **Veredicto: APTO.**
