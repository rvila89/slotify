# Code Review - US-026 Cierre automatico de ficha operativa en T-1d

- Fecha: 2026-07-04
- Revisor: code-reviewer (solo lectura)
- Branch: feature/us-026-cierre-automatico-ficha-operativa
- Alcance: backend puro (job cron + endpoint interno protegido) + contrato + SDK generado.
- Base: working tree vs master (trabajo aun no commiteado; revisados ficheros tracked + untracked de la feature).

## Resumen del diff
- Dominio: domain/maquina-estados-pre-evento.ts: tabla declarativa CIERRE_AUTOMATICO_A10 + resolverCierreAutomatico (dominio puro).
- Aplicacion: application/cerrar-fichas-vencidas.service.ts: barrido con dos puertos (CandidatasCierreFichaPort, CierreFichaVencidaPort), fallo aislado por RESERVA.
- Infra: candidatas-cierre-ficha.prisma.adapter.ts (lectura cross-tenant por fecha de calendario); cierre-ficha-vencida-uow.prisma.adapter.ts (UoW atomica RLS write + SELECT FOR UPDATE + re-evaluacion A10 + AUDIT_LOG). MOD US-025: cierre-ficha-uow.prisma.adapter.ts (SELECT FOR UPDATE + guarda).
- Interface: barrido-fichas.controller.ts (POST /cron/barrido, Public + CronTokenGuard); barrido-fichas.dto.ts; barrido-fichas.scheduler.ts (nestjs/schedule diario 00:01).
- Wiring: ficha-evento.tokens.ts, ficha-evento.module.ts. Contrato: docs/api-spec.yml + SDK schema.d.ts regenerado. Tests: 5 suites nuevas.

## Checklist de guardrails

1. Hexagonal - OK. El dominio no importa nestjs, prisma ni infra; solo tipos y funciones puras. Puertos en aplicacion; adaptadores en infra. pnpm run arch (depcruise): no dependency violations found (372 modulos).

2. Idempotencia por PostgreSQL, sin locks distribuidos - OK. Sin Redis/Redlock ni timer exacto. Serializacion via SELECT FOR UPDATE sobre reserva dentro de la TX de cada RESERVA + re-evaluacion de la guarda declarativa. Si bajo lock ya esta cerrado, la UoW devuelve cerrada=false (no-op).

3. Jobs asincronos (estado en fila + barrido periodico) - OK. nestjs/schedule (registro dinamico via SchedulerRegistry) invoca el endpoint HTTP interno protegido con X-Cron-Token; sin CRON_TOKEN el disparo automatico se desactiva con warning. Sin Lambda/EventBridge. Idempotente: disparo perdido se recupera en la siguiente pasada.

4. Multi-tenancy / RLS - OK. Lectura de candidatas cross-tenant legitima (rol tecnico del proceso de Sistema, sin fijar tenant); cada fila trae su tenant_id y cada ESCRITURA abre su TX con fijarTenant(tx, candidata.tenantId) como primera operacion (RLS write). tenant_id nunca de input externo; viaja con la fila leida.

5. Auth service-to-service - OK. BarridoFichasController usa Public (evita JwtAuthGuard global) + CronTokenGuard dedicado. Compara X-Cron-Token con CRON_TOKEN (timingSafeEqual); ausente/invalido = 401; Bearer JWT sin cabecera de cron NO autoriza. Verificado por curl (7.4) y test controller (3.11).

6. Contrato congelado (Opcion A) - OK. Se reutiliza POST /cron/barrido con fichas OPCIONAL en BarridoResponse (compatibilidad preservada) + schema BarridoFichasResumen (candidatas, fichasCerradas, fallos; todos required; minimum 0). DTO backend BarridoFichasResumenDto coincide EXACTAMENTE. SDK regenerado con pnpm generate-client, no editado a mano. Observacion menor: el schema menciona tarea=fichas/all pero el controller no ramifica por tarea (siempre cierra fichas).

7. Convenciones - OK. Maquina de estados como estructura de datos (TRANSICIONES / CIERRE_AUTOMATICO_A10), sin if dispersos. Arrow functions; metodos de clase NestJS exentos. Nombres, comentarios y errores en espanol.

8. Auditoria - OK. La UoW automatica crea exactamente 1 AUDIT_LOG por cierre efectivo: accion=transicion, entidad=RESERVA, usuarioId=null (origen Sistema), causa=A10 en datosNuevos, preEventoStatus previo en datosAnteriores. Verificado por integracion (usuarioId null, contiene A10, length 1) y curl. Observacion menor: el cierre manual US-025 audita entidad=FICHA_OPERATIVA vs automatico=RESERVA para la misma transicion logica; intencionado por spec, conviene documentarlo.

