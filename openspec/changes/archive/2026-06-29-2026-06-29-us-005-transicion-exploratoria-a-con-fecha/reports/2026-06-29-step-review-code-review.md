# Informe de code-review -- US-005 (transicion exploratoria 2.a -> con fecha)

- Rama: feature/us-005-transicion-exploratoria-a-con-fecha vs master
- Revisor: code-reviewer (solo lectura, sin auto-fix). Fecha: 2026-06-29
- Alcance: POST /reservas/{id}/fecha (transicion 2a -> 2b/2d/2a), GET /reservas/{id} (detalle),
  fix del filtro global, frontend (ficha + dialogo) y enlace de conveniencia en NuevaConsultaPage.

NOTA de metodo: gran parte del codigo nuevo esta SIN git add (untracked); git diff master NO lo
muestra. Se reviso el arbol de trabajo completo (untracked incluidos) via git status. Deben
quedar staged antes del PR (observacion operativa).

## Verificaciones automaticas ejecutadas
- Hexagonal (depcruise): pnpm run arch -> OK, no dependency violations (160 modulos).
- Lint backend (apps/api): pnpm lint -> OK.
- Lint frontend (apps/web): pnpm lint --max-warnings 0 -> OK.
- Tests nucleo US-005: jest (use-case, maquina-estados, query, filtro) -> 4 suites / 36 verde.
- any injustificado: rg sobre archivos nuevos -> ninguno.

## Hallazgos por severidad
### Bloqueantes
Ninguno.
### Altos
Ninguno.
### Medios
Ninguno.
### Bajos / Observaciones
- [trazabilidad - UPSERT E1] ComunicacionTransicionPrismaRepository.crear
  (transicion-fecha-uow.prisma.adapter.ts:148-194) hace UPSERT manual (findFirst + update/create)
  de la fila (reserva, E1). CORRECTO e IDEMPOTENTE dado el indice PARCIAL
  uq_comunicacion_reserva_codigo ... WHERE reserva_id IS NOT NULL (Prisma no lo modela como unique
  compuesto; su upsert declarativo no aplica). El unico escritor de la E1 de la reserva en este
  flujo es esta transicion (RESERVA serializada por el camino 2.b), por lo que no puede disparar un
  P2002 de comunicacion que active el retry de re-derivacion a cola (ese retry es SOLO para
  fecha/posicion_cola). MATIZ: el update SOBRESCRIBE el log del envio inicial de E1
  (asunto/cuerpo/estado/fecha_envio); MITIGADO por el AUDIT_LOG accion=transicion (historial
  inmutable). Decision humana Opcion A aprobada en QA US-005; no compromete la idempotencia de
  US-045. No bloqueante.
- [QA - E2E pendiente] El step 8 (Playwright E2E) quedo INCOMPLETO por desconexion del MCP de
  Playwright (entorno, NO codigo). El responsive si se valido. Unit/integracion/concurrencia (319
  tests) y curl (step 7, los 3 fixes con evidencia directa) en VERDE. El veredicto de CODIGO no se
  bloquea por la indisponibilidad del MCP; se senala como PENDIENTE DE QA: ejecutar el E2E al
  recuperar el MCP.
- [deadlock preexistente] El 318/319 ocasional bajo --runInBand es un deadlock preexistente de
  US-004, ajeno a esta US. No afecta al veredicto.
- [operativo] Archivos del core (use-case, adaptadores, controllers, DTOs, paginas frontend) aun
  untracked; versionar antes del PR.

