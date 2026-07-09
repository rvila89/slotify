# Code Review - US-034 "Finalizar evento" (UC-25)

- Fecha: 2026-07-09
- Revisor: code-reviewer (solo lectura, contra review-checklist + architecture-guardrails)
- Rama: feature/us-034-finalizar-evento
- Alcance del diff: working tree vs master (cambios sin commitear). Backend NestJS/Prisma (dominio, aplicacion, infraestructura, interface), contrato OpenAPI + SDK regenerado, frontend (feature reservas), tests.

## Metodo
- Skills cargadas: review-checklist, architecture-guardrails.
- ESLint sobre ficheros nuevos/modificados de apps/api y apps/web: LIMPIO (solo deprecation warnings del plugin boundaries, sin errores).
- tsc --noEmit de apps/api: OK.
- Tests con dobles/mocks: backend 51/51 PASS (maquina-estados-finalizar-evento, debe-enviarse-e5, finalizar-evento.use-case, finalizar-evento.controller.http); frontend 16/16 PASS (finalizarEvento.test, FinalizarEventoDialog, FichaConsulta/FinalizarEvento).
- Tests de BD real y E2E: NO EJECUTADOS (ver Verificacion pendiente).

---

## Bloqueantes
Ninguno.

## Mayores
Ninguno.

## Menores
1. [contrato/respuesta - fallback] finalizar-evento.controller.ts aReservaResponse (lineas 101-138): cuando la relectura post-commit devuelve null, se emiten strings vacios en campos que el contrato tipa como enum (canalEntrada, preEventoStatus, liquidacionStatus, fianzaStatus). Fallback defensivo (no deberia ocurrir con BD real) que no rompe el tipo TS del DTO (declarado string), pero un string vacio no valida contra el enum del schema OpenAPI. Recomendacion: en la ruta de fallback, o 500 controlado, o devolver solo los campos requeridos poblados de forma valida. No bloquea porque con Postgres la relectura siempre resuelve (misma tx RLS que GET /reservas/:id).
2. [precision - E5 guard] finalizar-evento.use-case.ts dispararE5SiProcede (linea 377) convierte fianzaEur (string Decimal) a Number(...) solo para el predicado > 0 de debeEnviarseE5. Correcto: no hay aritmetica monetaria ni redondeo, ni se persiste el number. Sin accion requerida.
3. [documentacion stub - D-7] documentacion-evento.stub.adapter.ts siempre devuelve [] (fail-open declarado; US-033 aun no expone el checklist). Correcto por diseno; recordatorio de sustituir por el adaptador real cuando aterrice US-033.

---

## Verificacion por checklist

