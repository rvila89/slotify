# Code Review (RE-REVISION post-fixes) - US-019 Promocion Manual de Consulta en Cola (2026-07-03)

Rama: feature/us-019-promocion-manual-cola (comparada contra master; trabajo en arbol de trabajo).
Revisor: code-reviewer (solo lectura, contra review-checklist + architecture-guardrails).
Antecedente: informe previo 2026-07-03-step-review-code-review.md dio NO APTO por H-1.
Esta re-revision verifica los dos fixes aprobados (Fix 1 - H-1 404 vs 422; Fix 2 - 403 rol Gestor).

## 1. Fix 1 - H-1 (404 vs 422) - RESUELTO

- Nuevo error de dominio PromocionManualReservaNoEncontradaError en
  application/promover-manual-en-cola.service.ts L106-113: clase INDEPENDIENTE, NO subclase de
  PromocionManualConsultaNoEnColaError (documentado L99-105). Las jerarquias no colapsan y el
  controller mapea a codigos separados sin ambiguedad.
- Adapter (promocion-manual-cola-uow.prisma.adapter.ts): lanza el nuevo error cuando la RESERVA no es
  resoluble bajo RLS (inexistente o de otro tenant, L120-122) y tambien cuando existe pero sin
  fecha_evento (L124-128). Reserva PromocionManualConsultaNoEnColaError (a 422) SOLO para FA-05
  existe-pero-ya-no-en-2.d (terminal / bloqueante L175-177; anomalia de plan L212).
- Controller (promover-manual.controller.ts L94-100): mapea el nuevo error a NotFoundException (404)
  ANTES del bloque 422; el 422 queda solo para confirmacion ausente + FA-05 (L101-110).
- Sin fuga de datos: la reserva ajena queda oculta por RLS y se responde 404 con mensaje generico
  (La reserva indicada no existe); no distingue no-existe de otro-tenant. Correcto.
- Contrato e implementacion ahora coinciden: docs/api-spec.yml op promoverConsultaCola declara 404,
  403, 401, 409 (carrera + sin bloqueo) y 422 (confirmacion + FA-05); los componentes
  Forbidden/NotFound/Unauthorized existen (L1519/1524/1539). El SDK schema.d.ts esta REGENERADO
  (contiene 403 Forbidden, 404 NotFound, PromoverManualRequest, promoverConsultaCola), no editado a mano.
- Test HTTP anadido: debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls (spec L171-180)
  verifica 404; el 422 de FA-05 se mantiene cubierto (L153-164). La divergencia ya no queda sin test.

## 2. Fix 2 - 403 rol Gestor - RESUELTO y ENFORCE REAL

- Controller: UseGuards(RolesGuard) + Roles(gestor) a nivel de CLASE (L52-53). JwtAuthGuard es global
  via APP_GUARD (app.module.ts L52-53); la cadena es autenticacion (401), autorizacion por rol (403),
  handler.
- RolesGuard (shared/auth/roles.guard.ts) lee la metadata Roles con getAllAndOverride y lanza
  ForbiddenException (403) si el rol del JWT no esta entre los requeridos. El guard corta ANTES del
  handler: el caso de uso NO se ejecuta.
- Tests HTTP (bloque L216-243): 403 para autenticado sin rol Gestor con expect(ultimoComando) toBeNull
  (prueba que el servicio NO se invoco), y 200 para Gestor valido (happy path intacto). Verde.
- Coherente con el contrato (403 Forbidden declarado y descrito en la op).

## 3. Guardrails DUROS - sin regresion

- Bloqueo atomico (atomic-date-lock / no-distributed-lock): OK, INTACTO. SELECT FROM fecha_bloqueada
  WHERE tenant_id y fecha ::date FOR UPDATE (uow L137-142) en una unica transaccion; re-asigna la MISMA
  fila (UPDATE L267-274) manteniendo una fila activa por (tenant,fecha). Sin Redis/Redlock ni locks
  distribuidos/en memoria. Los fixes no tocan esta ruta.
- Hexagonal/DDD: OK. depcruise arch da 0 violaciones (245 modulos, 818 deps). El nuevo error vive en
  application/; el dominio (promocion-manual-cola.ts, delta de maquina-estados.ts) sigue puro (sin
  nestjs, Prisma ni infrastructure; verificado por grep, solo apariciones en comentarios).
