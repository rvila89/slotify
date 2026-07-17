# Informe de code-review — US-032 Forzar inicio de evento

- Fecha: 2026-07-17
- Rama: `feature/us-032-forzar-inicio-evento` vs `master`
- Tipo: revisión de solo lectura contra `review-checklist` + `architecture-guardrails`
- Alcance: dominio, aplicación, infraestructura, interface, contrato + SDK, frontend, tests

## Resumen

Implementación limpia y coherente con los guardrails de Slotify. El forzado manual reutiliza
las guardas de dominio de US-031 (`resolverInicioEvento`, `preconditionesEventoCumplidas`) sin
duplicar la máquina de estados, añade una guarda de fecha pura (`esDiaDelEvento`), serializa la
transición con `SELECT … FOR UPDATE` + `UPDATE` condicional bajo RLS (sin locks distribuidos),
audita el override con origen Usuario y respeta D-5 (muta solo `estado`). Contrato y SDK
coherentes; frontend mobile-first con doble confirmación, arrow functions y helpers en `lib/`.

No se han encontrado hallazgos Bloqueantes ni de severidad Alta.

## Hallazgos por severidad

### Bloqueante
- Ninguno.

### Alta
- Ninguna.

### Media
- Ninguna.

### Baja
- [convención/ruido de diff] `apps/web/src/api-client/client.ts`, `index.ts` y
  `apps/web/src/features/reservas/index.ts` aparecen como modificados por CAMBIO DE FIN DE LÍNEA
  (LF→CRLF), no por contenido. Verificado con `git diff --ignore-cr-at-eol`: en `client.ts`/
  `index.ts` (SDK) no hay cambios de contenido; en el barrel el único cambio real son las
  exportaciones de US-032. No es una edición a mano del cliente generado (regla dura respetada),
  pero el churn de EOL infla el diff. Recomendación: normalizar EOL (`.gitattributes eol=lf` /
  `git add --renormalize`) antes del merge para dejar el diff limpio. No bloquea.
- [semántica de error, informativo] `cargar-reserva-forzar-inicio.prisma.adapter.ts:53` devuelve
  `null` (→ 404) cuando `fecha_evento IS NULL`. Una RESERVA en `reserva_confirmada` sin
  `fecha_evento` es un dato inconsistente que en teoría debería mapear a 422/409, no a 404. En la
  práctica `reserva_confirmada` siempre tiene fecha (invariante del pipeline), por lo que es un
  caso inalcanzable; está documentado en el propio adaptador. Sin acción requerida.

## Verificación del checklist

- Hexagonal: OK. `domain/maquina-estados.ts` (nueva `esDiaDelEvento`, guarda pura año-mes-día)
  no importa `@nestjs/*`, `@prisma/*` ni `infrastructure/`. El use-case depende solo de puertos.
- Bloqueo/serialización de fecha: OK. Sin Redis/Redlock/lock distribuido. La exclusión mutua es
  `SELECT … FOR UPDATE` sobre la fila RESERVA + `updateMany … WHERE estado='reserva_confirmada'`
  (`forzar-inicio-evento-uow.prisma.adapter.ts`). No toca `FECHA_BLOQUEADA` ni la cola.
- Máquina de estados: OK. Reutiliza la tabla declarativa `MAPA_INICIO_EVENTO` /
  `resolverInicioEvento` y `preconditionesEventoCumplidas` de US-031; no añade `if/else` dispersos
  ni aristas nuevas. `esDiaDelEvento` es una precondición pura, no una transición.
- Multi-tenancy / RLS: OK. `tenantId` y `usuarioId` siempre del JWT (`@CurrentUser`), nunca del
  path/body. `SET LOCAL app.tenant_id` como primera operación de cada transacción
  (`fijarTenant`) en carga y en la UoW; queries filtran `tenant_id`.
- Orden de guardas: OK. 404 (no encontrada) → 409 (estado != reserva_confirmada) → 422
  (fecha != hoy) → tx → 409 (0 filas, carrera perdida), sin efectos antes de la tx.
- D-5 (muta solo estado): OK. La UPDATE fija exclusivamente `estado`; no toca los tres `*_status`.
- Auditoría: OK. AUDIT_LOG tx-bound, `accion='transicion'`, origen Usuario (`usuarioId` poblado),
  `datos_nuevos` con `forzado_por_gestor: true` + `precondiciones_incumplidas`. Verificado en BD
  por QA.
- Tipos y datos: OK. TS strict, sin `any` en los ficheros de US-032. Importes como `string`
  (`Importe`, Decimal), sin `Float`/`number` para dinero. DTO de respuesta solo salida; request
  vacío con `additionalProperties:false`, reforzado por `ValidationPipe` global
  (`whitelist + forbidNonWhitelisted`).
- Contrato: OK. `docs/api-spec.yml` define `forzarInicioEvento`, `ForzarInicioEventoRequest/
  Response/ConflictError/FechaError` alineados con los DTOs. SDK `schema.d.ts` regenerado
  coherente (mismos schemas, descripciones y enums); no editado a mano.
- Autorización: OK. `@Roles('gestor')` + `RolesGuard`; `JwtAuthGuard` global (APP_GUARD) exige
  token (401). No usa `X-Cron-Token` (no es el barrido de Sistema de US-031).
- Frontend responsive/estructura: OK. Mobile-first (`max-h-[90vh]` con scroll, footer
  `flex-col … sm:flex-row`, botones `w-full sm:w-auto`, objetivos táctiles `h-12`/`h-14`), sin
  anchos px fijos que rompan en móvil. Evidencia E2E en 390/768/1280 (report e2e). `components/`
  solo `.tsx`; helpers/constantes en `lib/forzarInicioEvento.ts`. Arrow functions en todo. Feature
  importada solo por barrel. Ficheros bajo el límite de `max-lines` (300, skip blanks/comments);
  `FichaConsultaPage.tsx` incluso se redujo (342→330 wc) por las extracciones.
- Overflow de cabecera del app-shell en 390/768: deuda pre-existente ajena a US-032
  (memoria `appshell-overflow-768-deuda`); los componentes de US-032 no desbordan. No es defecto
  de esta US.
- Tests primero (TDD): OK. `maquina-estados-dia-del-evento.spec.ts` (7 casos, incl. off-by-one
  horario y medianoche), `forzar-inicio-evento.use-case.spec.ts`,
  `forzar-inicio-evento.controller.http.spec.ts`, `forzar-inicio-evento-reuso-dominio.spec.ts`,
  `forzar-inicio-evento-concurrencia.spec.ts` (un solo ganador, sin doble auditoría),
  `forzar-inicio-evento-integracion.spec.ts`. Backend 39 unit/controller + 2 concurrencia real +
  4 integración real verdes; frontend 241 verdes; typecheck + lint OK; QA curl (401/404/200/409/
  422) + BD (audit + D-5) + E2E 3 viewports PASS.
- Convenciones/idioma: OK. Nombres en español (PascalCase/camelCase/kebab-case); mensajes de
  error y comentarios en español.

## Veredicto: APTO
