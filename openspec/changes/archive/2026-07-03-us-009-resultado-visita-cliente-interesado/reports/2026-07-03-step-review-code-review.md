# Step review - Code review (obligatorio)
**Change:** us-009-resultado-visita-cliente-interesado
**Fecha:** 2026-07-03
**Agente:** code-reviewer
**Alcance:** diff de la feature (working tree) vs master. Transicion atomica 2.v a 2.b cliente interesado (UC-08). Backend apps/api/src/reservas, frontend apps/web/src/features/reservas, contrato docs/api-spec.yml y SDK.

## Resumen ejecutivo

Revision de solo lectura contra review-checklist y architecture-guardrails. La implementacion respeta todas las reglas duras: hexagonal, bloqueo atomico por SELECT FOR UPDATE sin locks distribuidos, RLS con fijarTenant, maquina de estados declarativa mono-estado, E7 post-commit tolerante, TTL fresco leido de TENANT_SETTINGS, contrato coherente con el DTO, SDK generado no editado a mano, y frontend mobile-first con evidencia en 3 viewports. QA en verde (49 dirigidos, 823 API, 49 web; 9 curl; 8 Playwright).

Se detecta una observacion menor (divergencia de enum descarta vs descarte en un tipo interno) sin impacto funcional. No hay bloqueantes.

## Checklist por regla

### Hexagonal - OK
- domain/maquina-estados.ts: dominio puro. Sin imports de nestjs, prisma ni infrastructure. La guarda esOrigenValidoParaResultadoVisitaInteresado y su tabla ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO son estructuras de datos y funcion pura.
- application/registrar-resultado-visita.use-case.ts: depende SOLO de puertos inyectados; no importa Prisma ni NestJS. Puertos en dominio/aplicacion; adaptadores Prisma en infrastructure.
- Los dos adaptadores (uow.prisma y confirmacion-resultado-visita-email) implementan los puertos e importan Prisma/NestJS legitimamente.
- Arch check depcruise (report N+1): no dependency violations found (271 modules).

### Bloqueo atomico de fecha - OK
- UNA sola transaccion envuelve las TRES mutaciones (UPDATE RESERVA a 2b + visita_realizada + TTL; UPDATE PURO de FECHA_BLOQUEADA; AUDIT_LOG transicion): all-or-nothing.
- Serializacion por SELECT FOR UPDATE en leerBloqueoVigente (queryRaw). Re-lectura de la RESERVA y re-evaluacion de la guarda BAJO el lock: el segundo registro observa 2b y cae en 422.
- FECHA_BLOQUEADA se muta con updateMany (UPDATE PURO): nunca INSERT ni DELETE; tipoBloqueo permanece blando. Confirmado por el test de concurrencia (1 fila, TTL igual al de la RESERVA) y por curl/E2E.
- Sin Redis, Redlock ni locks distribuidos. La exclusion mutua vive solo en PostgreSQL.
- Test de concurrencia REAL con Promise.allSettled: dos registros simultaneos -> 1 aplica; carrera con barrido A21/US-012 -> commit-first sin estado intermedio.

### TTL fresco - OK
- ttlFresco = now + ttlConsultaDias, con ttlConsultaDias leido de TENANT_SETTINGS via resolverTtlConsultaDias (422 si no configurado; nunca hardcodeado).
- No acumula sobre el TTL previo ni deriva de visitaProgramadaFecha. Verificado en curl (now + 3 dias) y E2E.

### Multi-tenancy / RLS - OK
- fijarTenant es la PRIMERA operacion de la transaccion en la UoW y en el adaptador de email E7.
- tenantId y usuarioId derivan del JWT (CurrentUser), nunca del path/body.
- Queries filtran por tenantId; cross-tenant -> null -> 404.

### Maquina de estados - OK
- Guarda declarativa mono-estado consulta/2v en tabla, coherente con el resto de transiciones. Sin if/else dispersos.
- Terminales/inmutables y resto de sub-estados quedan fuera de la tabla -> 422. Cubierto por maquina-estados-resultado-visita.spec.ts.