## Punto critico: modificacion del UoW de cierre MANUAL de US-025

Cambio: FichaCierrePrismaRepository.cerrar() ahora hace SELECT pre_evento_status FROM reserva WHERE id_reserva FOR UPDATE y re-evalua esTransicionPreEventoValida(origen, destino) antes de mutar; si la ficha ya esta cerrado (o la reserva no existe) lanza FichaYaCerradaError, abortando la TX sin mutar ni auditar.

(a) Correcto y seguro? Cambio de comportamiento observable no deseado?
- Serializacion por fila correcta: manual y automatico toman FOR UPDATE sobre la MISMA fila reserva y se serializan; el segundo re-lee cerrado y se autoexcluye. Invariante exactamente 1 transicion sin doble auditoria garantizada por PostgreSQL (C-2 lo confirma).
- PROBLEMA (Alta): FichaYaCerradaError NO se traduce a HTTP. El controller US-025 (ficha-operativa.controller.ts traducirError) solo mapea FichaNoDisponibleError (409) y ReservaNoEncontradaError (404); el resto se relanza tal cual = NestJS responde 500. Un cierre manual legitimo que pierde la carrera contra el cron devolveria 500 en vez de un desenlace idempotente (200) o un 409. Cambio de comportamiento observable regresivo respecto a US-025.
- Camino NO cubierto por tests: los specs US-025 mockean el UoW (repos.ficha.cerrar = jest.fn), asi que la rama SELECT FOR UPDATE + FichaYaCerradaError no se ejercita; y C-2 usa Promise.allSettled que ABSORBE el rechazo (solo asevera resultados[0]=barrido fulfilled). Por eso 101/101 verde y regresion cero son ciertos para lo probado, pero hay un hueco no probado en el camino nuevo.
- FichaYaCerradaError es una clase privada de infra usada como control de flujo que escapa al borde HTTP; mas limpio expresarla como error de dominio/aplicacion (reusar FichaNoDisponibleError o conflicto -> 409).

(b) Debe US-026 tocar codigo de US-025 o aislarse?
- El acoplamiento es funcionalmente necesario para C-2 (ambas vias comparten la fila y deben serializarse), asi que tocar el UoW manual es defendible. Objecion de higiene: cambia el contrato de errores del endpoint US-025 (nuevo 500 en camino antes inexistente) sin test de regresion propio ni mapeo HTTP. Deberia acompanarse de (1) mapeo a 200-idempotente o 409 y (2) test de cierre manual pierde la carrera.

(c) Coordinacion de concurrencia correcta (serializacion por fila, sin locks distribuidos)?
- Si. SELECT FOR UPDATE sobre reserva en ambas vias; sin Redis/locks distribuidos; re-evaluacion de la guarda dentro de la TX. Diseno solido; unico defecto: manejo del desenlace perdedor en el lado manual (mapeo a 500).

## Contexto de calidad (coherencia)
- QA PASS 34/34 dirigidos; suite global 1211/1212 (unico fallo = flaky pre-existente US-004 40P01, ajeno). pnpm run arch reverificado en esta revision: verde.

## Hallazgos por severidad

### Bloqueantes
- (ninguno)

### Alta
- [comportamiento/US-025] cierre-ficha-uow.prisma.adapter.ts:39-65 + ficha-operativa.controller.ts:144-160: el nuevo FichaYaCerradaError no se traduce a HTTP -> un cierre manual legitimo que pierde la carrera contra el barrido devuelve 500 (regresion observable). Recomendacion: mapear a 200-idempotente o 409 y anadir test de cierre manual pierde la carrera (hoy allSettled en C-2 oculta el desenlace del lado manual). No bloqueante: ventana estrecha, estado en BD integro (1 transicion, sin doble auditoria), sin corrupcion de datos.

### Media
- [contrato] El schema menciona tarea=fichas/all pero el controller no ramifica por tarea. Alinear al anadir mas tareas o documentar que hoy el parametro es informativo.
- [tests] No hay test unitario del UoW manual real (sin mock) que cubra la rama FICHA ya cerrada; el unico ejercicio del camino nuevo es C-2 con el rechazo absorbido por allSettled.

