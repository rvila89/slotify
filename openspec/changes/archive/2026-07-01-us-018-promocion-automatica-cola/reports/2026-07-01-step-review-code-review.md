# Report: Code Review - US-018 Promocion Automatica de la Primera Consulta en Cola
**Step**: Code-review (obligatorio) | **Fecha**: 2026-07-01 | **Agente**: code-reviewer
**Rama**: feature/us-018-promocion-automatica-cola | **Alcance**: diff del change (working tree) vs master

## 1. Resumen

Revision de solo lectura del change US-018 (UC-12, A15, actor Sistema) contra review-checklist y architecture-guardrails. Se verificaron los guardrails DUROS (bloqueo atomico, seam congelado, hexagonal, RLS, maquina de estados declarativa, sin locks distribuidos) y las decisiones de diseno D-1..D-8.

Ficheros revisados: domain/maquina-estados.ts (MAPA_PROMOCION_COLA + resolverPromocionCola), domain/promocion-cola.ts (planificarPromocionCola, plan puro), application/promover-primero-en-cola.service.ts (+ PromocionColaUoWPort), infrastructure/promocion-cola-uow.prisma.adapter.ts (transaccion atomica), infrastructure/promocion-cola.prisma.adapter.ts (implements PromocionColaPort), reservas.module.ts (re-binding stub a real), reservas.tokens.ts, y 7 specs en __tests__ (49 tests).

Verificacion mecanica: ESLint sobre los ficheros del change 0 errores 0 warnings (el warning DIA_MS ya fue eliminado; solo persiste en promocion-cola-concurrencia.spec.ts donde SI se usa). grep de imports de framework/infra en domain: sin coincidencias reales. grep de Redis/Redlock/locks distribuidos: ninguno. grep de any en produccion: ninguno. QA report N+1: 49/49 tests US-018 verdes, 622/622 suite global, tsc limpio, depcruise sin violaciones.

## 2. Verificacion de guardrails duros

### 2.1 Bloqueo atomico (atomic-date-lock / no-distributed-lock) - CONFORME
Re-bloqueo de FECHA_BLOQUEADA SOLO via la primitiva reutilizada bloquearEnTx (US-040), dentro de la misma transaccion (uow L164-169); sin SQL de bloqueo nuevo. Toda la promocion (mutacion + re-bloqueo + reordenacion + auditoria) en UN unico transaction (L85-227), all-or-nothing. Exclusion mutua 100% en PostgreSQL: SELECT FOR UPDATE (L94-101) + re-lectura de la guarda + UNIQUE(tenant_id, fecha); sin Redis/Redlock. Serializacion RC-1/RC-2/RC-3 VALIDADA: el punto de serializacion es el SELECT FOR UPDATE sobre las RESERVA en s2d de la fecha (NO sobre FECHA_BLOQUEADA, que no existe tras la liberacion post-commit; un FOR UPDATE sobre 0 filas no bloquearia). La ruta ganadora bloquea y muta exactamente las filas que la perdedora tiene bloqueadas; bajo READ COMMITTED la perdedora re-lee tras el COMMIT y ya no ve s2d promovible y/o la guarda ya-promovida (L107-113) detecta el bloqueo vivo re-creado y hace no-op silencioso. No hay ventana de doble bloqueo (el UNIQUE lo impediria de todos modos) ni de doble promocion. La cola de 1 elemento (FA-01) tambien serializa. Correcto. Fallo del re-bloqueo (bloqueo intruso): P2002 propaga y rollback total; cubierto por promocion-cola-atomicidad.spec.ts.

### 2.2 Seam congelado (D-1) - CONFORME
domain/liberar-fecha.service.ts SIN cambios (git status limpio). El disparo post-commit exactamente-una-vez (L269-277) intacto; el puerto PromocionColaPort.promoverPrimeroEnCola devuelve Promise void (L113-114) y no se toca. El adaptador real recibe {tenantId, fecha}, delega en el caso de uso y devuelve void (contrato heredado respetado). No re-dispara ni reimplementa la deteccion de cola.

### 2.3 Hexagonal (no-infra-in-domain) - CONFORME
Los ficheros de domain NO importan nestjs, prisma ni infraestructura (grep + ESLint + depcruise sin violaciones). Puertos en aplicacion, adaptadores en infraestructura. El caso de uso depende solo del puerto inyectado.

### 2.4 Multi-tenancy / RLS (D-7) - CONFORME
fijarTenant via set_config app.tenant_id con ambito transaccional (equivalente a SET LOCAL) es la PRIMERA operacion de la transaccion (uow L87). El tenantId proviene SIEMPRE del comando del seam, nunca de input externo; el caso de uso lo propaga tal cual (test verificado). Todas las queries filtran tenant_id o quedan bajo RLS.

### 2.5 Maquina de estados declarativa - CONFORME
MAPA_PROMOCION_COLA es tabla de datos consulta/2d a consulta/2b; resolverPromocionCola es lookup puro (patron de resolverExpiracionTtl). Sin if/else dispersos. Guarda de origen estricta: cualquier otro origen devuelve null (12 casos cubiertos, incl. terminales y estados no-consulta).