### E7 post-commit - OK
- Se dispara FUERA de la transaccion tras el COMMIT, en enviarConfirmacionTolerante con try/catch que NO propaga: un fallo de email no revierte la transicion.
- Reutiliza el motor real de US-045 (DespacharEmailService); registra COMUNICACION E7 (enviado/fallido). Idempotencia por UNIQUE (reserva_id, codigo_email). Verificado en curl/E2E.

### Contrato + SDK - OK
- api-spec.yml: ResultadoVisitaRequest con required resultado, additionalProperties false, enum ResultadoVisita [interesado, reserva_inmediata, descarta]; respuestas 200/400/401/403/404/422.
- DTO NestJS coincide con el contrato: mismo enum descarta, validado con class-validator (IsString, IsIn), mensajes en espanol.
- SDK schema.d.ts regenerado desde el contrato; el diff es puro output de generacion: NO editado a mano.

### Frontend (reglas duras) - OK
- Arrow functions en todo el codigo nuevo; sin function declarativo (grep sin coincidencias).
- Bulletproof React: hook en api, dialog en components, aviso co-localizado en la pagina, tipos en model, exportado por el barrel index.ts. Consumo de features por barrel.
- max-lines <= 300 en todos los ficheros de apps/web (Dialog 236, FichaConsultaPage 266).
- Consumo del SDK sin tipos inventados.
- Mobile-first: dialog shadcn/Radix responsive; evidencia QA 390/768/1280 sin overflow.

### TDD / tests - OK
- Tests hermanos presentes y verdes: guarda pura, use-case, integracion, concurrencia real, atomicidad, TTL fresco, E7. Suite completa 823 API + 49 web PASS.

### Convenciones - OK
- Nombres en espanol; errores, mensajes y comentarios en espanol.

## Hallazgo evaluado explicitamente: divergencia de enum descarta vs descarte

Descripcion. El contrato OpenAPI y el DTO NestJS usan descarta (sin e). El tipo de dominio del use-case ResultadoVisita (interesado, reserva_inmediata, descarte) usa descarte. El controller castea dto.resultado as ResultadoVisita: un cast tecnicamente no sano, porque descarta no pertenece a ResultadoVisita.

Decision: OBSERVACION MENOR (deuda tecnica), NO bloqueante. Argumentacion:
1. La regla del checklist se cumple: Contrato OpenAPI coincide con los DTOs. Contrato y DTO estan alineados en descarta. La divergencia es interna (tipo de dominio), no en la frontera del contrato.
2. Sin impacto funcional: el use-case solo evalua resultado distinto de interesado para rechazar con 422. Cualquier valor distinto de interesado (incluido descarta) se rechaza igual. QA confirma: body descarta -> 422; body descarte -> 400 (fuera del enum del contrato). Ambos rechazos son correctos y seguros.
3. descarta y reserva_inmediata son valores futuros (US-010/US-011) hoy inertes: no ejecutan logica que dependa del literal, solo pasan la guarda de rechazo.
4. Riesgo latente acotado: al implementar US-011 (descarte) el literal debera unificarse ANTES de ramificar por el, o la comparacion fallara silenciosamente. Es una trampa para el implementador futuro, no un defecto activo.

Recomendacion (no bloqueante): alinear el literal del tipo de dominio ResultadoVisita a descarta, o introducir un mapeo explicito DTO a dominio, para eliminar el cast no sano y prevenir el riesgo latente en US-010/US-011. Registrar como deuda tecnica del change de US-011.

## Bloqueantes
Ninguno.

## Observaciones menores
1. [tipos] Divergencia de enum descarta (contrato/DTO) vs descarte (tipo de dominio ResultadoVisita en application/registrar-resultado-visita.use-case.ts:52); cast no sano en interface/registrar-resultado-visita.controller.ts:82. Sin impacto funcional en US-009. Alinear a descarta como deuda para US-010/US-011.

## Veredicto: APTO
