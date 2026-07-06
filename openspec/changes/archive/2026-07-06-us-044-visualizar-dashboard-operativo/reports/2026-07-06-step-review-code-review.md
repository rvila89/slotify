# Code Review — us-044-visualizar-dashboard-operativo (Dashboard operativo)

- **Fecha**: 2026-07-06
- **Revisor**: code-reviewer (solo lectura; no aplica fixes)
- **Branch**: feature/us-044-visualizar-dashboard-operativo vs master
- **Alcance**: GET /dashboard -> DashboardResponse (7 widgets, lectura pura). UC-34 / US-044. Backend hexagonal apps/api/src/dashboards/ (domain/application/infrastructure/interface) + frontend apps/web/src/features/dashboard/ + contrato docs/api-spec.yml + SDK regenerado.

## Material revisado

- Dominio: domain/dashboard.types.ts, dashboard-query.port.ts, clock.port.ts, color-dashboard.ts.
- Aplicacion: application/consultar-dashboard.use-case.ts (+ spec 18 tests).
- Infraestructura: dashboard-query.prisma.adapter.ts, clock.adapter.ts.
- Interfaz: dashboard.controller.ts, dashboard.dto.ts.
- Wiring: dashboards.module.ts, dashboards.tokens.ts (+ registro en app.module.ts).
- Frontend: feature dashboard/ completa (barrel, api, model, lib, pages, components) + App.tsx, SidebarContent.tsx, barrel features/calendario/index.ts.
- Contrato/SDK: docs/api-spec.yml (path /dashboard + schemas Dashboard*), api-client/schema.d.ts.
- Reports QA: unit (19/19), curl, E2E Playwright (7/7, 3 viewports).

## Verificaciones ejecutadas

