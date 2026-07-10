# Code-review US-038 archivado-manual-reserva-completada

- Fecha: 2026-07-10
- Branch: feature/us-038-archivado-manual-reserva-completada vs master
- Revisor: code-reviewer (solo lectura; no aplica fixes)
- Skills: review-checklist, architecture-guardrails
- Alcance: diff completo del change (backend + frontend + contrato + docs), working tree sobre merge-base b3c5e5e.

## Resumen
Change limpio y fiel a las decisiones del gate SDD (D-1=1.A anti-duplicacion, D-2=2.B UI en ficha, D-3=3.B 422 fianza / 409 origen invalido). Gemelo MANUAL de US-037 bien acotado: reutiliza las guardas puras de dominio sin crear aristas ni guardas nuevas, aporta una UoW propia delgada con SELECT ... FOR UPDATE sobre la fila RESERVA y AUDIT_LOG origen Gestor. Cumple TODOS los guardrails duros (hexagonal, sin lock distribuido, RLS/multi-tenancy, contrato + SDK generado, convenciones, responsive). lint backend y frontend en verde sobre los ficheros del change; ningun max-lines. Sin Bloqueantes ni hallazgos de severidad Alta. Solo observaciones Baja.

## Checklist de guardrails

### Hexagonal - OK
- application/archivar-reserva-manual.use-case.ts: fichero puro. Sus unicos imports son import type de dominio (maquina-estados: fianzaResuelta, resolverArchivadoAutomatico, tipos) y de puertos/tipos de aplicacion (AuditLogPort, ReservaDetalleLectura). Cero @nestjs, cero @prisma, cero infrastructure (grep confirmado sin coincidencias). El caso de uso orquesta solo puertos inyectados.
- D-1=1.A (regla dura anti-duplicacion) RESPETADA: domain/maquina-estados.ts NO esta modificado (git status del directorio domain vacio). No se crean guardas nuevas ni aristas: se IMPORTAN resolverArchivadoAutomatico (origen) y fianzaResuelta (fianza) de US-037. La UoW manual es propia y delgada, no refactoriza la de US-037.
- Adaptadores Prisma (uow / cargar) e interface (controller/dto) concentran @nestjs/@prisma, correcto por capa.

### Bloqueo atomico / concurrencia sin lock distribuido - OK
- archivar-reserva-manual-uow.prisma.adapter.ts: transaccion con fijarTenant(tx, tenantId) (= SET LOCAL app.tenant_id) como PRIMERA operacion (RLS del tenant del JWT), luego SELECT estado FROM reserva WHERE id_reserva y tenant_id FOR UPDATE sobre la propia fila RESERVA, seguido de UPDATE ... WHERE estado = estadoOrigen (updateMany condicional) que devuelve count. count=0 bajo el lock implica carrera perdida (doble clic / cron US-037), 409 sin auditar, aborta la tx. Exactamente una transicion gana. No toca FECHA_BLOQUEADA ni la cola.
- Sin Redis/Redlock/locks en memoria/timers: grep de ioredis, redlock, new Redis, createClient, setnx sin coincidencias. Serializacion delegada solo a PostgreSQL. Conforme al hook no-distributed-lock.
- Idempotencia y race cron-manual heredadas de US-037: la guarda de origen se re-evalua bajo el lock via la UPDATE condicional; una RESERVA ya reserva_completada da 409 estable.

### Maquina de estados declarativa - OK
- Sin if/else de transiciones dispersos: el origen lo resuelve resolverArchivadoAutomatico (tabla declarativa de US-037) y el destino sale de esa misma guarda. Origen invalido da TransicionNoPermitidaError (409). Fianza no resuelta da FianzaNoResueltaError (422). Coincide con D-3=3.B.

### Multi-tenancy / RLS - OK
- controller: tenantId = usuario.tenantId y usuarioId = usuario.sub SIEMPRE del JWT (@CurrentUser), NUNCA del path/body. El id del path es la RESERVA, no el tenant.
- cargar-reserva-archivado-manual.prisma.adapter.ts: fijarTenant(tx, comando.tenantId) primero y findFirst con where idReserva + tenantId; RESERVA de otro tenant invisible bajo RLS, null, 404 (ReservaNoEncontradaError). Toda escritura corre bajo fijarTenant en la UoW.
- Endpoint de USUARIO (JwtAuthGuard global + RolesGuard + Roles gestor): 401 sin token, 403 sin rol. NUNCA X-Cron-Token (no es el barrido de Sistema de US-037).

### AUDIT_LOG (origen Gestor) - OK
- Se audita SOLO tras filasAfectadas > 0, DENTRO de la tx (comparte rollback): accion=transicion, entidad=RESERVA, datosAnteriores estado post_evento, datosNuevos estado reserva_completada, con usuarioId del Gestor POBLADO (D-5, a diferencia de Sistema/nulo en US-037). Sin causa T+7d.
- NO se audita cuando se bloquea por fianza (422, lanza antes de la tx) ni cuando el origen es invalido (409, antes de la tx o con count=0 que aborta).
- RegistroAuditoriaArchivadoManual extiende el contrato RegistroAuditoria compartido; el puerto generico AuditLogPort lo acepta.

