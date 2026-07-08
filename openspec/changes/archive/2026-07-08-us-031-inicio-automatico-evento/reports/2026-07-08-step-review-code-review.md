# Code review — us-031-inicio-automatico-evento (step-review)

- **Fecha**: 2026-07-08
- **Revisor**: code-reviewer (solo lectura; no aplica fixes)
- **Alcance**: diff de la feature `feature/us-031-inicio-automatico-evento` (working tree + untracked; `git diff master...HEAD` vacio: el trabajo esta sin commitear) contra `master`. Skills: `review-checklist`, `architecture-guardrails`.
- **Estado verificado por el revisor**: 6 suites / 54 tests US-031 en VERDE (`jest` ejecutado); `eslint` de los 8 ficheros nuevos/modificados en VERDE (exit 0).

## Ficheros revisados
- Dominio: `apps/api/src/reservas/domain/maquina-estados.ts` (MAPA_INICIO_EVENTO, resolverInicioEvento, preconditionesEventoCumplidas, tipos *StatusDominio).
- Aplicacion: `apps/api/src/reservas/application/iniciar-eventos-del-dia.service.ts`.
- Infra: `candidatas-inicio-evento.prisma.adapter.ts`, `inicio-evento-uow.prisma.adapter.ts`, `alerta-inicio-evento.adapter.ts`.
- Interface: `barrido-eventos.controller.ts`, `barrido-eventos.dto.ts`, `barrido-eventos.scheduler.ts`.
- Wiring: `reservas.module.ts`, `reservas.tokens.ts`.
- Contrato: `docs/api-spec.yml` + cliente generado `apps/web/src/api-client/schema.d.ts`.
- Tests: 6 specs bajo `apps/api/src/reservas/__tests__/` (dominio x2, use-case, integracion, concurrencia, controller).
## Hallazgos por severidad

### Bloqueante
- Ninguno.

### Mayor
- Ninguno.

### Menor
- [nit-doc] `reservas.module.ts:1-6`: la cabecera del modulo sigue diciendo "Modulo reservas (US-040 + US-041 ...)"; ya acumula US-003..US-049 y ahora US-031. No es regla dura (deuda de comentario pre-existente, no introducida por US-031). No afecta al veredicto.

### Nit
- [nit-comentario] `barrido-eventos.controller.spec.ts:41`: comentario residual que cita "shape del schema BarridoEventosResumen" (nombre de la Opcion A descartada). El codigo del test NO usa ese nombre: la asercion compara contra { candidatas, eventosIniciados, precondicionesIncumplidas, fallos } (shape real BarridoEventosResponse, Opcion B). Solo texto de comentario; no hay simbolo colgante.
- [nit-comentario] `iniciar-eventos-del-dia.service.ts:69`: la interfaz de resultado del use-case se llama ResultadoInicioEvento, homonima del tipo de dominio ResultadoInicioEvento en maquina-estados.ts. Viven en modulos distintos y no colisionan. Sin impacto funcional.
## Verificacion de guardrails duros

