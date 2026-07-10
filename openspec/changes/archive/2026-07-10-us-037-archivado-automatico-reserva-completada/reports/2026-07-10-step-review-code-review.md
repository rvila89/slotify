# Code-review US-037 archivado-automatico-reserva-completada

- Fecha: 2026-07-10
- Branch: feature/us-037-archivado-automatico-reserva-completada vs master
- Revisor: code-reviewer (solo lectura; no aplica fixes)
- Skills: review-checklist, architecture-guardrails

## Resumen
Change limpio y alineado con las decisiones del gate SDD (D-2=A, D-3+D-4=3.1+4.2, D-5=visibilidad). Cumple todos los guardrails duros (hexagonal, sin lock distribuido, endpoint dedicado, async-jobs, guarda declarativa, RLS/multi-tenancy, SQL con columnas reales). Sin Bloqueantes ni hallazgos de severidad Alta. Solo observaciones Media/Baja, todas deuda consciente ya documentada en design.md y comentarios.

## Checklist de guardrails

### Hexagonal - OK
- domain/maquina-estados.ts: cero imports (fichero puro). MAPA_ARCHIVADO_AUTOMATICO, resolverArchivadoAutomatico y fianzaResuelta son estructura de datos y funciones puras deterministas, sin @nestjs, @prisma ni infrastructure.
- application/archivar-reservas-completadas.service.ts: unico import es un import type de FianzaStatusDominio de dominio. Depende solo de puertos (CandidatasArchivadoPort, ArchivadoPort, AlertaFianzaPendientePort). El puerto RegistradorBarrido es interfaz local (no importa el Logger de Nest); el Logger real se inyecta desde reservas.module.ts via factory. No rompe hexagonal.

### Bloqueo / idempotencia sin lock distribuido - OK
- archivado-uow.prisma.adapter.ts: transaction + fijarTenant(tx, tenantId) como PRIMERA operacion (RLS) + SELECT ... FOR UPDATE sobre la fila RESERVA. Patron leer-verificar-actualizar: re-evalua resolverArchivadoAutomatico y fianzaResuelta bajo el lock; destino null implica no-op idempotente (FA-02 / RC-1). La UPDATE condicional deja 0 filas al segundo actor (RC-2 vs US-038). Sin Redis/Redlock/locks en memoria; serializacion delegada a PostgreSQL. Conforme al hook no-distributed-lock.

### Endpoint dedicado + guard - OK
- barrido-completadas.controller.ts: ruta propia POST /cron/barrido-completadas (NO reutiliza /cron/barrido ni dispatch por tarea). Public + UseGuards(CronTokenGuard) + HttpCode 200 + ApiTags Cron + ApiSecurity cronToken. Delega en useCase.ejecutar() y devuelve el resumen. Gemelo correcto de barrido-eventos/barrido-expiracion.

### Maquina de estados declarativa - OK
- Transicion como tabla MAPA_ARCHIVADO_AUTOMATICO (post_evento/null hacia reserva_completada/null); reserva_completada sin arista de salida (terminal). Guarda de fianza como funcion pura. Sin if/else dispersos.

### Multi-tenancy / RLS - OK
- Lectura de candidatas cross-tenant deliberada y documentada (proceso de Sistema, rol tecnico, D-8); tenant_id viaja en cada fila.
- Toda escritura (UoW de transicion y alerta) fija fijarTenant(tx, tenantId) como primera operacion, con el tenant tomado de la fila candidata, nunca de input externo. La lectura de anti-duplicacion en alerta-fianza-pendiente.prisma.adapter.ts tambien corre bajo fijarTenant (correcto: audit_log tiene RLS activo).

### SQL crudo con columnas reales (@map) - OK
- reserva: id_reserva, tenant_id, fecha_post_evento, fianza_status, fianza_eur, estado, sub_estado coinciden con el @map del schema.
- audit_log: entidad_id, datos_nuevos, fecha_creacion. El bug previo (usar la columna fecha en vez de fecha_creacion) quedo corregido: SELECT fecha_creacion AS fecha y ORDER BY fecha_creacion DESC. Verificado contra schema.prisma lineas 585-602.

### Jobs asincronos - OK
- Scheduler @nestjs/schedule diario (env CRON_BARRIDO_COMPLETADAS o default 03:00 diario) que solo dispara el endpoint HTTP con X-Cron-Token; sin CRON_TOKEN se auto-desactiva con warning. Estado en fila + barrido idempotente. Sin Lambda/EventBridge ni timers exactos.

