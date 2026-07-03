# Code Review - US-019 Promocion Manual de Consulta en Cola (2026-07-03)

Rama: feature/us-019-promocion-manual-cola (comparada contra master; el trabajo esta en el arbol de trabajo, HEAD == master).
Revisor: code-reviewer (solo lectura, contra review-checklist + architecture-guardrails).

## Alcance revisado

Backend: domain/promocion-manual-cola.ts, domain/maquina-estados.ts (delta expiracion forzosa),
application/promover-manual-en-cola.service.ts, infrastructure/promocion-manual-cola-uow.prisma.adapter.ts,
interface/promover-manual.controller.ts, interface/promover-manual.dto.ts, reservas.module.ts, reservas.tokens.ts,
prisma/seed.ts. Contrato: docs/api-spec.yml (op promoverConsultaCola). SDK: apps/web/src/api-client/schema.d.ts.
Frontend: features/cola-espera (usePromoverManual.ts, PromoverManualDialog.tsx, ColaEsperaPage.tsx,
ColaItemFila.tsx, SeccionCola.tsx, index.ts). Tests: 6 suites nuevas. Reports QA N+1/N+2/N+3.

## Guardrails DUROS - resultado

- Bloqueo atomico (atomic-date-lock / no-distributed-lock): OK. Serializa con SELECT ... FROM fecha_bloqueada
  WHERE tenant_id=... AND fecha=...::date FOR UPDATE (uow L132-137) en un unico transaction, y RE-ASIGNA la MISMA
  fila (UPDATE reserva_id/tipoBloqueo/ttlExpiracion, L262-269) manteniendo una sola fila activa por (tenant,fecha)
  y respetando UNIQUE(tenant_id,fecha). Sin Redis/Redlock/locks distribuidos ni en memoria. Arbitraje D-4 gana el
  primer lock sin cesion via re-lectura bajo lock (L143-184). Verificado por RC-A/RC-B con Postgres real
  (Promise.allSettled).
- Hexagonal/DDD: OK. promocion-manual-cola.ts y el delta de maquina-estados.ts son puros (sin nestjs, prisma ni
  infrastructure); solo importan de ./maquina-estados. El puerto PromocionManualColaUoWPort vive en application/;
  el adaptador en infrastructure/. El caso de uso depende solo del puerto.
- Maquina de estados declarativa: OK. Expiracion forzosa modelada como tabla de datos
  MAPA_EXPIRACION_FORZOSA_BLOQUEANTE + resolverExpiracionForzosaBloqueante(); la promocion reutiliza
  resolverPromocionCola (2d a 2b). Sin if/else dispersos. Tests dirigidos en verde.
- Multi-tenancy / RLS: OK. tenantId y usuarioId derivan SIEMPRE del JWT (CurrentUser, controller L60-65), nunca
  del path/body. El SET LOCAL app.tenant_id (fijarTenant) es la primera operacion de la TX (uow L104-105). Toda
  query filtra tenant_id. Reserva de otro tenant oculta por RLS.
- Contrato vs DTO vs SDK: OK con una divergencia (H-1, abajo). PromoverManualRequest.confirmado coincide con el
  DTO; el SDK schema.d.ts esta regenerado (op promoverConsultaCola), no editado a mano. El frontend consume SOLO
  apiClient.POST(/reservas/{id}/promover).
- Frontend (arrow-functions / barrel / mobile-first): OK. Componentes y hooks son arrow-functions; feature
  expuesta por su barrel index.ts; dialogo y fila mobile-first (w-full a sm:w-auto, tactiles h-11/h-12, sin anchos
  px fijos). E2E N+3 verifico 390/768/1280 sin overflow.
- Tests primero / TDD: OK. Suites de dominio, use-case, HTTP, integracion, concurrencia real y maquina de estados;
  706/706 en verde (report N+1), lint y typecheck a 0.

## Puntos de atencion prioritaria

