# Code review - documentos-enviar-factura-senal-e3 (6.4b - Bloque C)

Change: documentos-enviar-factura-senal-e3 (epico 6, rebanada 6.4b - Bloque C)
Fecha: 2026-07-15
Branch: feature/documentos-enviar-factura-senal-e3 (working tree, sin commitear)
Revisor: code-reviewer (solo lectura; NO aplica fixes)
Alcance: diff vs master - backend facturacion (use-case, adapters, modulo, controller, DTO), catalogo de plantillas E3, contrato OpenAPI y SDK regenerado, frontend feature facturacion.

---

## Resumen del veredicto

Implementacion limpia y consistente con el espejo E4 (aprobar-y-enviar-liquidacion). Guardrails duros (hexagonal, no-lock-distribuido, multi-tenancy/RLS, contrato generado, Decimal, responsive) todos OK. Los dos puntos del hallazgo de QA son codigo muerto / escenario inalcanzable documentado, NO defectos que muten estado ni rompan el flujo real de 6.4b. Se clasifican como Media y no bloquean el cierre.

---

## Hallazgos por severidad

### Bloqueantes
- (ninguno)

### Alta
- (ninguno)

### Media

- [coherencia spec-codigo - guarda rechazada es codigo muerto]
  Ubicacion: apps/api/src/facturacion/application/enviar-factura-senal.use-case.ts:354.
  La guarda (if senal.estado === rechazada -> FacturaSenalNoEnviableError 409) es INALCANZABLE en produccion. El enum Prisma EstadoFactura solo tiene borrador|enviada|cobrada (apps/api/prisma/schema.prisma:133) y el mapper senal-emision-repository.prisma.adapter.ts:51 castea la fila directamente (fila.estado as EstadoSenalEmitible), por lo que rechazada nunca emerge de la BD. El rechazo de US-022 no transiciona el estado (solo AUDIT_LOG); una senal rechazada por el gestor PERMANECE en borrador y SI seria enviable por este endpoint. La guarda queda cubierta solo por el spec unitario (3.4) con dobles, no por ninguna lectura real.
  Regla violada: maquina de estados declarativa + coherencia contrato/dominio; camino de codigo muerto.
  Recomendacion: (a) documentar en spec-delta/design.md (D-guarda-estado) que rechazada es un estado logico NO materializado hoy (guarda defensiva), o (b) si el producto exige impedir el envio de una senal rechazada, modelar el rechazo con una marca real persistida y cablear la lectura. No aplicar fix en 6.4b si se opta por (a).

- [coherencia spec-codigo - escenario E3 fallido previa a reintento inalcanzable + riesgo P2002]
  Ubicacion: enviar-factura-senal.use-case.ts:359-363 y senal-emision-repository.prisma.adapter.ts:126-164.
  design.md (D-idempotencia, lineas 123-124) declara que una COMUNICACION E3 fallido previa NO bloquea y permite reintento. En 6.4b es INALCANZABLE: el adaptador DIRECTO (EnviarE3EmisionAdapter) solo persiste E3 enviado tras confirmar el envio y hace rollback total ante fallo, por lo que nunca deja una fila fallido (es_reenvio=false). Ademas, si existiera, crear escribe siempre con esReenvio=false, colisionando con el indice unico PARCIAL uq_comunicacion_reserva_codigo (reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio=false (schema.prisma:645-649) -> P2002 -> 10 reintentos de numeracion -> 500.
  Regla violada: coherencia contrato/design vs implementacion; idempotencia por indice unico (patron correcto, sin locks distribuidos).
  Recomendacion: corregir spec-delta/design.md (D-idempotencia) marcando fallido a reintento como N/A para el adaptador directo de esta rebanada. Si a futuro un flujo por MOTOR pudiera dejar un fallido E3, endurecer ComunicacionSenalEmisionPrismaRepository.crear a un upsert sobre la clave parcial (o marcar es_reenvio=true). No aplicar cambio de codigo en 6.4b. Coincide con reports/2026-07-15-step-N+2-curl-endpoint-tests.md (seccion 3).

### Baja

- [docs/tasks] tasks.md 9.1 (docs-keeper) sigue sin marcar; el flujo de facturacion/comunicaciones E3 y el roadmap 6.4b del epico 6 deben actualizarse antes del archive. No es competencia del code-review.
- [nomenclatura menor] EnviarE3EmisionAdapter devuelve idComunicacion vacio (el use-case crea la COMUNICACION). Intencional y consistente con E4; opcional documentar el centinela o tiparlo como opcional. No bloquea.

---

## Checklist de guardrails - OK

- Hexagonal: el use-case importa SOLO type de ../domain/factura; sin @nestjs ni @prisma. Puertos como interfaces en el use-case, adaptadores Prisma en infrastructure/, wiring por tokens (Symbol). Cumple no-infra-in-domain.
- Bloqueo atomico / sin locks distribuidos: cero Redis/Redlock/timers. Atomicidad estado-E3 en una unica transaccion Prisma con fijarTenant (RLS); el envio E3 vive DENTRO de la tx y su fallo produce rollback total. Concurrencia de numeracion via reintento aplicativo ante P2002 (indice unico). Espejo fiel de E4.
- Multi-tenancy / RLS: tenantId SIEMPRE del JWT (usuario.tenantId, controller:388); el path solo aporta reservaId. CargarReservaSenalEmisionPrismaAdapter y la UoW abren transaccion + fijarTenant(tx, tenantId); lectura filtra por tenantId y RLS oculta cross-tenant (integracion: 404). Sin tenant de path/body.
- Contrato generado: docs/api-spec.yml anade el path + EnviarFacturaSenalRequest (body vacio), EnviarFacturaSenalResponse (factura, condPartEnviadasFecha, condPartAdjuntada) y FacturaSenalEnvioError (envelope + codigo enum). El SDK schema.d.ts refleja esos simbolos (regenerado, NO editado a mano). DTO backend cuadran 1:1; codigos de error coinciden con el use-case y su mapeo en aHttp (404/409/409/502).
- Importes en Decimal: mapper usa Prisma.Decimal + toFixed(2) a string; sin Float/number.
- DTOs validados / errores en espanol: DTOs con @ApiProperty; mensajes y clases de dominio en espanol.
- Arrow functions: helpers y adaptadores como arrow; metodos de clase Nest exentos. Nomenclatura en espanol.
- Frontend Bulletproof / responsive: feature facturacion/ con segmentos api/components/lib/model y barrel index.ts; nuevos .tsx (EnvioFacturaSenal, AvisoErrorEnvioSenal) en components/, hook/normalizador/tipos en api/ y model/ (regla components solo .tsx). Hook consume el SDK generado. Mobile-first: boton w-full en movil, sm:w-auto, tactil h-11, sin overflow; 3 viewports (390/768/1280) en step-N+3-e2e-playwright.md.
- Tests primero (TDD): RED previos; unit 392/392 (28 casos del use-case), integracion real 5/5, E2E OK.

---

## Veredicto: APTO

Los dos hallazgos Media son deuda de coherencia spec-codigo sobre caminos INALCANZABLES en el flujo real de 6.4b (guarda rechazada como codigo muerto; escenario fallido a reintento inaplicable con el adaptador directo y en conflicto con el indice unico parcial). No mutan estado, no rompen el contrato ni los guardrails duros, y estan cubiertos por dobles unitarios. Recomendacion: corregir spec-delta/design.md (D-guarda-estado y D-idempotencia) y dejar como deuda el upsert de crear para un futuro flujo por motor. No procede fix de codigo en 6.4b. No hay Bloqueante -> apto para merge tras el gate humano final y la actualizacion de docs (9.1).