- Imports de domain/dashboards/ -> solo tipos de dominio propios + reservas/domain + calendario/domain. Ningun @nestjs/*, @prisma/* ni infrastructure/.
- Busqueda de mutaciones en apps/api/src/dashboards/ (create/update/delete/upsert/executeRaw/*Many) -> ninguna. Lectura pura confirmada.
- Busqueda de any / function declarativo en backend y frontend del modulo -> ninguno (todo arrow; sin any injustificado).
- Guard global JWT (APP_GUARD -> JwtAuthGuard en app.module.ts) activo; el controlador toma tenantId de @CurrentUser (JWT), nunca de query/body.
- Adaptador Prisma: fijarTenant(tx, tenantId) como PRIMERA op de la transaccion (RLS SET LOCAL app.tenant_id) + where tenantId + activo true (defensa en profundidad).
- api-client/ -> solo schema.d.ts (generado) modificado; wrapper HTTP intacto.
- Feature dashboard importada solo por su barrel @/features/dashboard; sin imports profundos hacia archivos internos.
- QA: 19/19 unit verde, suite global 1286/1286; E2E 7/7 con evidencia en 390/768/1280 y sin overflow.

## Checklist Slotify

| Regla | Resultado |
|---|---|
| Hexagonal (domain sin infra/framework) | OK — dominio puro; solo tipos de dominio propios/vecinos. |
| Bloqueo atomico de fecha (sin Redis/locks) | N/A — modulo de lectura. Confirmado sin Redis/lock. |
| Maquina de estados declarativa | OK — filtros por estado; sin if/else disperso. Front usa tabla WIDGETS_META. |
| Multi-tenancy / RLS (tenant_id del JWT) | OK — tenant del JWT; SET LOCAL + where tenantId,activo + filtro defensivo en use-case. |
| Jobs (estado en fila + barrido) | N/A — no hay jobs en este change. |
| Tipos TS strict, sin any injustificado | OK — sin any. Ver H2 sobre nulabilidad. |
| Importes en Decimal | N/A — modulo sin importes/datos financieros (design 7.2). |
| DTOs validados (class-validator) | OK con matiz — DTOs de salida, sin entrada de usuario; solo @ApiProperty. Aceptable en lectura sin body/query. |
| Errores/comentarios en espanol | OK. |
| Contrato OpenAPI vs DTOs | HALLAZGO H1 (Alta) — divergencia en fechaEvento (spec required + no-nullable vs DTO/dominio string-o-null). |
| Cliente HTTP generado, no editado a mano | OK — solo schema.d.ts regenerado. |
| Convenciones de nombres en espanol | OK — PascalCase/camelCase/kebab-case, espanol. |
| Responsive mobile-first (3 viewports) | OK — grid 1/2/3 col; w-full max-w-[1200px] (no rompe en movil); nav drawer <lg; evidencia 390/768/1280 sin overflow. |
| Estructura por dominio + barrel | OK — segmentos api/components/lib/model/pages + barrel; archivos <=300 lineas; sin imports profundos. |
| Tests primero (TDD) | OK — commit test(us-044) TDD-RED previo al codigo; 19/19 verde. |

## Hallazgos

### Bloqueantes
- Ninguno.

### Altas
- H1 — Divergencia contrato vs DTO/dominio en fechaEvento (nulabilidad). docs/api-spec.yml:4430,4444-4447 declara DashboardItem.fechaEvento como type string, format date y lo lista en required (obligatorio y NO nullable); el SDK generado (apps/web/src/api-client/schema.d.ts:3754) lo refleja como fechaEvento: string. Sin embargo: (a) el DTO backend (interface/dashboard.dto.ts:35-36) lo declara fechaEvento: string | null con @ApiProperty nullable true; (b) el dominio (domain/dashboard.types.ts:63) y el use-case usan string | null; (c) los widgets pipeline, subProcesosCriticos, pendientes y consultasEnCola (application/consultar-dashboard.use-case.ts:147-197) NO filtran fechaEvento != null. Consecuencia: una reserva de pipeline en sub-estado 2a (consulta exploratoria sin fecha) se emite con fechaEvento null, valor que el contrato del que se genera el SDK declara imposible. Regla violada: Contrato OpenAPI coincide con los DTOs (checklist 9). Recomendacion (no aplicada): decidir la fuente de verdad y alinear las tres capas — bien marcar fechaEvento como nullable true y fuera de required en api-spec.yml (y regenerar SDK), bien garantizar en el use-case que ningun widget emite items sin fecha. El QA vigente no lo detecto porque el seed solo tenia una reserva 2b (con fecha); el caso 2a/sin-fecha en pipeline no se ejercio (curl report: un unico item con fechaEvento 2027-10-20).
- H2 — Riesgo de Invalid Date en el front por el mismo desajuste. WidgetItem (components/WidgetItem.tsx:26) tipa fechaEvento: string (no-nullable, siguiendo el SDK) y lo pasa a formatearFechaEvento (lib/fecha.ts:7), que construye new Date(iso + T12:00:00Z). Si en runtime llega null (caso H1), se renderiza Invalid Date en la card, sin salvaguarda. TypeScript no lo detecta porque el SDK promete string. Recomendacion: se resuelve al cerrar H1 en el contrato; como defensa adicional, contemplar fechaEvento opcional en WidgetItem y omitir/normalizar cuando falte. Ligado a H1; no es un segundo defecto independiente.

### Menores
- M1 — DTOs sin class-validator. Los DTOs Dashboard*Dto solo llevan @ApiProperty (documentacion del contrato), sin decoradores de validacion. Aceptable: GET /dashboard no recibe body ni query params (tenant del JWT, sin entrada de usuario), no hay payload que validar; los DTOs son forma de respuesta. Se anota por trazabilidad del checklist 6, sin accion requerida.

### Nits
- N1 — Widget pendientes es una aproximacion del MVP. calcularPendientes (use-case.ts:180-187) filtra solo estado == pre_reserva, mientras la descripcion del contrato (schema.d.ts:3721) y WIDGETS_META prometen presupuesto enviado sin respuesta, TTL en 24h, factura vencida. El propio comentario del codigo lo declara como aproximacion a refinar. Coherente con alcance MVP y documentado; sin impacto en guardrails.
- N2 — enlace del contrato no se usa en el front. El backend calcula y expone enlace (/reservas/:id) pero WidgetItem:31 reconstruye la ruta desde reservaId para navegacion SPA (decision documentada en el componente). Consistente; el campo del contrato queda disponible. Sin accion.
- N3 — activo/tenantId en el dataset del dominio. DashboardReservaLectura incluye activo y tenantId para el filtro de defensa en profundidad del use-case; correcto, aunque son solo defensa (el adaptador ya restringe). Sin accion.

## Conclusion

Change solido en lo arquitectonico: hexagonal impecable (dominio puro, puertos/adaptadores, wiring por factory con tokens Symbol), multi-tenancy correcta (tenant del JWT + SET LOCAL RLS + where tenantId,activo + filtro defensivo), lectura pura garantizada (cero mutaciones), SDK generado no editado a mano, feature frontend bien estructurada por dominio con barrel y responsive verificado en 3 viewports. TDD respetado (RED previo, 19/19 verde, suite global sin regresiones).

Existe un hallazgo de severidad Alta (H1, con H2 derivado): la nulabilidad de DashboardItem.fechaEvento diverge entre el contrato OpenAPI (obligatorio, no-nullable — fuente del SDK) y el DTO/dominio/use-case (string | null, emitible como null en el widget pipeline). Rompe la coherencia contrato-DTO (checklist 9) y puede producir Invalid Date en la UI para reservas sin fecha. No es Bloqueante (no viola un invariante arquitectonico duro, el happy path funciona y la correccion es localizada), pero debe alinearse antes de considerar el endpoint estable: unificar la nulabilidad en las tres capas (spec + regenerar SDK, o garantizar no-null en el use-case) y anadir un caso QA con reserva de pipeline sin fecha.

Veredicto: NO APTO

Bloqueantes: ninguno.
Motivo del NO APTO: hallazgo de severidad Alta H1 (divergencia contrato OpenAPI vs DTO/dominio en la nulabilidad de DashboardItem.fechaEvento, con riesgo de Invalid Date en el front, H2). Debe resolverse y re-revisarse antes del gate final.