### H-1 - Divergencia contrato/implementacion: 404 vs 422 (reserva inexistente / otro tenant) - MAYOR
El contrato declara 404 (NotFound) para reserva inexistente o de otro tenant (RLS), pero el adapter (L117-119)
lanza PromocionManualConsultaNoEnColaError a 422 en ambos casos. El test HTTP no cubre el 404, asi que la
divergencia no esta testeada. No es fuga de datos (RLS oculta el recurso ajeno), pero el codigo HTTP incumple el
contrato publicado y el SDK del frontend tipa un 404 que el backend nunca emite. Debe resolverse antes de cerrar:
alinear implementacion al contrato (404 cuando la reserva no existe o esta fuera del tenant, reservando 422 para
la reserva existente que ya no esta en 2d) O corregir el contrato para declarar 422 y quitar el 404. Recomendacion:
404 para reserva no resoluble bajo RLS + 422 para existe pero no en 2d; en cualquier caso anadir el test HTTP.

### H-2 - Semantica del 409 para reserva ya en 2b sin carrera real - MENOR
El adapter (L167-169) devuelve 409 (cola ya actualizada) siempre que la elegida esta en 2b, incluso sin carrera
real (vista obsoleta). El mensaje es tecnicamente enganoso en ese sub-caso, pero es conservador y seguro: el
efecto (recargar la vista) es correcto y el 409 esta declarado en el contrato. Deuda menor de copy. No bloquea.

### 409-vs-422 en el adaptador - CORRECTO
Discriminacion correcta y bien comentada (L163-184): 2b a 409 carrera; terminal (2x/2y/2z) a 422 FA-05; sigue en
2d pero bloqueante esperada cambio bajo lock a 409; sin FECHA_BLOQUEADA a 409. Coherente con D-4 y los tests.

### Seed de tests en prisma/seed.ts - MENOR (deuda aceptable)
Se anaden fixtures de test (2 Gestores a1/a2 + tenant de control c9) al seed general, exigidos por el FK
audit_log_usuario_id_fkey y el aislamiento multi-tenant en slotify_test. Idempotentes (upsert), delimitados y
comentados. Mezclar datos de test en el seed general no es ideal (mejor seed.test.ts o setup de la suite), pero el
impacto es nulo en el piloto (upsert idempotente, ids reservados) y la BD de tests esta aislada. Aceptable como
deuda menor; recomendacion: extraer a un fixture de test en un change de limpieza.

## Otros hallazgos

- 403 (rol Gestor) NO se enforce en el backend - MENOR (baseline del proyecto). El contrato declara 403 y el
  frontend gatea la UI por rol gestor/admin (ColaEsperaPage L13,47-48), pero el controller no aplica RolesGuard ni
  Roles (solo el JwtAuthGuard global autentica). Existen RolesGuard y roles.decorator en shared/auth/ pero NINGUN
  controller de la app los usa: gap transversal pre-existente, no regresion de US-019. Cualquier usuario
  autenticado del tenant puede promover. Recomendado: change transversal de autorizacion por rol. No bloquea US-019
  (coherente con la linea base), pero el contrato promete un 403 que el backend no emite (registrar como riesgo).
- DTO confirmado con Allow() en vez de IsBoolean() - OK (justificado). Validacion delegada al dominio (422) para no
  chocar con el ValidationPipe global (400), mismo patron que ExtenderBloqueoRequestDto. Documentado y probado.
- Errores y comentarios en espanol, nombres en convencion (PascalCase/camelCase/kebab-case): OK.
- ttlExpiracion como timestamptz, no fecha formateada: OK (uow L211,255,267), mitiga el off-by-one de TZ.
- Auditoria: OK. AUDIT_LOG por RESERVA modificada con usuario_id del Gestor y origen promocion_manual; sin
  COMUNICACION (D-6). La ruta de anomalia audita y aborta sin correccion silenciosa.

## Veredicto

Veredicto: NO APTO

Motivo: H-1 (divergencia de contrato 404 vs 422) es un incumplimiento del contrato OpenAPI publicado (el backend
emite 422 donde el contrato y el SDK declaran 404 para reserva inexistente o de otro tenant) sin test que lo cubra.
El checklist exige que el contrato OpenAPI coincida con la implementacion; debe resolverse (alinear implementacion
o contrato + anadir el test HTTP) antes de cerrar. El resto de guardrails duros (bloqueo atomico, hexagonal,
maquina de estados declarativa, RLS/tenant desde JWT, SDK generado, responsive, TDD) estan CUMPLIDOS. Cerrada H-1
y registradas las notas menores (H-2 copy, 403 transversal, seed de test) como deuda, el change quedaria apto.
