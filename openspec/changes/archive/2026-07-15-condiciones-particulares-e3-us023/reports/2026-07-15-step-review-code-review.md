# Code review — condiciones-particulares-e3-us023 (US-023, GAP 1/2/3)

Fecha: 2026-07-15
Revisor: code-reviewer (solo lectura)
Alcance: diff completo del change (backend prod + tests + contrato + SDK + frontend).

Veredicto: APTO

Resumen: los 3 gaps están implementados fielmente a `design.md`, con hexagonal limpio,
atomicidad estado-E3 correcta en el primer envío (GAP 1/2 dentro de la misma unidad de
trabajo), idempotencia por reserva+tipo, endurecimiento de condiciones (409
CONDICIONES_NO_CONFIGURADAS) y reenvío dedicado (GAP 3) con es_reenvio=true. Contrato y SDK
consistentes; el cliente generado NO se editó a mano (regeneración determinista comprobada).
Tests unitarios verdes (49 back + 12 front). Sin locks distribuidos ni Redis. Convenciones y
multi-tenancy/RLS respetadas.

## Bloqueantes
Ninguno.

## No bloqueantes
- [atomicidad-reenvio] `reenviar-e3.use-case.ts` orquesta el reenvío (GAP 3) llamando a
  puertos independientes (`registrarComunicacion`, `fijarCondicionesEnviadas`,
  `registrarAuditoria`), y cada adaptador en `reenvio-comunicacion.prisma.adapter.ts`
  (l.101-172) abre su PROPIO `$transaction`. Es decir, el reenvío NO es una única unidad de
  trabajo all-or-nothing: si `fijarCondicionesEnviadas` o `registrarAuditoria` fallan tras
  registrar la COMUNICACION, no hay rollback conjunto. La descripción del contrato
  (`docs/api-spec.yml` l.1950 "En una única unidad de trabajo (tx + RLS)... all-or-nothing")
  y `design.md §Atomicidad` (l.181) sobrevenden la garantía frente a lo implementado.
  No es bloqueante porque: (a) el envío del proveedor (paso crítico, único con efecto externo)
  SÍ va primero y su fallo aborta antes de tocar BD; (b) es un espejo EXACTO del patrón vivo y
  ya aceptado de E4 (`reenviar-liquidacion.use-case` + `RegistrarComunicacionReenvioPrismaAdapter`,
  mismo esquema de transacciones separadas). Recomendación: alinear la redacción del contrato/
  design con la realidad (transacciones separadas post-envío) o, si se quiere la garantía
  literal, envolver los 3 escritos post-envío en una UoW como en el primer envío (GAP 1).

- [barrel] `AccionReenviarE3`/`AvisoErrorReenvioE3` no se exportan en el barrel
  `features/facturacion/index.ts`. Es correcto porque se consumen solo internamente desde
  `EnvioFacturaSenal.tsx` (l.5, l.98), que sí es público. Solo se señala para dejar constancia
  de que la co-localización es intencional (no hay import cross-feature de archivo interno).

## Observaciones (OK verificados)
- Hexagonal: `documento.repository.port.ts` y ambos use-cases (`enviar-factura-senal`,
  `reenviar-e3`) sin imports de `@nestjs`/`@prisma`/`infrastructure`/`react-pdf`. Prisma solo en
  adaptadores. Hook `no-infra-in-domain` respetado.
- Atomicidad GAP 1/GAP 2 (primer envío): la creación del DOCUMENTO y el endurecimiento de
  condiciones viven DENTRO de la misma tx que el envío E3 (`SenalEmisionUoWPrismaAdapter`
  inyecta `DocumentoPrismaAdapter(tx)`). `null` -> CondicionesNoConfiguradasError (409) ANTES de
  enviar E3; render que lanza -> EmisionEnvioFallidoError (502); ambos con rollback total. Sin
  DOCUMENTO huérfano (test 3.2 y adaptador tx-bound).
- Sin locks distribuidos/Redis; idempotencia por UNIQUE parcial + reintento P2002
  (`esColisionUnicidad`, MAX_REINTENTOS_NUMERACION). Hook `no-distributed-lock` respetado.
- Idempotencia DOCUMENTO: `buscarPorReservaYTipo` antes de `crear`; si existe se reutiliza sin 2a
  fila ni 2o AUDIT_LOG (tests GREEN). Reenvío GAP 3 crea COMUNICACION es_reenvio=true (esquiva el
  UNIQUE parcial) sin re-emitir factura ni transicionar la reserva ni duplicar DOCUMENTO.
- Multi-tenancy/RLS: controller toma tenant/usuario del JWT (@CurrentUser), nunca del path/body;
  adaptadores fijan `fijarTenant(tx)` y filtran por tenantId; cross-tenant -> 404
  (FacturaSenalNoEncontradaError). El adaptador de DOCUMENTO filtra tenant_id por defensa en
  profundidad además de RLS.
- Contrato: nuevo path `POST /reservas/{id}/facturas/senal/reenviar` (operationId reenviarE3),
  ReenviarE3Response y códigos de error (E3_NO_ENVIADO_PREVIAMENTE, CONDICIONES_NO_CONFIGURADAS,
  EMISION_ENVIO_FALLIDO) coherentes con controller/DTO. El SDK
  `apps/web/src/api-client/schema.d.ts` COINCIDE byte a byte con la regeneración desde
  `docs/api-spec.yml` (openapi-typescript) -> no editado a mano. Hook `protect-generated-client`
  respetado.
- Convenciones: arrow functions en helpers/adaptadores/frontend (métodos de clase Nest exentos);
  frontend `components/` solo `.tsx` (helpers en `api/`, tipos en `model/`); barrel de feature;
  español en dominio/errores/mensajes; UI mobile-first (botón w-full <sm, h-11 táctil, sin
  overflow), tokens del proyecto.
- Importes: se conservan como string Decimal(10,2) (total.toFixed(2), IMPORTE_PATTERN en DTOs);
  ningún Float.
- Tests RED->GREEN cubren los 3 gaps sin aserciones debilitadas:
  - GAP 1: persistir DOCUMENTO + AUDIT_LOG crear; idempotencia (no 2a fila/2o audit); no huérfano
    tras fallo E3; dentro de una única UoW.
  - GAP 2: null -> 409 con rollback (no E3, no emitir, no fecha, no DOCUMENTO); render que lanza ->
    502 con rollback; camino feliz endurecido (2 adjuntos, condPartAdjuntada=true).
  - GAP 3: nueva COMUNICACION es_reenvio=true, reutiliza documentos (no regenera/duplica),
    actualiza cond_part_enviadas_fecha, no expone puertos de emisión/renumeración/transición;
    rollback si el proveedor falla; sucesivos reenvíos esquivan el UNIQUE parcial; guardas 409/404.
  - Ejecutados: `jest enviar-factura-senal.use-case.spec + reenviar-e3.use-case.spec` = 49/49
    verdes; `vitest normalizarErrorReenvioE3 + AccionReenviarE3` = 12/12 verdes; ESLint sin
    errores (back y front).
  - Nota: los specs de integración (`*-integracion.spec.ts`) requieren Postgres real (RLS,
    siembra Prisma, cross-tenant, no-duplicación de DOCUMENTO). Existen y son significativos; su
    ejecución/evidencia corresponde a QA en la sesión con BD.

Veredicto: APTO