### Tipos / importes (Decimal, no Float) - OK
- fianzaEur se lee como Prisma.Decimal y se serializa a STRING (toString()); se convierte a number SOLO dentro de la guarda pura de dominio (comparacion menor-o-igual 0), nunca se persiste como Float. DTO expone importes como string (Importe, Decimal(10,2)). Sin any injustificado (grep limpio). TS strict.
- DTO de request vacio con whitelist + forbidNonWhitelisted (espejo de additionalProperties:false); respuesta de solo salida con ApiProperty/ApiPropertyOptional.

### Contrato OpenAPI + SDK generado - OK
- docs/api-spec.yml: POST /reservas/{id}/archivar (operationId archivarReservaManual), requestBody ArchivarReservaManualRequest (opcional/vacio), 200 Reserva, 401/403/404 por ref estandar, 409 FinalizarEventoConflictError (enum incluye transicion_no_permitida), 422 nuevo ArchivarFianzaNoResueltaError (allOf ErrorResponse + code enum fianza_no_resuelta). Coincide 1:1 con el DTO y con el mapeo de errores del controller (404/409/422).
- apps/web/src/api-client/schema.d.ts: cabecera auto-generated by openapi-typescript; diff puramente aditivo (path + archivarReservaManual + ArchivarReservaManualRequest + ArchivarFianzaNoResueltaError), consistente con regeneracion del SDK, NO edicion a mano. Conforme al hook protect-generated-client.

### Convenciones - OK
- Nombres en espanol (PascalCase clases, camelCase funciones, kebab-case ficheros). Comentarios y mensajes de error en espanol. Arrow functions en helpers/hooks/componentes; metodos de clase Nest exentos. lint backend y frontend en verde sobre los ficheros del change.
- Estructura Bulletproof React respetada: api/useArchivarReserva.ts, lib/archivarReserva.ts, components/ArchivarReservaDialog.tsx, sub-componente privado de pagina en pages/FichaConsulta/components/AccionArchivar.tsx, y barrel index.ts re-exporta la API publica. Sin importar internos de otra feature; boundaries en verde.
- max-lines (max 300, skipBlankLines+skipComments): ESLint no reporta violacion en ningun fichero, incluidos FichaConsultaPage.tsx y AccionesConsulta.tsx (el conteo crudo wc -l 320/340 no es el efectivo; el efectivo queda bajo 300, y la extraccion de AccionArchivar mantiene el contenedor por debajo). Verificado ejecutando eslint.

### Responsive / frontend - OK (evidencia aportada)
- ArchivarReservaDialog.tsx: Dialog shadcn/Radix mobile-first, max-h 90vh overflow-y-auto, pie que apila en columna en movil y pasa a fila en sm:, botones h-12/h-14 (objetivos tactiles mayores o iguales a 48px), sin anchos px fijos. AccionArchivar.tsx usa w-full sm:w-auto.
- Evidencia E2E Playwright en 3 viewports (390/768/1280) aportada en reports (9/9), no re-ejecutada aqui. Requisito de 3 viewports cubierto.

### Tests primero (TDD) - OK
- Presentes los specs hermanos: archivar-reserva-manual.guardas.spec.ts, .use-case.spec.ts, .controller.http.spec.ts, -integracion.spec.ts, -concurrencia.spec.ts, mas el test de UI ArchivarReserva.test.tsx. Cubren guardas, use-case, mapeo HTTP 401/200/409/422/404, integracion SQL real y concurrencia (race cron-manual / doble clic).

## Hallazgos

### Bloqueantes
- Ninguno.

### Alta
- Ninguno.

### Media
- Ninguno.

### Baja
- [estado UI no leido] FichaConsultaPage.tsx declara const [, setResultadoArchivar] = useState (solo se usa el setter; el resultado se comunica por toast y refetch, la reserva sale del pipeline). Deliberado y comentado; simetrico a otros resultados de la ficha. Recomendacion: si nunca se leera, podria eliminarse el estado y pasar un onArchivado no-op; mantenerlo deja hueco a un aviso inline futuro. Sin accion requerida.
- [best-effort de hidratacion] El use-case re-lee la RESERVA post-commit con cargarReservaDetalle y, si falla, cae a una proyeccion minima con campos vacios (aResponse con null). Intencional (no tumbar un archivado ya commiteado) y QA lo valida contra BD real con la RESERVA hidratada. Sin accion.

## Verificacion (reportada por la sesion principal; no re-ejecutada aqui)
- Backend: 40/40 unit del change + 46/46 sin regresion.
- Integracion + concurrencia contra Postgres real (slotify_test): 17/17.
- Frontend: 165/165.
- curl end-to-end: 5/5 (401/200/409/422/404) con AUDIT_LOG origen Gestor verificado.
- E2E Playwright: 9/9 en 3 viewports (390/768/1280).
- lint backend y frontend sobre los ficheros del change: verdes (re-ejecutado por el revisor).

## Conclusion
El change respeta todos los guardrails duros: hexagonal con dominio intacto (D-1=1.A: reutiliza guardas, no duplica), bloqueo atomico via SELECT ... FOR UPDATE sobre la fila RESERVA sin locks distribuidos, RLS/multi-tenancy con tenant y usuario del JWT (otro tenant, 404), AUDIT_LOG origen Gestor sin causa T+7d y sin auditar en 422/409, contrato OpenAPI coherente con el DTO (404/409/422) y SDK generado no editado a mano, convenciones (arrow functions, Bulletproof React + barrel, max-lines) y responsive con evidencia en 3 viewports. Las dos observaciones son de severidad Baja y no comprometen correccion ni seguridad. No hay Bloqueantes.

Veredicto: APTO