### Hexagonal / DDD - OK
- domain/maquina-estados.ts NO importa @nestjs/*, @prisma/* ni infrastructure/. resolverFinalizacionEvento y debeEnviarseE5 son funciones puras (arrow), deterministas, sin efectos.
- application/finalizar-evento.use-case.ts orquesta solo sobre puertos inyectados; no importa Prisma ni NestJS.
- Adaptadores Prisma/NestJS confinados en infrastructure/; controller en interface/. Agregado RESERVA como raiz.

### Bloqueo / transicion atomica - OK
- finalizar-evento-uow.prisma.adapter.ts: SELECT estado ... FOR UPDATE (serializa la fila) + updateMany WHERE estado=estadoOrigen que devuelve count -> filasAfectadas. UPDATE condicional por estado de origen: exactamente una gana.
- filasAfectadas===0 -> TransicionNoPermitidaError -> 409 transicion_no_permitida, DENTRO de la tx (aborta antes de auditar/disparar E5).
- SIN Redis/Redlock/lock distribuido; NO toca FECHA_BLOQUEADA ni la cola. Exclusion mutua solo en PostgreSQL sobre la fila RESERVA (correcto: no es bloqueo de fecha).
- Doble finalizacion concurrente: una transicion, un AUDIT_LOG, un E5 (E5 solo tras commit exitoso).

### Maquina de estados declarativa - OK
- MAPA_FINALIZACION_EVENTO es tabla de datos (ReadonlyArray) con la UNICA arista {evento_en_curso,null} -> {post_evento,null}. resolverFinalizacionEvento la consulta por find; sin if/else dispersos.
- IRREVERSIBILIDAD: no hay arista de retorno post_evento -> evento_en_curso; segunda finalizacion y cualquier otro origen -> null -> 409. Guarda re-evaluada bajo el lock.

### Multi-tenancy / RLS - OK
- tenantId y usuarioId SIEMPRE del JWT (@CurrentUser), nunca del path/body. El {id} del path es solo la RESERVA.
- Lectura, UoW de transicion y disparo de E5 fijan RLS con fijarTenant(tx, tenantId) (= SET LOCAL app.tenant_id) como primera operacion de cada tx.
- Reserva de otro tenant -> invisible bajo RLS -> null -> ReservaNoEncontradaError -> 404.
- RolesGuard + @Roles(gestor); JwtAuthGuard global (401 sin token, 403 sin rol).

### Separacion D-2 - OK
- Paso transaccional: transicion + AUDIT_LOG de transicion + (condicional) alerta de dato anomalo, todo en la misma tx (all-or-nothing). NPS programada como marca derivada (npsProgramada:true), sin esquema nuevo (D-6).
- Paso post-commit best-effort: E5 fuera de la tx; try/catch que colapsa cualquier excepcion a fallido sin revertir el estado ya commiteado.
- Hidratacion de la RESERVA (fix reciente): lectura post-commit best-effort (hidratarReserva con try/catch->null), fuera de la tx; NO participa en la atomicidad ni condiciona E5. No rompe D-2.

### D-4 (fianza) - OK
- debeEnviarseE5(fianzaEur) = fianzaEur != null && fianzaEur > 0; NULL y 0 -> false (no_aplica). fianza_eur manda sobre fianza_status.
- Inconsistencia fianza_status=cobrada + fianza_eur IS NULL: alerta en AUDIT_LOG con motivo=dato_anomalo_fianza; NO bloquea, NO envia E5.

### AUDIT_LOG - OK
- Transicion: accion=transicion, entidad=RESERVA, datosAnteriores={estado:evento_en_curso}, datosNuevos={estado:post_evento}, usuarioId poblado (origen Usuario). Escrito dentro de la tx.
- Alerta anomala: accion=actualizar (valor valido del enum Prisma AccionAudit), discriminada por motivo en datosNuevos. Aceptable.

### Contrato vs implementacion - OK
- docs/api-spec.yml: nuevo POST /reservas/{id}/finalizar-evento (operationId finalizarEvento), FinalizarEventoRequest (objeto vacio, additionalProperties:false), FinalizarEventoResponse = allOf(Reserva) + {e5, documentacionPendiente}, FinalizarEventoE5, ResultadoE5 (enviado/fallido/no_aplica), FinalizarEventoConflictError (409 transicion_no_permitida). 401/403/404/409 declarados.
- FinalizarEventoResponseDto cumple allOf(Reserva): la RESERVA se hidrata reusando el read-model de GET /reservas/:id (buscarDetalle -> ReservaDetalleLectura), y el controller omite el cliente embebido (propio de ReservaDetalle). Importes como string (Decimal); fechas ISO.
- SDK generado apps/web/src/api-client/schema.d.ts: +136 lineas para el nuevo endpoint, cabecera auto-generated. NO editado a mano (regenerado desde el contrato).

### Frontend - OK
- Estructura Bulletproof React: useFinalizarEvento en features/reservas/api, finalizarEvento (guarda + etiquetas) en lib, dialogo en components; barrel index.ts reexporta hook/tipos/helpers. Pagina FichaConsulta co-localiza sub-componentes en components/.
- Cliente generado no editado a mano.
- Mobile-first: Dialog shadcn w-[calc(100%-2rem)] max-w-lg, scroll interno max-h-[90vh] overflow-y-auto, footer apila en columna <sm y pasa a fila sm:; botones h-12 (>=48px). Sin anchos px fijos que rompan.
- Tres estados de E5 en AvisoEventoFinalizado (enviado/fallido/no_aplica) + advertencia no bloqueante de documentacion (en dialogo y en aviso posterior). SIN boton de reenvio (diferido).
- Convenciones: arrow functions en todo el codigo nuevo; ESLint (func-style, boundaries, no-restricted-imports, max-lines con skipBlankLines/skipComments) LIMPIO en los ficheros del diff (incl. AccionesConsulta.tsx).

### Convenciones / tipos - OK
- Sin any ni function declarativa en el codigo nuevo de backend. Importes en Decimal (string), no Float. Errores y comentarios en espanol. DTO de request vacio con additionalProperties:false.

---

## Verificacion PENDIENTE (condicion de cierre)
Docker/PostgreSQL NO estan disponibles en este entorno (confirmado por el orchestrator). Quedan SIN EJECUTAR y deben correrse con Postgres antes del cierre/PR:
- finalizar-evento-integracion.spec.ts (transicion real, RLS cross-tenant 404, AUDIT_LOG, E5 fallido no revierte estado, dato anomalo).
- finalizar-evento-concurrencia.spec.ts (doble finalizacion -> exactamente una gana, otra 409; FOR UPDATE real).
- QA curl y E2E Playwright en 3 viewports (390/768/1280) con datos activos.
El CODIGO revisado (FOR UPDATE + UPDATE condicional, RLS SET LOCAL, separacion D-2, maquina declarativa, contrato) esta correctamente escrito; la verificacion contra BD real es una limitacion de ENTORNO, no un defecto del diff, y se escala al gate humano final como condicion de cierre.

---

Veredicto: APTO