### Baja
- [auditoria] Divergencia intencionada entidad: manual=FICHA_OPERATIVA vs automatico=RESERVA para la misma transicion logica; documentar para consultas de auditoria.
- [higiene] FichaYaCerradaError es un tipo de infra usado como control de flujo que escapa al borde HTTP; preferible error de dominio/aplicacion.

### OK
- Hexagonal (arch verde), sin locks distribuidos, patron async-jobs, multi-tenancy/RLS, auth X-Cron-Token (401), contrato congelado + SDK generado, guarda declarativa, atomicidad + fallo aislado, idempotencia, filtro estricto estado/fecha, seleccion por fecha de calendario, auditoria origen Sistema causa A10.

## Conclusion
El core del barrido (dominio puro, idempotencia por PostgreSQL, RLS write por tenant, auth de cron, contrato, auditoria) cumple los guardrails duros. El endurecimiento del UoW de US-025 es correcto en serializacion y garantiza la invariante de C-2, pero introduce un hallazgo de severidad Alta NO bloqueante: un cierre manual que pierde la carrera degrada a 500 por falta de mapeo del nuevo error, sin test de regresion que lo cubra. No hay corrupcion de datos ni violacion de una regla dura; se recomienda subsanar mapeo + test antes o justo despues del merge. No existe ningun hallazgo Bloqueante.

Veredicto (primera pasada, 2026-07-04): APTO con un hallazgo Alta NO bloqueante (mapeo del nuevo FichaYaCerradaError). Ver la seccion de re-review mas abajo para el VEREDICTO FINAL VIGENTE.

---

# Re-review tras subsanacion del hallazgo Alta (2026-07-04)

- Revisor: code-reviewer (solo lectura). Branch: feature/us-026-cierre-automatico-ficha-operativa.
- Alcance del re-review: los 4 ficheros de la subsanacion + confirmacion de que el fix NO toca contrato/SDK.
- Desenlace elegido por el equipo: **200 idempotente** (sin cambio de contrato; el 409 existente de US-025 quedaba reservado a `code=ficha_no_disponible`, otra semantica).

## Diff revisado
- `domain/ficha-operativa.ports.ts`: `FichaYaCerradaError` PROMOVIDO a error de DOMINIO (antes clase privada de infra), con docblock que explica la senal de coordinacion C-2 y que NO es un error HTTP.
- `infrastructure/cierre-ficha-uow.prisma.adapter.ts`: importa y lanza el error de dominio; ya no define clase privada. La re-evaluacion bajo `SELECT ... FOR UPDATE` + `esTransicionPreEventoValida(origen, 'cerrado')` es identica; `cerrado -> cerrado` es invalida por la tabla declarativa (`TRANSICIONES.cerrado = []`).
- `application/cerrar-ficha-operativa.use-case.ts`: envuelve la UoW en try/catch; ante `FichaYaCerradaError` relee la ficha cerrada (`releerFichaCerrada`) y devuelve resultado idempotente; cualquier OTRO error se relanza (`throw error`). El controller (`traducirError`) ya no ve el error -> 200 normal.
- NUEVO `__tests__/cerrar-ficha-operativa-interleaving.spec.ts`: integracion sobre el caso de uso REAL cableado en `FichaEventoModule` (sin mock del UoW; sin `Promise.allSettled` que absorbia el rechazo). Siembra reserva con ficha ya cerrada + auditoria A10 previa; invoca cierre manual; asserta que resuelve (no lanza, no 500), `fichaCerrada=true`/`preEventoStatus='cerrado'`, NO muta `fecha_cierre` (sigue la previa), NO duplica auditoria (`contarTransiciones === 1`).

## Evaluacion punto a punto

1. Hallazgo Alta SUBSANADO. El camino perdedor de la carrera ya NO degrada a 500: el caso de uso intercepta `FichaYaCerradaError` y resuelve 200-idempotente, sin re-mutar y sin duplicar auditoria. El test lo cubre DE VERDAD: sobre el use-case real, con el UoW real (`$transaction` + `SET LOCAL app.tenant_id` + `SELECT ... FOR UPDATE` + re-evaluacion), y el rechazo YA NO se absorbe con `allSettled` (se aserta `resolves` y el estado de BD post). Verificado: `npx jest interleaving` = 2/2 verde contra `slotify_test`.

2. Hexagonal CORRECTO. Promover el error a dominio y capturarlo en el caso de uso (en vez de dejar que la infra escape al borde HTTP) es la higiene adecuada (cierra tambien la observacion Baja de higiene de la primera pasada). `domain/ficha-operativa.ports.ts` sigue importando solo tipos de dominio + `AuditLogPort` (puerto), sin nestjs/prisma/infra. `pnpm run arch` (depcruise) reverificado: no dependency violations found (373 modulos) -- +1 modulo coherente con el error promovido.