- Maquina de estados declarativa: OK. La expiracion forzosa se modela como tabla
  MAPA_EXPIRACION_FORZOSA_BLOQUEANTE + resolverExpiracionForzosaBloqueante() puro (maquina-estados.ts
  L462+). Sin if/else dispersos. El fix H-1 NO introdujo condicionales de estado en el adapter.
- Multi-tenancy / RLS: OK. tenantId/usuarioId del JWT (controller L73-77, D-7), nunca del path/body.
  fijarTenant (SET LOCAL app.tenant_id) es la primera op de la TX (uow L106). Toda query filtra
  tenant_id. El 404 se apoya en la invisibilidad RLS.
- Tipos y datos: OK. tsc limpio; sin any injustificado en los ficheros del fix; ttlExpiracion como
  timestamptz. DTO validado (patron Allow() justificado, sin cambios).
- Contrato / SDK: OK (era la causa del NO APTO; ahora alineado y testeado). Cliente generado no editado a mano.
- Frontend / responsive: sin cambios en los fixes (backend puro). E2E previo (report N+3) verifico
  390/768/1280. Sin regresion introducida.
- Tests primero / TDD: OK. Suites no-BD US-019 verdes (52/52, incluye el nuevo 404 y los 403). lint +
  tsc + arch a 0. Suites de concurrencia/integracion con Postgres real presentes. Estado reportado por
  el implementador: suite US-019 50/50, completa 713/714 (unico rojo = flaky pre-existente US-004
  deadlock 40P01, ajeno a US-019).

## 4. Estado de los hallazgos previos

- H-1 (404 vs 422) - MAYOR: RESUELTO (seccion 1). Contrato, implementacion y SDK coinciden; test HTTP
  404 anadido. Ya no bloquea.
- 403 rol Gestor no enforce (antes MENOR / baseline): RESUELTO (seccion 2). El endpoint aplica
  RolesGuard + Roles(gestor); enforce real verificado por test.
- H-2 - copy del 409 para reserva ya en 2b sin carrera real - MENOR: DEUDA ACEPTADA. El 409 es
  conservador y seguro (efecto: recargar vista); el codigo esta declarado en el contrato. No bloquea.
  Recomendacion futura: matizar el mensaje. Sin cambios en este PR (esperado).
- Fixtures de test en seed.ts - MENOR: DEUDA ACEPTADA. Confirmado en el diff (seed.ts L139+): 2
  Gestores a1/a2 + tenant control c9, upsert idempotente, delimitado y comentado, BD de tests aislada
  (slotify_test). No ideal (mejor seed.test.ts) pero impacto nulo. Recomendacion futura: extraer en un
  change de limpieza. Sin cambios en este PR (esperado).

## 5. Hallazgos NUEVOS introducidos por los fixes

Ninguno bloqueante. Observaciones menores (no bloquean, no requieren accion en este PR):

- RolesGuard compara usuario.rol con el literal gestor; el rol viaja en el JWT. Coherente con el resto
  del proyecto y con el test (rol cliente da 403, gestor da 200). No hay endpoint hermano con criterio
  distinto ni inconsistencia transversal. El gap transversal de autorizacion por rol en OTROS
  controllers sigue siendo pre-existente y ajeno a US-019.
- En el test HTTP el RolesGuard se registra explicitamente en el modulo de test (spec L97-99) porque se
  instancia sin el DI global; en produccion se resuelve via UseGuards. Correcto, es artefacto de test.

## Veredicto

Veredicto: APTO

Motivo: H-1 (unica causa del NO APTO previo) queda RESUELTO - 404 para reserva no resoluble bajo RLS,
422 preservado solo para FA-05, sin fuga de datos, contrato/implementacion/SDK alineados y con test HTTP
404. El 403 por rol Gestor se ENFORCE de verdad (RolesGuard + Roles a nivel de clase, JwtAuthGuard
global; el servicio no se ejecuta sin rol) y es coherente con el contrato. Sin regresion en los
guardrails duros (bloqueo atomico, hexagonal con arch 0 violaciones, maquina de estados declarativa,
RLS/tenant desde JWT). lint + tsc + arch limpios; suites no-BD US-019 verdes (52/52). Los hallazgos
menores restantes (H-2 copy del 409; fixtures en seed.ts) quedan como DEUDA DOCUMENTADA ACEPTABLE, no
bloqueante. Ningun hallazgo nuevo bloqueante introducido por los fixes.