- Hexagonal / DDD: OK. maquina-estados.ts dominio puro (sin @nestjs, @prisma ni infrastructure/). Guarda de origen como TABLA DECLARATIVA (MAPA_INICIO_EVENTO + resolverInicioEvento); tres precondiciones como estructura declarativa (PRECONDICIONES_INICIO_EVENTO + preconditionesEventoCumplidas). Sin if dispersos. Puertos en aplicacion, adaptadores en infra, wiring por token Symbol. Use-case depende solo de puertos.
- Bloqueo / serializacion: OK. Transicion por RESERVA atomica en un unico prisma.transaction con SELECT ... FOR UPDATE sobre la fila reserva y re-evaluacion de la guarda bajo el lock. Exclusion mutua en PostgreSQL; sin Redis/Redlock/lock distribuido (hook no-distributed-lock). US-031 NO toca FECHA_BLOQUEADA ni la cola.
- Idempotencia: OK. Seleccion estricta estado=reserva_confirmada; bajo lock resolverInicioEvento devuelve null si el estado cambio -> no-op sin auditar. Integracion 3.8: N ejecuciones = 1 transicion y 1 AUDIT_LOG.
- Concurrencia cron<->gestor (US-032): OK. Concurrencia spec cubre RC-1 (dos barridos con Promise.allSettled -> 1 transicion, 1 auditoria) y RC-2 (barrido vs segundo actor simulado sobre la misma UoW/guarda -> exactamente una gana, la otra 0 filas, sin doble auditoria ni estado intermedio). Contra Postgres aislado slotify_test.
- Multi-tenancy / RLS: OK. Lectura de candidatas cross-tenant legitima (Sistema, sin SET LOCAL); cada mutacion fija fijarTenant(tx, candidata.tenantId) como PRIMERA operacion (SET LOCAL app.tenant_id via set_config true). tenant_id de la fila, nunca de input externo; SELECT FOR UPDATE y UPDATE filtran por tenant/id. Test D-5 confirma no cruce de tenant.
- Seleccion por fecha de calendario: OK. Adaptador compara fecha_evento = CURRENT_DATE (columna Date), sin depender de formatearFechaHora ni string. Test 3.7 blinda el borde del dia (23:00 UTC candidato).
- AUDIT_LOG origen Sistema: OK. accion=transicion, entidad=RESERVA, usuarioId=null, datosAnteriores={estado:reserva_confirmada}, datosNuevos={estado:evento_en_curso, causa:T-0}. 1 entrada por inicio efectivo.
- Async-jobs: OK. @nestjs/schedule cron diario configurable (default 00:00) registrado dinamicamente via SchedulerRegistry; el scheduler solo dispara el endpoint HTTP protegido. Sin CRON_TOKEN el disparo automatico se desactiva con log. Sin Lambda/EventBridge ni timers exactos.
- Alertas: OK. Critica cuando faltan precondiciones (sin transicionar; remite a US-032); A29 no bloqueante cuando cond_part_firmadas=false, con INDEPENDENCIA del resultado (tests 3.5). Adaptador desacoplado de notificaciones (US-044), registro trazable por log.
- Contrato / cliente generado: OK. POST /cron/barrido-eventos con security cronToken, 200 -> BarridoEventosResponse directo {candidatas, eventosIniciados, precondicionesIncumplidas, fallos}, 401 Unauthorized. DTO coincide con schema. schema.d.ts regenerado, NO editado a mano. Sin superficie de usuario nueva.
- NO rastro de la Opcion A: OK. No existe BarridoEventosResumen en contrato ni codigo. BarridoResponse referencia SOLO BarridoFichasResumen (US-026 intacto). El enum "eventos" de tarea en POST /cron/barrido es PRE-EXISTENTE y no cuelga de subobjeto de US-031. Edicion del controller spec por el orquestador legitima: solo alinea ruta y shape a Opcion B; no enmascara comportamiento (guard real + aserciones 200/401).
- Convenciones: OK. Arrow functions (metodos de clase NestJS exentos). Nombres/comentarios/mensajes en espanol. US-031 no maneja importes monetarios (no aplica Decimal/Float).
- Alcance: OK. No implementa forzado manual (US-032), vista movil/checklist (US-033/034), briefing, A9 ni email. Solo deja la RESERVA en evento_en_curso.

## Tests primero (TDD)
- OK. 6 specs (dominio x2, use-case, integracion, concurrencia, controller) con trazabilidad a US/spec-delta/design. Ejecutados por el revisor: 54/54 verde. Concurrencia con Promise.allSettled contra BD real.

## Veredicto: APTO

No hay hallazgos bloqueantes ni mayores. Los menores/nit son de comentarios/naming y no exigen cambios para el merge. Apto para el gate humano final.

### Para el humano antes del gate final
- El trabajo esta SIN COMMITEAR (working tree + untracked). Recordar git add/commit antes de archivar/abrir PR.
- La resolucion de gate D-2 -> Opcion B (endpoint dedicado, evita colision de ruta con el barrido de fichas US-026 ya mergeado) es correcta y deja intacto US-026. Confirmado sin rastro de la Opcion A.
- Sugerencia opcional (no bloqueante): limpiar el comentario residual BarridoEventosResumen en barrido-eventos.controller.spec.ts:41 y actualizar la cabecera de reservas.module.ts.
