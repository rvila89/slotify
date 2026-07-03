# Code-review - US-010 Registrar resultado de visita - reserva inmediata (2.v -> pre_reserva)

- Fecha: 2026-07-03
- Rama: feature/us-010-resultado-visita-reserva-inmediata (base master)
- Revisor: code-reviewer (solo lectura, gate duro)
- Pase: SEGUNDO PASE (re-revision tras los fixes del backend-developer sobre B1 y B2 del primer pase)
- Alcance: dominio + aplicacion + infra + interface + frontend + contrato OpenAPI + SDK + tests US-010 y US-009.

## Resumen ejecutivo

Segundo pase. En el primer pase el veredicto fue NO APTO por dos bloqueantes (B1 read-model duracionHoras
y B2 codigo del 422 incoherente). Ambos han sido corregidos DENTRO de este change, sin tocar
contrato/SDK/frontend de forma indebida. La cadena end-to-end del happy-path de la UI queda DESBLOQUEADA y
verificada. Los tres no-bloqueantes (A1, A2, A3) tambien estan resueltos. Guardrails duros intactos.
typecheck backend verde (tsc --noEmit exit 0). Veredicto de este pase: APTO.

## Estado de los bloqueantes previos

### B1 (era Bloqueante) - RESUELTO
Bug de read-model: GET /reservas/:id serializaba duracionHoras como null (Number del literal h4 = NaN).

- Helper canonico creado: apps/api/src/reservas/infrastructure/duracion-horas.mapper.ts
  (duracionHorasPrismaANumero): quita el prefijo h del literal del cliente Prisma antes de convertir;
  documenta el motivo (map 4 en BD pero literal TS con prefijo h). Fuente unica de la conversion.
- Los 3 sitios que duplicaban la logica quedan consolidados en el helper:
  - reserva-detalle-query.prisma.adapter.ts:64 -> duracionHorasPrismaANumero(fila.duracionHoras).
  - registrar-resultado-visita-uow.prisma.adapter.ts (mapper aReservaDominio) -> mismo helper.
  - presupuestos/infrastructure/cargar-reserva.prisma.adapter.ts:43 -> import del helper de reservas;
    borra su copia local aDuracionNumero.
- Boundary presupuestos->reservas: es infra->infra (adaptador de presupuestos importa un mapper de infra
  de reservas), NO infra->domain ni domain->infra. No viola hexagonal (arch/depcruise verde, 277 modulos
  sin violaciones). El helper es puro, sin dependencias de framework.
- Cobertura anadida en obtener-reserva-integracion.spec.ts:
  duracionHoras_enum_h4_se_serializa_como_numero_4 (L155, expect toBe 4), h8 (L169, toBe 8),
  null_permanece_null (L182, toBeNull). Tests significativos: fijan la traduccion al nivel del read-model.

CADENA END-TO-END verificada (payoff del fix):
GET /reservas/:id -> read-model serializa duracionHoras=4 (no null)
-> lib/datosObligatorios.ts:49 (if vacio(reserva.duracionHoras)) ya NO marca duracionHoras faltante con
   datos completos -> faltantesCliente vacio
-> RegistrarResultadoVisitaDialog.tsx:153 datosIncompletos = esReservaInmediata AND camposFaltantes>0
   = false -> boton Confirmar (L294 disabled = mutation.isPending OR datosIncompletos) HABILITADO.
El happy-path de reservar en el acto queda alcanzable desde la UI. B1 cerrado en origen (read-model).

### B2 (era Bloqueante) - RESUELTO
Codigo del 422 incoherente backend/contrato/frontend.

- Backend: registrar-resultado-visita.use-case.ts:319 -> readonly codigo = DATOS_FISCALES_INCOMPLETOS
  (antes DATOS_OBLIGATORIOS_INCOMPLETOS). Reutiliza el codigo de UC-14, documentado en L314-315.
- Contrato: docs/api-spec.yml:2427 codigo enum DATOS_FISCALES_INCOMPLETOS (schema
  PresupuestoDatosFiscalesError). SDK schema.d.ts coherente (union de respuesta 422 con ese schema).
- Frontend: useRegistrarResultadoVisita.ts:92 ramifica con cuerpo.codigo === DATOS_FISCALES_INCOMPLETOS.
- Literal coincide EXACTAMENTE en los tres. No se toco contrato/SDK/frontend (ya usaban el valor correcto);
  el fix fue alinear SOLO el backend, como pedia el patron UC-14.
