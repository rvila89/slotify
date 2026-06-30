# Step Review - Code Review (gate duro)
## Change: 2026-06-30-us-008-programar-visita-espacio (US-008 - Programar visita al espacio a 2.v)
## Fecha: 2026-06-30
## Agente: code-reviewer
## Branch: feature/us-008-programar-visita-espacio (cambios en working tree, aun sin commit)

## Alcance revisado

Diff completo de US-008 contra master (working tree: modificados + untracked). Backend, contrato
OpenAPI + SDK generado, frontend (features/reservas), spec-deltas (consultas, comunicaciones),
reports step-6/7/8. Verificaciones: tsc API y web limpios; eslint backend (7) y frontend (6) sin
errores; max-lines frontend OK (Dialog 251, FichaConsultaPage 185, AccionesConsulta 147, hook 97);
sin function declarativa, sin any en ficheros nuevos.

## Hallazgos por categoria de guardrail

Hexagonal (DURO) - CONFORME. Los dos ficheros de domain (maquina-estados, bloquear-fecha.service)
no importan nestjs/prisma/infrastructure; ttlVisitaMasUnDia y esOrigenValidoParaProgramarVisita son
puras. El use-case depende solo de puertos; adaptadores en infra implementan las interfaces.

Bloqueo atomico (DURO) - CONFORME. Serializacion solo en PostgreSQL: SELECT FOR UPDATE sobre la
fila bloqueante (queryRaw) mas UNIQUE(tenant_id,fecha) en el INSERT 2a. Sin Redis/Redlock. P2002 se
propaga y revierte. TTL visita+1dia 23:59:59 como funcion pura del dominio (D-2).

Atomicidad (DURO) - CONFORME. UPDATE RESERVA + upsert FECHA_BLOQUEADA + AUDIT_LOG en una unica
transaccion; fijarTenant primera operacion (RLS). E6 post-commit tolerante (D-6): un fallo de email
no revierte la transicion (tests 3.8).

insert-o-update por origen (D-2) - CONFORME. accion derivada de la re-lectura bajo lock: update
(updateMany) para 2b/2c, insert (create) para 2a; tipo blando; apoyada en lock + UNIQUE.

Maquina de estados (DURO) - CONFORME. Guarda declarativa con {2a,2b,2c} + helper, patron US-005/007,
sin if dispersos. 2d a 409 (UC-12) antes de la guarda generica; no-origen/terminal a 422; 2a sin
fecha_evento a 422.

Concurrencia A4 (D-9) - CONFORME. Re-lectura de la RESERVA bajo el lock y re-evaluacion de las tres
guardas; una segunda transicion observa 2v y cae en la guarda (422). 5 tests reales PASS.

Multi-tenancy / RLS (DURO) - CONFORME. tenantId/usuarioId del JWT, nunca del path/body. buscarPorId
filtra idReserva+tenantId; cross-tenant a 404. Todo bajo fijarTenant. Sin fuga cross-tenant.

Tipos y datos - CONFORME. Sin any; arrow functions; DTO validado con class-validator (formato a 400,
dominio a 422); importes sin alterar tipo (no Float).

Contrato / SDK (DURO) - CONFORME. POST /reservas/{id}/visita con body fecha+hora,
additionalProperties false, 200/400/401/403/404/409/422 + ProgramarVisitaConflictoError. El rename
visitaFecha/visitaHora a fecha/hora esta alineado en DTO, SDK (schema.d.ts) y hook. SDK regenerado,
sin edicion manual.

Frontend Bulletproof / responsive - CONFORME (salvedad de evidencia, ver E2E). Feature + barrel,
max-lines OK, boundaries en verde, mobile-first sin anchos px fijos, accion deshabilitada en
2d/terminales/2a-sin-fecha. Salvedad: 3 viewports (390/768/1280) no ejecutados en navegador.

## Juicio sobre la modificacion del spec preexistente de US-040
(apps/api/src/reservas/__tests__/bloquear-fecha.service.spec.ts)

CORRECTA Y JUSTIFICADA - NO enmascara regresion. Sustituye addDays(visita,1) (medianoche de
visita+1dia) por ttlVisitaMasUnDia(visita) (visita+1dia 23:59:59 UTC) en DOS aserciones del TTL de
la fase 2.v. Es una alineacion intencionada exigida por US-008 (regla: ttl = visita + 1 dia
23:59:59, fin del dia posterior); el valor anterior dejaba el bloqueo activo ~24h menos de lo
requerido. Solo se tocan las aserciones de la fase 2.v; el resto del mapa canonico (2.b, 2.c,
pre_reserva, etc.) queda intacto. La fase 2.v no estaba en uso productivo antes de US-008, asi que
el ajuste fija el contrato correcto, no parchea un fallo. El test sigue verde. Conclusion: tocar
ese spec preexistente esta justificado, es correcto y no es un parche para ocultar regresion.

## Juicio sobre el E2E Playwright no ejecutado (tasks 8)

RIESGO ACEPTABLE - A RESOLVER ANTES DE CERRAR EL GATE FINAL (no Bloqueante de code-review). El
report step-8 documenta que el MCP de Playwright no estaba registrado en la sesion; se hizo
verificacion estatica del frontend, no ejecucion en navegador en 3 viewports (regla dura).
Atenuantes: habilitacion/deshabilitacion, ventana del picker (min/max + Zod), mapeo de errores y
feedback verificados por codigo; persistencia UI-BD cubierta por los curl del step-7 (2b/2a/2c a
200, 2d a 409, ventana a 422, terminal a 422, cross-tenant a 404); layout mobile-first sin anchos
fijos. No se eleva a Bloqueante porque ningun guardrail de CODIGO esta violado; el hueco es de
EVIDENCIA de QA visual. La decision sobre la regla dura de responsive corresponde al Gate humano
final. Recomendacion: ejecutar el E2E (o validacion manual) en 390/768/1280 y marcar tasks 8.1-8.8
antes de archive/PR; sin esa evidencia el cierre asume explicitamente este riesgo.

## Bloqueantes

Ninguno.

## Hallazgos menores (no bloqueantes)
- (Baja) EnviarConfirmacionVisitaResultado devuelve estado enviado/fallido pero el use-case lo
  ignora (envio tolerante post-commit). Coherente con D-6; trazado real en COMUNICACION (US-045).
- (Baja) MAX_DIAS_PROGRAMAR_VISITA_DEFAULT = 7 hardcodeado en el frontend como tope del picker
  mientras el setting no se expone por API; documentado como espejo del default, el servidor
  revalida (422). Mejora futura: exponer el setting al cliente.

## Estado de QA (resumen)
- step-6 (unit + BD): 50/50 US-008 PASS; suite completa 417/418 (unico fallo: deadlock flaky
  pre-existente de US-004, ajeno y documentado). BD identica al baseline.
- step-7 (curl): escenarios HTTP verificados (200/409/422/404), persistencia y formato alineados.
- step-8 (E2E): PARCIAL - no ejecutado en navegador (sin MCP).

## Conclusion

Implementacion solida y fiel al diseno aprobado: hexagonal limpio, bloqueo atomico solo en
PostgreSQL, atomicidad RESERVA+FECHA_BLOQUEADA+AUDIT_LOG con E6 post-commit tolerante, guarda
declarativa multi-origen, RLS sin fugas, contrato y SDK alineados, frontend Bulletproof. La
modificacion del spec de US-040 es correcta y justificada. No hay Bloqueantes de code-review. El
unico punto abierto es la EVIDENCIA del E2E responsive en 3 viewports, trasladado como riesgo
aceptable a decidir en el Gate de revision humana final.

Veredicto: APTO
