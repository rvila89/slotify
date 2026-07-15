# Code review — US-024 Registrar Firma de Condiciones Particulares

- Change: firma-condiciones-particulares-us024
- Branch: feature/firma-condiciones-particulares-us024 (working tree, sin commitear)
- Revisor: code-reviewer (revision de solo lectura, sin fixes). Fecha: 2026-07-15
- Alcance del veredicto: revision estatica (tsc + eslint) + lectura de unit tests.
  La validacion con BD real (integracion / concurrencia / E2E / curl) queda PENDIENTE
  para la sesion principal (los subagentes no tienen Postgres): no bloqueante, pero se senala.

---

## Veredicto: APTO

No hay hallazgos Bloqueantes ni de severidad Alta. El diff respeta los guardarrailes duros
de Slotify. Quedan observaciones menores (no bloqueantes) y la verificacion con BD real pendiente.

---

## Verificacion estatica ejecutada

- tsc --noEmit en apps/api: OK (exit 0)
- tsc --noEmit en apps/web: OK (exit 0)
- eslint sobre ficheros US-024 backend: OK (exit 0)
- eslint sobre features/condiciones-firmadas + FichaConsultaPage.tsx: OK (exit 0; solo warnings
  pre-existentes del plugin boundaries, ajenos a US-024)
- Regeneracion del SDK (generate-client.mjs) vs schema.d.ts commiteado: identico ignorando
  CRLF/LF -> el cliente NO esta editado a mano.

---

## Guardrails verificados

1. Hexagonal / DDD — OK. El use-case registrar-firma-condiciones.use-case.ts depende SOLO de
   puertos inyectados; no importa @nestjs ni @prisma. Importa solo maquina-estados (dominio puro)
   y tipos. La guarda esEstadoValidoParaRegistrarFirmaCondiciones vive en el dominio sin framework.
   Adaptadores Prisma y de almacen en infrastructure/. Hook no-infra-in-domain: sin violaciones.

2. Bloqueo atomico / no lock distribuido — OK (N/A). US-024 no bloquea fecha. No se introduce
   Redis/Redlock/ioredis/lock distribuido. Los matches de Redis en confirmacion/ son de US-021
   pre-existente y comentarios, no de US-024.

3. Multi-tenancy / RLS — OK. tenantId y usuarioId derivan SIEMPRE del JWT (@CurrentUser), nunca
   del path/body. La lectura abre tx + fijarTenant como primera operacion y filtra por tenantId
   en el where; cross-tenant -> null -> 404. La UoW fija RLS como primera operacion de la tx. La
   clave de almacen incluye el tenant: condiciones-firmadas/{tenantId}/{reservaId}/{uuid}.{ext}.

4. Maquina de estados — OK. No se anade ninguna transicion al grafo. Tabla declarativa
   ESTADOS_VALIDOS_REGISTRAR_FIRMA_CONDICIONES + guarda de precondicion, analoga a
   ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE (US-006), sin if/else dispersos. AUDIT_LOG accion=actualizar
   (AccionAudit.actualizar), NUNCA transicion. marcarFirmada solo toca condPartFirmadas +
   condPartFirmadasFecha, no estado ni sub-procesos. Estado invalido -> EstadoInvalidoError -> 422.

5. Contrato / SDK — OK. docs/api-spec.yml coherente: POST /reservas/{id}/condiciones-firmadas
   (multipart, campo condicionesFirmadas, operationId registrarCondicionesFirmadas); schemas
   RegistrarCondicionesFirmadasResponse, CondicionesFirmadasValidacionError (422: ESTADO_INVALIDO /
   CONDICIONES_REQUERIDAS / FORMATO_NO_PERMITIDO / TAMANO_EXCEDIDO), CondicionesFirmadasConflictoError
   (409: CONDICIONES_NO_ENVIADAS). Naming del wire correcto: condPartFirmadas + condPartFechaFirma
   (NO condPartFirmadasFecha). schema.d.ts regenerado identico al contrato -> protect-generated-client
   no se viola. El hook frontend consume el SDK generado; tipos derivados de components[schemas].

6. Sin cron / FA-01 — OK. No hay cron ni logica de dia-de-evento. Design D-fa01-alcance: senal
   consultable SI (debeMostrarSeccionCondiciones, MENSAJE_FIRMA_PENDIENTE), cron NO (es UC-23). No
   hay @Cron, setInterval, endpoint de barrido ni logica de UC-23.

7. Arrow functions — OK. Todo helper/factory/componente/hook es arrow function. Los async metodo()
   son metodos de clase NestJS/repositorios tx-bound (exentos). ESLint pasa.

8. Frontend (Bulletproof React + responsive) — OK. features/condiciones-firmadas/ con api/
   components/ lib/ model/ + barrel index.ts (unica API publica); FichaConsultaPage importa por
   barrel. components/ SOLO .tsx; helpers en lib/, tipos en model/. max-lines <=300 (max 258).
   Mobile-first: w-full en movil + sm:w-auto, footer flex-col sm:flex-row, dialog overflow-y-auto,
   targets h-12 (>=48px), sin anchos px fijos. No edita el cliente generado.

9. Atomicidad — OK. Guardas (404/409/422/422) ANTES de subir fichero y abrir tx -> rechazos previos
   sin efectos. Subida fisica fuera de la tx (a lo sumo binario huerfano, nunca DOCUMENTO sin RESERVA
   marcada). Crear DOCUMENTO + marcar RESERVA + AUDIT_LOG en UNA sola $transaction; fallo propaga y
   revierte (all-or-nothing). Re-firma no idempotente correcta (crear sin buscar, conserva historico).

10. Calidad general — OK. Errores de dominio tipados en espanol con codigo; mapeo HTTP 404/409/422.
    DTO multipart documentado para Swagger. Sin any injustificado (los casts del hook y de
    Prisma.InputJsonValue estan comentados y son patron del proyecto). Sin secretos. Coherente con
    US-021 (patron multipart) y US-023 (reutiliza DocumentoPrismaAdapter.crear; DOCUMENTO original
    permanece). Importes N/A.

---

## Observaciones no bloqueantes

- NB-1 (Media) Evidencia responsive en 3 viewports: codigo correcto mobile-first, pero falta captura
  390/768/1280 en el diff. Adjuntar capturas E2E en reports/e2e-screenshots/ en el QA (no bloquea).
- NB-2 (Baja) Serializer identidad del multipart: patron necesario para el boundary; confirmar en QA
  real que el Content-Type sale correcto (no validable en estatico).
- NB-3 (Baja) Deuda TZ pre-existente en formatearFechaHora (toLocaleString es-ES); no introducida por
  US-024 y no afecta al dato persistido.
- NB-4 (Baja) marcarFirmada filtra solo por idReserva; SEGURO por RLS (fijarTenant primera op de la
  tx), mismo patron que US-021/US-023. Confirmar en test de integracion RLS real.

---

## Pendiente (no bloqueante para este veredicto)

- Suite unit/integracion/concurrencia contra Postgres real.
- QA E2E (Playwright) en 3 viewports con capturas.
- Verificacion curl del endpoint (200/409/422/404) con datos activos.
- Correr desde la sesion principal (Docker/Postgres) antes de archive/PR. El APTO cubre estatica + unit.

---

Veredicto: APTO