3. Fallback del use-case: SEGURO, no enmascara errores distintos. `FichaYaCerradaError` se lanza EXCLUSIVAMENTE en `FichaCierrePrismaRepository.cerrar()` y SOLO cuando `origen === null` (reserva ausente bajo lock) o la transicion a `cerrado` es invalida (unico caso real desde un estado valido: `cerrado -> cerrado`). Ambos son genuinamente "ya cerrada / no aplicable". Un fallo de escritura o de BD es OTRA excepcion y el `catch` la RE-LANZA (`throw error`) -> NO se puede degradar un error real a un falso 200-idempotente. El fallback al snapshot cargado (rama `reserva?.ficha == null`) solo cubre la carrera improbable de reserva desaparecida entre la carga inicial y la relectura; proyecta `fichaCerrada:true/preEventoStatus:'cerrado'` para no degradar a error. Observacion menor (Baja, ver abajo): en ese sub-caso el 200 es ligeramente optimista, pero es un camino practicamente inalcanzable en este dominio (las reservas no se borran) y jamas devuelve datos de otro tenant (la relectura filtra por tenant/RLS).

4. Reconsideracion de observaciones previas:
   (a) Media [contrato] controller no ramifica por `tarea`: SIGUE IGUAL. Aceptable para MVP -- el parametro es hoy informativo y el barrido cierra fichas siempre; recomendacion de documentarlo o ramificar al anadir mas tareas. No bloqueante.
   (b) Media [tests] "no hay test del UoW manual real": CERRADA. El nuevo interleaving spec ejercita el camino real sin mock y sin absorcion del rechazo.
   (c) Baja [auditoria] divergencia de `entidad` (manual FICHA_OPERATIVA vs automatico RESERVA): SIGUE IGUAL, intencionada por spec; recomendacion de documentarla para consultas de auditoria. No bloqueante.

5. Contrato/SDK: NO tocados por el fix. El `git diff` de `docs/api-spec.yml` y `apps/web/src/api-client/schema.d.ts` solo contiene las adiciones legitimas de US-026 (`BarridoFichasResumen`, `BarridoResponse.fichas?`), ya revisadas y aprobadas en la primera pasada; no hay nuevo endpoint, response ni `code` para el cierre manual. El desenlace 200-idempotente es coherente con el contrato congelado de US-025 (mismo `CerrarFichaOperativaResponseDto`).

## Verificaciones ejecutadas en el re-review
- `pnpm run arch` (depcruise): no dependency violations found (373 modules, 1317 dependencies). VERDE.
- `pnpm lint` (eslint apps/api): sin errores. VERDE.
- `npx jest interleaving`: 2/2 tests VERDE (BD aislada slotify_test).
- Suite completa ejecutada durante el re-review: 138 suites / 1214 tests VERDE (esta corrida no reprodujo el flaky pre-existente de US-004 40P01). Coherente con el reporte del backend-developer (47 dirigidos + 103 regresion ficha-evento).

## Hallazgos remanentes (ninguno bloqueante, ninguno Alta)
- Media [contrato]: `tarea` no ramifica en el controller (informativo hoy). Documentar o ramificar al crecer.
- Baja [auditoria]: divergencia intencionada de `entidad` manual/automatico para la misma transicion logica. Documentar.
- Baja [robustez]: el fallback al snapshot cuando la relectura no encuentra la ficha devuelve un 200 optimista en un sub-caso practicamente inalcanzable (reserva desaparecida bajo lock). Opcional: registrar un warning/telemetria en esa rama para no silenciar una anomalia futura. No afecta a integridad de datos ni a aislamiento de tenant.

## Conclusion del re-review
El hallazgo Alta de la primera pasada queda CERRADO: el cierre manual que pierde la carrera contra el barrido A10 ya resuelve 200-idempotente (no 500), auditado sin duplicar y sin mutar estado, con test de integracion real que lo demuestra. La promocion de `FichaYaCerradaError` a dominio mejora la higiene hexagonal (cierra tambien la observacion Baja de higiene) y el `catch` acotado no enmascara errores de otra naturaleza. Contrato y SDK intactos. arch/lint/tests verdes. No queda ningun hallazgo Bloqueante ni Alta; solo observaciones Media/Baja no bloqueantes.

Veredicto: APTO