## Checklist de guardrails (duros)
- [OK] Hexagonal: domain/maquina-estados.ts no importa @nestjs/*, @prisma/* ni infrastructure/.
  esOrigenValidoParaAnadirFecha y la tabla ORIGENES_TRANSICION_ANADIR_FECHA son dominio puro.
  Use-case y query dependen solo de puertos inyectados. depcruise limpio.
- [OK] Bloqueo atomico: NO reinventa el bloqueo. Reusa bloquearEnTx (US-040) con SELECT ... FOR
  UPDATE + UNIQUE(tenant_id, fecha); el P2002 del INSERT se propaga CRUDO para el retry de la UoW
  (re-derivacion D4 a 2.d). Cola serializada con SELECT ... FOR UPDATE sobre la fila bloqueante.
  Sin Redis/Redlock/locks distribuidos ni en memoria.
- [OK] Multi-tenancy + RLS: fijarTenant(tx, tenantId) es la PRIMERA operacion en la UoW y en GET
  /reservas/{id}. Queries filtran tenant_id; tenantId/usuarioId del JWT (CurrentUser), nunca del
  path/body. Cross-tenant -> null -> 404.
- [OK] Maquina de estados declarativa: origen/destino por TABLAS
  (ORIGENES_TRANSICION_ANADIR_FECHA, REGLAS_ALTA_CON_FECHA) + lookup; sin if/else dispersos.
  Origen invalido -> TransicionFechaValidacionError tipo guarda -> 422.
- [OK] Atomicidad D4: UPDATE RESERVA + bloqueo FECHA_BLOQUEADA + COMUNICACION (borrador) +
  AUDIT_LOG en UNA transaccion. Email POST-COMMIT y TOLERANTE (un fallo no revierte). El retry de
  re-derivacion se activa SOLO por P2002 de fecha/posicion_cola (esColisionReintentable excluye
  reserva_id y la comunicacion).
- [OK] Cliente generado NO editado a mano: apps/web/src/api-client/schema.d.ts es regeneracion del
  contrato (path /reservas/{id}/fecha, schemas US-005). El frontend lo CONSUME (apiClient.GET/POST,
  tipos components schemas); sin edicion manual.
- [OK] Contrato OpenAPI vs DTOs: AsignarFechaRequestDto/ResponseDto y ReservaDetalleResponseDto
  coinciden con AsignarFechaRequest, Reserva y ReservaDetalle. GET /reservas/{id} mapea
  ReservaDetalle (= Reserva + cliente); los arrays extras/presupuestos/facturas son OPCIONALES (sin
  required) y su omision es conforme. No incluye tipoBloqueo/fechaDisponible/avisoDisponibilidad
  (viven en CreateReservaResponse, no en ReservaDetalle) -- correcto.
- [OK] Decision D-1 (> hoy): reusa esFechaEstrictamenteFutura (US-040); frontend lo refuerza con
  min=mananaISO() + Zod v>hoyISO(). Coherente con contrato y US-004.
- [OK] Filtro global: propaga colaDisponible/motivo solo si la excepcion los aporta (patron
  opcional como codigo/detalle); el resto conserva el envelope estandar. P2002 residual -> 409,
  nunca 500. Coherente con AsignarFechaConflictoError.
- [OK] Importes en Decimal: aImporte serializa Prisma.Decimal a string con 2 decimales (toFixed 2);
  ningun Float/number para importes.
- [OK] DTOs validados: AsignarFechaRequestDto con class-validator (IsDateString,
  IsOptional/IsBoolean). DTOs de salida no requieren validacion.
- [OK] Responsive (mobile-first): ficha 1 columna (grid-cols-1 sm:grid-cols-2), paddings p-4 sm:p-6
  lg:p-8, max-w 1000px, boton w-full sm:w-auto. Dialogo shadcn/Radix w-[calc(100%-2rem)] max-w-lg,
  footer flex-col-reverse sm:flex-row, sin anchos px fijos que rompan. El chrome (sidebar hidden
  w-72 lg:flex -> drawer + hamburguesa lg:hidden) colapsa en <lg (AppShell). Enlace en
  NuevaConsultaPage min-h-12 w-full sm:w-auto. QA reporto responsive PASS.
- [OK] Reuso real: bloquearEnTx, resolverPlanBloqueo, determinarAltaConFecha,
  DespacharEmailService.finalizarEnvio (via ConfirmacionBloqueoEmailAdapter), mappers de
  sub-estado. Sin duplicacion del nucleo critico.
- [OK] Convenciones / arrow functions: nombres en espanol (PascalCase/camelCase/kebab-case),
  comentarios y errores en espanol. ESLint (func-style/prefer-arrow-callback) verde en api y web.
- [OK] Tests primero: tests de maquina de estados, use-case, concurrencia, integracion y de la
  query/filtro; el nucleo US-005 pasa (36 en la corrida del reviewer; 319 en la suite QA).

## Veredicto: APTO

No se han detectado hallazgos bloqueantes ni de severidad alta. Los guardrails duros (hexagonal,
bloqueo atomico sin locks distribuidos, multi-tenancy+RLS, maquina de estados declarativa,
atomicidad D4, cliente generado intacto, importes Decimal, responsive) se cumplen, y los gates
automaticos (arch, lint api+web, tests del nucleo) estan en verde.

Condiciones de cierre (no bloquean el veredicto de codigo, si el PR):
1. Versionar (git add/commit) los archivos del core aun untracked.
2. Completar el E2E Playwright (step 8) cuando el MCP este disponible.
