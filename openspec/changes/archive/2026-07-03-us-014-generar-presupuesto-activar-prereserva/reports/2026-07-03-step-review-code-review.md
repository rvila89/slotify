# Code Review - US-014 Generar presupuesto / activar pre-reserva

- Change: us-014-generar-presupuesto-activar-prereserva
- Branch: feature/us-014-generar-presupuesto-activar-prereserva
- Fecha: 2026-07-03
- Revisor: code-reviewer (gate duro previo al gate humano)
- Alcance: diff completo de la branch vs master (arbol de trabajo: 9 ficheros modificados + nuevos modulos presupuestos y features/presupuestos).

---

## Veredicto: APTO

No se han encontrado bloqueantes. Todos los guardrails duros de CLAUDE.md se cumplen. Se registran observaciones menores no bloqueantes (limpieza de scripts auxiliares) para la fase de archive.

---

## Checklist de guardrails duros

- Hexagonal / DDD: OK. desglose-fiscal.ts sin imports (funciones puras); generar-presupuesto.use-case.ts importa solo tipos de dominio, ningun @nestjs / @prisma / infrastructure. Puertos en application, adaptadores en infrastructure.
- Bloqueo atomico de fecha: OK. activar-prereserva-uow.prisma.adapter.ts usa SELECT FOR UPDATE via queryRaw sobre (tenant_id, fecha) + UNIQUE(tenant_id, fecha). INSERT si 2a, UPDATE del TTL si 2b/2c/2v, colision P2002 si otra reserva. Sin Redis / Redlock / lock distribuido.
- Multi-tenancy / RLS: OK. tenantId/usuarioId siempre del JWT (CurrentUser), nunca del path/body. UoW fija SET LOCAL app.tenant_id como primera operacion de la tx. PRESUPUESTO hereda RLS via RESERVA (er-diagram 3.11, ver punto 3).
- Maquina de estados declarativa: OK. Nueva guarda ORIGENES_TRANSICION_ACTIVAR_PRERESERVA (tabla) + esOrigenValidoParaActivarPrereserva() en maquina-estados.ts, mismo patron que US-008. Sin if/else disperso.
- Importes en Decimal: OK. Persistencia con Prisma.Decimal; DTOs como Decimal string 2 dec con Matches(IMPORTE_REGEX). Cero Float/number en columnas monetarias.
- DTOs con class-validator: OK. IsInt/Min/IsString/Matches/ValidateNested.
- Errores en espanol: OK.
- Tests primero (TDD): OK. Tests hermanos presentes; 53 tests unitarios verdes (desglose, use-case, maquina-estados, filtro).
- Contrato OpenAPI vs DTOs: OK. PresupuestoDatosFiscalesError con required [codigo, camposFaltantes]; DTOs alineados.
- Cliente HTTP generado, no editado a mano: OK. Regenerado openapi-typescript desde docs/api-spec.yml y comparado con schema.d.ts versionado: IN SYNC, 0 diferencias.
- Arrow functions (func-style): OK. Lint api y web sin errores. Metodos de clase NestJS exentos.
- Frontend Bulletproof React: OK. features/presupuestos con api/components/lib/model + barrel index.ts. FichaConsulta importa solo por el barrel. Ficheros dentro de 300 lineas efectivas; lint verde.
- Responsive mobile-first: OK. Evidencia E2E en 3 viewports (390/768/1280): hamburguesa/drawer por debajo de lg, sin overflow. Dialog mobile-first (max-w-lg, scroll interno, touch h-12).
- Jobs / E2 post-commit idempotente: OK. E2 fuera de la tx critica, idempotente por (reserva_id, codigo_email=E2); fallo del proveedor no revierte la pre_reserva.

---

## Evaluacion explicita de los 5 puntos de contexto

1. Puerto UoW no generico (ejecutar devuelve Promise unknown con cast interno).
   ACEPTABLE. Es exactamente el precedente vivo de US-007 UnidadDeTrabajoPendienteInvitadosPort (transicion-pendiente-invitados.use-case.ts L158-163), que tambien declara el puerto con Promise unknown y castea en el sitio de llamada. El adaptador Prisma si lo implementa generico (ejecutar T), compatible. Consistente con el proyecto, no es deuda nueva.

2. Correccion de 2 aserciones del reparto (400/600 a 430.40/645.60 para total 1076).
   LEGITIMA. La suite pura desglose-fiscal.spec.ts fija la invariante senal+liquidacion=total (L96-101 con total 1076) y calcularReparto computa liquidacion = total - senal, senal = total*pctSenal/100. Para 1076 con pctSenal 40: senal 430.40, liquidacion 645.60 (suma 1076.00). El 400/600 original correspondia a un total de 1000 y violaba la invariante frente a la suite pura. Correccion legitima, no un ajuste para pasar por pasar. La logica 40/60 es correcta.

3. Modelado D-9: PRESUPUESTO no persiste tarifa_id ni tenant_id.
   COHERENTE, no bloqueante. er-diagram 3.11 lista PRESUPUESTO SIN columnas tenant_id ni tarifa_id (a diferencia de FACTURA 3.12 que si lleva tenant_id). El adaptador crear() no escribe tarifaId (solo lo propaga a la respuesta para trazabilidad). RLS via RESERVA (FK) dentro de la tx con SET LOCAL app.tenant_id. Decision documentada, no deuda oculta. Observacion menor: buscarEnviadoOAceptado filtra por reservaId sin tenant_id explicito; seguro bajo RLS y RESERVA tenant-scoped (no bloqueante).

4. BUG 1 corregido: HttpExceptionFilter propaga camposFaltantes.
   SIN REGRESION. Patron aditivo identico a colaDisponible/motivo (spread condicional solo si distinto de undefined). Tests dedicados: propaga el array en el 422 (L124-140) y NO lo anade a errores que no lo aportan (L141-145). Contrato lo declara required. 53 tests verdes.

5. BUG 2 corregido: E2E lee de slotify_dev.
   VERIFICADO. e2e/us-014-generar-presupuesto.spec.ts L26 usa psql -d slotify_dev (antes slotify_test). Report E2E (step N+3) verde en las 3 fases.

---

## Observaciones no bloqueantes / deuda a registrar

- [limpieza] apps/api/seed-e2e-dev.js y apps/api/cleanup-e2e-dev.js sin trackear en la raiz de apps/api. Considerar moverlos a scripts/ o e2e/ y/o ignorarlos. No bloqueante.
- [limpieza] scripts/hooks/__pycache__/*.pyc como untracked; anadir __pycache__/ a .gitignore. No bloqueante, ajeno a US-014.
- [nota RLS] buscarEnviadoOAceptado sin filtro tenant_id explicito (seguro bajo RLS, ver punto 3). Registrar como convencion para futuras queries tx-bound de PRESUPUESTO.

---

## Comprobaciones ejecutadas

- pnpm --filter api lint: sin errores.
- pnpm --filter web lint: sin errores (solo warnings de deprecacion del plugin boundaries).
- pnpm jest (desglose-fiscal + use-case + maquina-estados + http-exception filter): 4 suites, 53 tests PASS.
- Regeneracion del cliente OpenAPI y diff contra schema.d.ts versionado: 0 diferencias.
- Verificacion de pureza de domain y application: sin imports de framework/infra.

---

## Veredicto: APTO
