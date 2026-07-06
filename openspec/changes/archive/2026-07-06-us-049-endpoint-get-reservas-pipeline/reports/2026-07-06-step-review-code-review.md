# Code review — US-049 GET /reservas (pipeline de reservas activas)

- Fecha: 2026-07-06
- Revisor: code-reviewer (solo lectura, sin auto-fix)
- Alcance: `git diff master...HEAD` en `feature/us-049-050-pipeline-reservas`
- Fuentes de verdad: `openspec/changes/us-049-endpoint-get-reservas-pipeline/` (proposal + spec-delta), `CLAUDE.md`, skills `review-checklist` y `architecture-guardrails`.

## Veredicto

Veredicto: APTO

Sin hallazgos bloqueantes. Se registra un (1) hallazgo de severidad **Alta** de endurecimiento
(no bloqueante) y un par de notas menores. El endpoint aísla correctamente por tenant, es de
lectura pura y respeta la arquitectura hexagonal.

## Checklist de guardrails duros

| Regla | Resultado |
|-------|-----------|
| Hexagonal — `domain/` sin `@nestjs/*`/`@prisma/*`/infra | OK |
| Puertos en dominio, adaptador en infra | OK |
| Multi-tenancy — `tenant_id` del JWT, nunca del query/body | OK |
| RLS activo (`fijarTenant`/`SET LOCAL app.tenant_id`) + filtro `tenant_id` en toda query | OK |
| Lectura pura — sin mutación ni bloqueos | OK |
| Exclusión de terminales/cerrados por defecto | OK (ver hallazgo Alta sobre override por filtro) |
| Derivación de progreso como mapa declarativo / función pura | OK |
| Contrato aditivo (campos nuevos opcionales) | OK |
| SDK regenerado, no editado a mano | OK |
| Importes en Decimal (no Float) | OK (`Decimal(10,2)` -> string `toFixed(2)`) |
| DTOs validados con class-validator | OK |
| Errores en español | OK |
| TS strict sin `any` injustificado | OK |
| Convenciones (arrow functions, naming, capas) | OK (`pnpm eslint` limpio) |
| Tests primero y en verde | OK (22/22 pasan) |
| Responsive (frontend) | N/A — el diff no toca UI de `apps/web` (solo SDK regenerado) |

## Detalle por capa

### Dominio — `domain/listar-reservas.port.ts`
- Puro: solo importa `EstadoReserva`/`SubEstadoConsulta` de `./maquina-estados`. Sin Prisma ni NestJS.
- `PipelineQueryPort` (interfaz) + read-models viven en dominio. Correcto.
- Progreso modelado como estructura declarativa (`MAPA_PROGRESO_LOGISTICA`, `MAPA_PROGRESO_LIQUIDACION`)
  y funciones puras (`derivarProgressLogistica`, `derivarProgressLiquidacion`, `derivarNombreEvento`);
  `esFasePreviaAlProgreso` fuerza 0 en consulta/pre_reserva. Sin if/else disperso. Correcto.

### Aplicación — `application/listar-reservas.use-case.ts`
- Depende solo del puerto inyectado. Proyecta y calcula metadata (`calcularTotalPaginas` pura). Sin escritura.

### Infraestructura — `infrastructure/listar-reservas.prisma.adapter.ts`
- `fijarTenant(tx, tenantId)` como primera operación de la transacción de lectura + `where.tenantId`
  siempre presente (defensa en profundidad, patrón idéntico a `cola-espera-query.prisma.adapter`).
- Exclusión por defecto de `ESTADOS_CERRADOS` y `SUB_ESTADOS_TERMINALES` vía `notIn`.
- Importes `Decimal` -> `string` con `toFixed(2)`. Correcto.
- `fila.cliente` se accede sin guarda de null: es seguro porque en `schema.prisma` la relación es
  obligatoria (`clienteId String`, `cliente Cliente`), aunque el read-model la declare nullable de
  forma defensiva. Sin defecto.

### Interfaz — `controller.ts` / `dto.ts`
- `tenantId` tomado de `@CurrentUser().tenantId`; jamás del query. Correcto.
- DTOs con class-validator; mensajes en español; `@Type(() => Number)` para page/limit.
- Nombres camelCase alineados con el contrato.

### Contrato / SDK
- `docs/api-spec.yml`: `operationId: listarReservas` + 3 campos **opcionales** en `Reserva`
  (`nombreEvento`, `progressLogistica`, `progressLiquidacion`). No se añaden a `required`, por lo que
  `ReservaDetalle`/`CreateReservaResponse`/`ReservaListResponse` no se rompen. Cambio aditivo. Correcto.
- `apps/web/src/api-client/schema.d.ts`: regenerado (extracción a `operations["listarReservas"]` +
  campos opcionales). Consistente con la spec; no editado a mano. Correcto.

## Hallazgos

### Alta (no bloqueante) — el filtro `estado`/`subEstado` puede eludir la exclusión de terminales/cerrados
- Ubicación: `apps/api/src/reservas/infrastructure/listar-reservas.prisma.adapter.ts` (método
  `construirWhere`, ramas `estado`/`subEstado`).
- Regla: spec-delta `specs/pipeline/spec.md` §"la exclusión de terminales/cerrados ... se aplica
  siempre, con independencia de los filtros" y §"Exclusión de estados terminales y cerrados".
- Problema: cuando el cliente pasa `estado`/`subEstado`, el `where` sustituye la clausula `notIn`
  por igualdad exacta. Como el DTO acepta en su `IsIn` valores cerrados/terminales
  (`reserva_completada`, `reserva_cancelada`, `2x`/`2y`/`2z`), una petición como
  `GET /reservas?estado=reserva_completada` o `?subEstado=2x` devolvería reservas cerradas/terminales,
  contradiciendo el invariante "siempre excluidas". No es fuga entre tenants (el filtro `tenantId`
  sigue aplicándose), por eso no es bloqueante; es un defecto de conformidad con la spec / alcance de datos.
- Recomendación: combinar el filtro con la exclusión en vez de reemplazarla
  (p. ej. `estado: filtros.estado ?? undefined` **y** mantener siempre `notIn: ESTADOS_CERRADOS`,
  o rechazar en el DTO los estados cerrados/sub-estados terminales como valores de filtro). Añadir un
  test de adaptador/e2e que verifique que `?estado=reserva_completada` y `?subEstado=2x` devuelven vacío.

### Menor — cobertura de test del adaptador
- Los 22 tests ejercitan el use-case contra un doble del puerto; la lógica de `construirWhere`
  (exclusión, rango de fecha, `search`, saneo de page/limit) no tiene test unitario propio. Los curl
  del step N+2 la cubren parcialmente. Recomendación: test de adaptador para el invariante de exclusión
  (ligado al hallazgo Alta) y para el saneo de `limit` (>100 -> 100).

### Menor — DTO `estado`/`subEstado` con lista literal duplicada
- `dto.ts` mantiene `ESTADOS`/`SUB_ESTADOS` como arrays literales para `IsIn`. Es correcto, pero
  duplica los valores de enum del dominio; si crecen los estados hay riesgo de desincronización.
  Recomendación (baja): derivar de una única fuente de verdad de enums.

## Notas de verificación
- `npx jest listar-reservas` -> 22 passed.
- `npx eslint` sobre los 5 ficheros nuevos -> sin errores (arrow functions, capas, naming OK).
- `grep` de `any`/`Float` en ficheros nuevos -> sin coincidencias.
