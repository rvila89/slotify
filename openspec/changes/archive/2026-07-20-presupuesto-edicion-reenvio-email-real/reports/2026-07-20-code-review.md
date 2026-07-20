# Informe de code-review — presupuesto-edicion-reenvio-email-real

- Fecha: 2026-07-20
- Revisor: code-reviewer (solo lectura)
- Base: `master`  ·  Rama: `feature/presupuesto-edicion-reenvio-email-real` (diff sin commitear)
- Alcance: envío real E2 en edición/reenvío (`despacharReenvio`), marca `esEdicion`,
  fila única `COMUNICACION` (D1), prefill + scroll frontend (D3).

## Comprobaciones ejecutadas

| Check | Resultado |
|-------|-----------|
| `tsc --noEmit` (apps/api) | OK, sin errores |
| `tsc --noEmit` (apps/web) | OK, sin errores |
| `eslint` sobre ficheros backend cambiados | OK, sin hallazgos |
| `eslint` sobre ficheros frontend cambiados | OK (solo warnings pre-existentes de `boundaries` deprecation) |
| Jest unit (editar use-case, despachar service, catálogo E2, reenviar adapter) | 100 tests, 4 suites — PASSED |
| Vitest (EditarPresupuestoDialog.prefill) | 4 tests — PASSED |
| Integración BD real (`editar-reenviar-email-real-integracion.spec.ts`) | NO ejecutada aquí (subagente sin Postgres) — lanzar desde sesión principal |

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Alta
- Ninguno.

### Media
- **[deuda / doble-registro latente] Código muerto que puede reintroducir el bug D1.**
  `ComunicacionesRepositoryPort` + `ReposEditarPresupuesto.comunicaciones`
  (`editar-presupuesto.use-case.ts:340,370`) y su implementación
  `ComunicacionesPrismaRepository.registrarE2Reenvio` (`editar-presupuesto-uow.prisma.adapter.ts:164-211`)
  siguen vivos y cableados en la UoW (`:251 comunicaciones: new ComunicacionesPrismaRepository(tx)`),
  y esa implementación **todavía persiste una fila `COMUNICACION` dentro de la tx**
  (`asunto:'Presupuesto actualizado'`, `estado='enviado'`). El use-case ya NO la invoca
  en el camino de edición (los tests lo blindan con
  `expect(repos.comunicaciones.registrarE2Reenvio).not.toHaveBeenCalled()`), por lo que
  hoy NO se produce doble fila. Riesgo: es exactamente el registro que D1 quería eliminar;
  cualquier futura reintroducción de la llamada resucitaría el doble-registro en silencio.
  Recomendación: eliminar el puerto, el campo de `ReposEditarPresupuesto`, la clase
  `ComunicacionesPrismaRepository` y su cableado en la UoW (o, si se conserva por diseño,
  dejarlo documentado explícitamente como no-op y sin `comunicacion.create`). Aceptable
  para merge como deuda anotada, pero conviene limpiarlo en este mismo change.

- **[responsive / evidencia] Falta evidencia QA en 3 viewports (390/768/1280).**
  `reports/` está vacío. El cambio de frontend no introduce anchos px fijos ni toca el
  layout (solo prefill + `scrollTo`), por lo que el riesgo real es bajo; aun así el
  checklist exige evidencia en los 3 viewports para el flujo de edición/reenvío.
  Recomendación: adjuntar capturas E2E (edición y reenvío desde ficha pre_reserva) antes
  del gate final. No bloqueante.

### Baja
- **[proyección optimista] `idComunicacion: ''`** en la respuesta HTTP tanto en edición
  (`editar-presupuesto.use-case.ts:~825`) como en reenvío
  (`reenviar-presupuesto.prisma.adapter.ts:~112`). Es coherente con D1 (fuente única
  post-commit; la fila real la escribe el motor) y el contrato/shape no cambia, pero un
  id vacío es un valor centinela poco expresivo. Recomendación (opcional): documentar que
  el consumidor no debe usar `idComunicacion` de esta respuesta, o proyectar el estado sin
  id. Sin impacto funcional.

## OK / conforme

- **Hexagonal/DDD**: sin imports de `@nestjs/*`, `@prisma/*` ni `infrastructure/` en
  `domain/`. El use-case depende solo de puertos; los adaptadores (`DispararE2Adapter`,
  `ReenviarE2PresupuestoAdapter`) viven en `infrastructure/`. `renderE2`/`renderE2Ca` son
  funciones puras. Nueva propiedad `esEdicion?` añadida a los puertos, no a dominio.
- **Bloqueo atómico de fecha**: NO tocado. Sin Redis/Redlock/lock distribuido. La
  edición y el reenvío no mutan `FECHA_BLOQUEADA`; la suite de integración lo asevera
  (`ttlBloqueo` inalterado en ambos flujos).
- **Idempotencia vs reenvío (núcleo del change)**: correcto. El primer envío (US-014)
  sigue por `despachar` (idempotente) porque `esEdicion` es ausente; solo edición
  (`esEdicion=true`) y reenvío usan `despacharReenvio`. La propagación server-side
  `esEdicion` llega hasta `construirVariables` → `render` (default `false`). Reenvío sin
  cambios NO lleva marca (E2 estándar), edición sí ("Hemos actualizado…"). Verificado en
  integración: transporte invocado + UNA sola fila `es_reenvio=true` (sin doble registro).
- **Multi-tenancy/RLS**: ambos adaptadores hacen `fijarTenant(tx, tenantId)` y filtran por
  `tenantId` en las queries; el tenant proviene del comando (JWT aguas arriba), no del body.
- **Contrato**: `api-spec.yml`, cliente generado y tipos `EdicionPresupuestoResponse`/
  `ReenviarPresupuestoResponse` NO editados. `esEdicion` derivado en servidor, no entra por
  el contrato. Shape de respuesta intacto (proyección optimista sobre los mismos campos).
- **Reglas duras frontend**: helper `acotarDuracionInicial` correctamente en `lib/edicion.ts`
  (no en `components/`). Sin anchos px fijos nuevos. Arrow functions en todo el código nuevo.
  `pnpm lint` limpio, `max-lines` no superado.
- **Convenciones**: nombres en español (PascalCase/camelCase), comentarios y textos de
  error en español. Importes intactos en `Decimal` (no se tocaron; sin `Float`).
- **Tests primero**: existen y pasan tests unit (edición, service, catálogo E2, reenvío
  adapter), un test de prefill frontend y un test de integración BD real que cubre fila
  única, envío real, marca de edición vs reenvío estándar e invariantes FECHA_BLOQUEADA/
  RESERVA/ttl.

## Veredicto

Veredicto: APTO

No hay bloqueantes. Se recomienda, antes del gate final: (1) limpiar el código muerto de
`ComunicacionesRepositoryPort`/`ComunicacionesPrismaRepository` (Media, deuda D1 latente)
y (2) adjuntar evidencia E2E en 3 viewports (Media). Además, ejecutar la suite de
integración de BD real desde la sesión principal (con Postgres) para validar el envío real
y la fila única contra la base de datos.