### 2.6 planificarPromocionCola puro - CONFORME
No muta la entrada (test dedicado), determinista, sin efectos. Seleccion FIFO por posicion_cola=1 (no por orden de array). Deteccion de anomalia no contigua (hueco / no arranca en 1 / duplicadas) marca anomalia sin promover. Reordenacion FIFO ascendente re-apuntando a la nueva bloqueante.

### 2.7 Reordenacion bajo indice UNIQUE parcial de cola - CONFORME
Decrementos en orden ASCENDENTE de posicion (uow L173-181), evitando violar reserva_cola_posicion_key a mitad. Verificado en integracion (FA-03: R3 a pos 1, R4 a pos 2, apuntando a R2).

### 2.8 D-5 (alerta interna, sin email/US-045) - CONFORME
Alerta al gestor como campo alertaInterna dentro de datosNuevos del AUDIT_LOG de la transicion (uow L194-196), en la misma transaccion e idempotente via la guarda. NO se crea COMUNICACION ni se invoca email/US-045 (test integracion verifica comunicaciones cero). Patron US-012 D-10.

### 2.9 D-6 (FIFO + primer lock, coordinacion con US-019) - CONFORME
La guarda ya-promovida unica cubre RC-1/RC-2/RC-3 (tests de concurrencia reales con Promise.allSettled). No se amplia alcance a la promocion manual.

### 2.10 Tipos / TS strict - CONFORME
Sin any injustificado. Los casts as-Prisma.InputJsonValue y as-SubEstadoConsulta (uow L154) son de frontera Prisma acotados y justificados (mapeo via subEstadoDominioAPrisma). Importes/Decimal: N/A (no toca dinero).

### 2.11 Contrato OpenAPI - CONFORME (NO-OP)
Sin endpoint nuevo (efecto de Sistema post-commit). Cliente del frontend no editado. Sin delta de contrato.

### 2.12 Responsive (frontend) - N/A
Change 100% backend (actor Sistema, sin UI).

### 2.13 Tests primero - CONFORME
7 suites (declarativa, plan puro, binding, use-case, atomicidad, concurrencia, integracion) TDD RED a GREEN; 49/49 verdes; suite global 622/622.

### 2.14 Convenciones - CONFORME
Nombres/comentarios/errores en espanol; arrow functions en helpers/factories; metodos de clase NestJS exentos (correcto). Stub deprecado conservado y YA NO enlazado (binding useFactory al adaptador real; binding.spec verifica que NO resuelve al stub).

## 3. Revision de los 2 cambios de test del backend-developer

1. El optional-chaining en planificar-promocion-cola.spec.ts L127 (plan.promovida con reservaId) es necesario por TS strict (promovida: MutacionPromovida o null). NO debilita la cobertura: L126 ya asegura anomalia false y el deep-equal de reordenamientos exige la promocion; con promovida null el assert seguiria fallando. Aceptable.
2. La firma promoverPrimeroEnCola que devuelve Promise ResultadoPromocion en el service NO debilita el contrato PromocionColaPort: quien implementa el puerto (Promise void) es el ADAPTADOR, que devuelve void limpiamente. El retorno mas rico es un metodo del service (no el puerto) para que los tests inspeccionen el desenlace. Aceptable.

## 4. Hallazgos

### Bloqueante
- (ninguno)

### Alta
- (ninguno)

### Media
- (ninguno)

### Baja
- B-1 Deriva documental del punto de serializacion. El docblock de application/promover-primero-en-cola.service.ts (L11-14) y design.md D-3/D-4 describen el cerrojo como SELECT FOR UPDATE sobre FECHA_BLOQUEADA. La implementacion serializa correctamente sobre las RESERVA en s2d (bien documentado en promocion-cola-uow.prisma.adapter.ts L89-93, que explica por que la fila de FECHA_BLOQUEADA no sirve tras la liberacion). Solo deriva de comentario/diseno; comportamiento correcto. Recomendacion: alinear el docblock del service (y una nota en D-3/D-4) para citar el FOR UPDATE sobre reserva s2d como punto real de serializacion. No bloquea.
- B-2 Doble auditoria posible de anomalia bajo carrera (benigna). Si dos rutas concurren sobre una cola no contigua, ambas pueden registrar entradas de anomalia en AUDIT_LOG antes de abortar (ninguna muta estado). Sin impacto de consistencia; a lo sumo auditoria duplicada de un caso de datos anomalo (excepcional). Opcional; no requiere accion para el MVP.

## 5. Notas

- Las tareas pendientes en tasks.md (Fase 8 docs, Fase 9.1/9.2 este review, Fase 10 gate humano, Fase 11 archive/PR) son POSTERIORES al code-review en el flujo y no bloquean este veredicto. Fases 1-7 (impl + tests) completas.
- Flaky US-004 (deadlock 40P01) es ajeno; esta suite usa fechas de evento aisladas y no depende de el.

## 6. Veredicto

Todos los guardrails DUROS conformes (bloqueo atomico solo-PostgreSQL, seam congelado, hexagonal, RLS, maquina de estados declarativa, sin locks distribuidos). Sin hallazgos Bloqueante/Alta/Media. Dos hallazgos Baja (deriva documental y doble-auditoria benigna), ninguno impide el merge.

Veredicto: APTO
