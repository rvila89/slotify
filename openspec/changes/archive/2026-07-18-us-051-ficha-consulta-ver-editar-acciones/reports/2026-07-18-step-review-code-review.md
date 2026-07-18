# Code Review — US-051 Ficha de consulta: ver / editar / acciones

Fecha: 2026-07-18
Revisor: code-reviewer (solo lectura)
Rama: `feature/us-051-ficha-consulta-ver-editar-acciones` vs `master` (`3a0bc9c..HEAD`)
Alcance: SDD, contrato+SDK, TDD, backend, frontend, fix read-path `horario`, QA reports, docs.

## Resumen

Change consistente y de alta calidad. Los cuatro puntos (ver detalles, editar consulta con PATCH
genérico + cambio atómico de fecha, gating de presupuesto por completitud, saneo de acciones en
terminales) respetan todos los guardrails duros del proyecto. La operación `POST
/reservas/{id}/cambiar-fecha` implementa el bloqueo atómico exclusivamente en PostgreSQL, sin
Redis ni locks distribuidos. No se detectan bloqueantes.

## Hallazgos por severidad

### Bloqueantes
Ninguno.

### Alta
Ninguno.

### Media
Ninguno.

### Baja (no bloqueantes; opcionales)

- [DTO/validación] `apps/api/src/reservas/interface/actualizar-reserva.dto.ts:34-47` — los recuentos
  `numAdultosNinosMayores4`, `numNinosMenores4` y `numInvitadosFinal` se validan con `@IsInt()` sin
  `@Min(0)`. Coincide con el contrato (`UpdateReservaRequest`: `integer` sin `minimum`), por lo que
  NO es un mismatch contrato↔backend; pero permitiría persistir recuentos negativos. Recomendación:
  añadir `@Min(0)` (y reflejar `minimum: 0` en el contrato) en un ajuste posterior si se quiere
  blindar el dato. No bloquea: la guarda de completitud del frontend ya exige `>= 1` para
  presupuestar y el gating defensivo del backend no se ve afectado.

- [frontend/mapper] `apps/web/src/features/reservas/lib/editarConsultaSchema.ts:76` — `aUpdateReservaRequest`
  asigna `body.notas = valores.notas` siempre (incluido string vacío), de modo que abrir el editor y
  guardar sin tocar notas puede escribir `notas: ''`. Es el comportamiento pretendido (permitir vaciar
  notas) y el AUDIT_LOG lo refleja; solo se anota por claridad. Sin acción requerida.

## Verificación de guardrails duros

- **Bloqueo atómico de fecha (APTO).** `cambiar-fecha-uow.prisma.adapter.ts` abre UNA
  `$transaction` con `fijarTenant` (RLS `SET LOCAL`) como primera operación; `leerEstadoFecha` hace
  `SELECT … FOR UPDATE OF fb` sobre `FECHA_BLOQUEADA(tenant, F2)` para serializar cambios rivales;
  el movimiento F1→F2 usa `fechaBloqueada.updateMany` TIPADO (no `$executeRaw`), lo que emite un
  `P2002` limpio con `meta.target` — decisión correcta frente al `P2010` que devolvería una raw
  query (aprendizaje QA registrado). `esColisionFecha` distingue la colisión de `(tenant_id,fecha)`
  de la de `reserva_id`, traduciendo solo la primera a `CambiarFechaConflictoError` (409) con
  rollback total. Promoción FIFO (A15) dentro de la misma transacción, con las filas de cola
  bloqueadas por `FOR UPDATE` (exactamente-una-vez) y su AUDIT_LOG. Sin Redis/Redlock. El test de
  concurrencia asserta las invariantes reales (1 gana / 1 conflicto, un único bloqueo en F2, un
  único promovido) contra Postgres real.

- **PATCH genérico no muta fecha (APTO).** `actualizar-reserva.use-case.ts` +
  `actualizar-reserva-uow.prisma.adapter.ts`: el puerto de escritura NI SIQUIERA expone
  `fechaEvento`/`estado`/`subEstado`; el `data` del `updateMany` solo contiene columnas simples
  presentes; `extraerCamposSimplesPresentes` descarta cualquier campo ajeno colado en el body, y el
  DTO sin `fechaEvento` + `forbidNonWhitelisted` global rechaza (400) un cliente que la envíe. No
  toca `FECHA_BLOQUEADA`.

- **Hexagonal/DDD (APTO).** `domain/maquina-estados.ts` (guarda `esOrigenValidoParaCambiarFecha` +
  tabla declarativa `ORIGENES_CAMBIAR_FECHA_BLOQUEADA` = solo `2b/2c/2v`) sin imports de
  `@nestjs/*`, `@prisma/*` ni `infrastructure/` (verificado). Los casos de uso dependen solo de
  puertos inyectados; los adaptadores Prisma viven en `infrastructure/`.

- **Multi-tenancy / RLS (APTO).** `tenantId`/`usuarioId` siempre desde `@CurrentUser` (JWT), nunca
  del path/body. Toda UoW hace `fijarTenant` como primera operación; las lecturas y updates filtran
  `tenant_id`; cross-tenant → `null` → 404. AUDIT_LOG (`accion='actualizar'`, `entidad='RESERVA'`)
  registrado dentro de cada transacción mutadora.

- **Máquina de estados (APTO).** Guarda declarativa por tabla, re-evaluada bajo el lock; sin
  `if/else` dispersos. Terminales sin acciones.

- **Contrato/SDK (APTO).** `docs/api-spec.yml` añade `/reservas/{id}/cambiar-fecha`,
  `CambiarFechaRequest`, `CambiarFechaConflictoError` (allOf ErrorResponse + `motivo`) y `horario`
  en `Reserva`/`UpdateReservaRequest`. `apps/web/src/api-client/schema.d.ts` contiene las entradas
  generadas coherentes (no editado a mano). Sin mismatch de clave de matching contrato↔backend: el
  409 se casa por `motivo`, la fecha por el único campo `fechaEvento`, el PATCH por camelCase
  espejo. Los hooks consumen el SDK (`apiClient.POST/PATCH`), no hay fetch a mano.

- **Frontend (APTO).** Arrow functions en todos los componentes/hooks; helpers/schemas/tipos en
  `lib/`/`model/` (`estadoTerminal.ts`, `editarConsultaSchema.ts`, `detallesEvento.ts`,
  `horarios.ts`, `presupuestos/lib/estado.ts`), nunca en `components/`. `max-lines`: los ficheros de
  319/372 líneas quedan bajo el límite efectivo (config `skipBlankLines`+`skipComments`); ESLint no
  reporta errores (solo warnings de deprecación de `boundaries`). Feature importada por su barrel
  (`@/features/presupuestos`, `@/features/reservas`); barrels actualizados. UI mobile-first
  (`grid-cols-1 sm:grid-cols-2`, botones `w-full sm:w-auto`, `Dialog` shadcn con `max-h-[90vh]
  overflow-y-auto`), sin anchos px fijos que rompan; evidencia E2E en 390/768/1280 en los reports.

- **Tests primero / importes (APTO).** Suites TDD-RED presentes (unit, concurrencia, integración);
  QA reporta 1369/1369 unit, 29/29 concurrencia/integración ×3, 304/304 web. No se introduce `Float`
  para importes.

- **Convenciones (APTO).** Nombres en español (PascalCase/camelCase/kebab-case), comentarios y
  mensajes de error en español; códigos HTTP correctos (400 validación PATCH, 422 guarda/fecha,
  404 RLS, 409 conflicto).

## Veredicto: APTO