- No-regresion: resultado-visita-reserva-inmediata.use-case.spec.ts:366 asevera
  expect(error.codigo).toBe(DATOS_FISCALES_INCOMPLETOS). Esta asercion sobre el string del envelope evita
  que el codigo diverja de nuevo (era el hueco de QA del primer pase, que solo asertaba la clase).

## Estado de los no bloqueantes previos

### A1 (Media) - RESUELTO
registrar-resultado-visita.use-case.ts:57 la union es ahora interesado | reserva_inmediata | descarta
(canonico del contrato/DTO). Documentado en L54 que descarta (US-011) aun no esta implementado y cae al
422 (L355). Ya no existe el literal descarte.

### A2 (Baja) - RESUELTO
Se resuelve al cerrar B2: el branch del hook (DATOS_FISCALES_INCOMPLETOS) y la doc de
lib/datosObligatorios.ts quedan coherentes con el backend. Sin codigo muerto.

### A3 (Baja) - RESUELTO
Cabecera y ApiOperation.summary de registrar-resultado-visita.controller.ts (L3-4, L65-67) y cabecera del
UoW adapter (L1-13) actualizadas a US-009 + US-010 (interesado + reserva inmediata).

## Verificacion de guardrails (OK, reconfirmados tras los fixes)

- Hexagonal: domain/maquina-estados.ts sin imports de nestjs, prisma ni infrastructure/ (dominio limpio).
  Guarda nueva esOrigenValidoParaResultadoVisitaReservaInmediata como funcion pura de dominio. El helper
  duracion-horas.mapper.ts vive en infra. arch/depcruise sin violaciones (277 modulos). OK.
- Bloqueo atomico: UPDATE RESERVA (estado=pre_reserva/subEstado=null en inmediata) + UPDATE PURO
  FECHA_BLOQUEADA + vaciado de cola A16 (ColaResultadoVisitaPrismaRepository.vaciar, updateMany 2d->2y en
  la tx) + AUDIT_LOG, todo en un unico transaction con SELECT FOR UPDATE sobre la fila bloqueante.
  All-or-nothing. Sin Redis/Redlock/locks distribuidos. OK.
- Multi-tenancy / RLS: fijarTenant(tx, tenantId) como PRIMERA operacion de la UoW; tenantId del JWT, nunca
  del path/body; queries filtran tenant_id. OK.
- Maquina de estados declarativa: ORIGENES_TRANSICION_RESULTADO_VISITA_RESERVA_INMEDIATA como tabla de
  datos + guarda some(), sin if/else dispersos. Origen invalido -> 422. OK.
- Arrow functions: helpers y componentes con arrow; metodos de clase NestJS exentos. OK.
- Importes Decimal: sin Float en importes; el read-model serializa Decimal(10,2) a string con toFixed(2).
  Los Number afectados son enum de duracion/contadores, no dinero. OK.
- SDK generado: schema.d.ts regenerado desde el contrato (diff coherente con el YAML), no editado a mano. OK.
- Contrato coherente con implementacion: codigo del 422, camposFaltantes y transicion concuerdan entre
  backend, api-spec.yml y frontend. OK.
- Responsive (frontend): componentes tocados (dialog, aviso, acciones) sin anchos px fijos que rompan en
  movil; sin sidebar rigido. Evidencia en 3 viewports (390/768/1280) en el report E2E Playwright
  (2026-07-03-step-N+3-e2e-playwright.md, tests 6-9 PASS). OK.

## Contexto de suite considerado

- Specs dirigidas (obtener-reserva-integracion + resultado-visita-reserva-inmediata*): 71/71 verde, sin
  regresion US-009.
- Suite reservas+presupuestos: 705 pass, 1 fail = flaky PREEXISTENTE de US-004 (deadlock 40P01,
  documentado en memoria), pasa en aislado. NO es regresion de US-010; no se trata como bloqueante.
- lint verde, typecheck verde (reconfirmado en este pase: tsc --noEmit exit 0), arch (depcruise) sin
  violaciones.
- El report E2E del primer pase (test 5) menciona el sintoma de B1 (aviso muestra solo duracionHoras, bug
  pre-existente read-model): corresponde al estado PRE-fix; el fix de B1 lo cierra en origen (verificado
  por los nuevos tests de read-model h4->4 / h8->8 y por la cadena UI descrita).

## Conclusion

Los dos bloqueantes del primer pase (B1 read-model duracionHoras y B2 codigo del 422) estan RESUELTOS
dentro del change, con tests que fijan la no-regresion. Los tres no-bloqueantes (A1, A2, A3) tambien. La
cadena end-to-end del happy-path de reserva inmediata queda desbloqueada y verificada. Los guardrails
duros se mantienen. No queda ningun bloqueante.

Veredicto: APTO