### Migracion - OK
- Aditiva no destructiva: ADD COLUMN fecha_post_evento nullable, sin default. Indice [estado, fecha_post_evento] cross-tenant. Backfill idempotente desde AUDIT_LOG (solo toca estado post_evento AND fecha_post_evento IS NULL, re-ejecutable), con timestamps reales (no strings). US-034 puebla el campo en la misma UPDATE que fija estado post_evento (finalizar-evento-uow.prisma.adapter.ts + finalizar-evento.use-case.ts con new Date()).

### Filtro por fecha de calendario - OK
- candidatas-archivado.prisma.adapter.ts: date(fecha_post_evento) menor-o-igual (CURRENT_DATE - INTERVAL 7 days). Fecha de calendario via operadores nativos de PostgreSQL, sin string formateado; blindaje del off-by-one de TZ conocido. fecha_post_evento IS NULL excluida por construccion.

### Tipos / importes - OK
- fianza_eur se lee como Prisma.Decimal o null y se convierte a number solo en la guarda de dominio pura (comparacion menor-o-igual 0), sin persistir Float. No hay any injustificado. DTO de respuesta con ApiProperty (minimum 0); endpoint sin payload de entrada.

### Contrato OpenAPI + SDK - OK
- docs/api-spec.yml: POST /cron/barrido-completadas (operationId barridoCompletadas, security cronToken, 200 BarridoCompletadasResponse con candidatas/archivadas/fianzaPendiente/fallos todos required minimum 0, 401 Unauthorized). Coincide 1:1 con BarridoCompletadasResponseDto.
- apps/web/src/api-client/schema.d.ts: diff puramente aditivo (104 inserciones, 0 borrados), consistente con regeneracion del SDK (no edicion a mano). Sin superficie de usuario nueva.

### Convenciones - OK
- Nombres en espanol (PascalCase clases, camelCase funciones, kebab-case ficheros). Comentarios y mensajes de error en espanol. Arrow functions para helpers; metodos de clase Nest exentos.

### Responsive / frontend - N/A
- US-037 es actor Sistema (cron backend). Sin UI. Exencion justificada en tasks seccion 9.

## Hallazgos

### Bloqueantes
- Ninguno.

### Alta
- Ninguno.

### Media
- [alerta FA-01, semantica de accion] alerta-fianza-pendiente.prisma.adapter.ts:115 usa accion=actualizar porque el enum AccionAudit no tiene valor alerta; el discriminante real viaja en datos_nuevos.tipo=fianza_pendiente_t7d. Aceptable como deuda consciente (documentada en el adaptador y en design D-3), evita migracion de enum y es coherente con como US-036/US-030 auditan cambios de fianza. Recomendacion: registrar como deuda para un futuro valor de enum dedicado si crece el uso de alertas de Sistema. No bloquea.
- [anti-duplicacion por heuristica de tokens] alerta-fianza-pendiente.prisma.adapter.ts:48-59: referenciaFianza/esAlertaFa01 deciden ultimo cambio de fianza y es alerta por JSON.stringify + includes sobre datos_nuevos. Robusto para los escritores actuales pero acopla la anti-duplicacion al formato textual del log (un futuro campo que contenga la subcadena fianza_eur daria falso positivo y suprimiria una alerta legitima; snake y camel ambos cubiertos hoy). Deuda ya declarada en design D-4. Recomendacion: si se anade el enum alerta o un campo estructurado, sustituir la heuristica por filtro por columna/tipo. No bloquea (D-4=4.2 fue la opcion aprobada, sin migracion).

### Baja
- [observabilidad del scheduler] barrido-completadas.scheduler.ts hace fetch al endpoint interno via localhost y API_PORT. Identico al patron de US-012/US-031 y coherente con el diseno (endpoint testeable por HTTP). Sin accion.
- [logger por defecto console] El puerto RegistradorBarrido cae a console si no se inyecta; en produccion se inyecta el Logger de Nest desde el modulo. Correcto y deliberado (evita un catch ciego que oculto un bug de RLS previo). Sin accion.

## Verificacion (reportada por la sesion principal; no reejecutada aqui)
- Unit: 55/55 verde.
- Integracion + concurrencia contra slotify_test: 19/19 verde.
- lint / tsc / depcruise: verdes.
- Unico fallo de la suite global = flaky pre-existente de US-004 (deadlock 40P01), ajeno a US-037 (no regresion).

## Conclusion
El change respeta todos los guardrails duros (hexagonal, sin lock distribuido, endpoint dedicado, async-jobs, guarda declarativa, RLS, SQL con columnas reales, migracion no destructiva, filtro por fecha de calendario, contrato + SDK) y las decisiones del gate. Las dos observaciones de severidad Media son deuda consciente ya documentada en design.md y no comprometen correccion ni seguridad. No hay Bloqueantes.

Veredicto: APTO
