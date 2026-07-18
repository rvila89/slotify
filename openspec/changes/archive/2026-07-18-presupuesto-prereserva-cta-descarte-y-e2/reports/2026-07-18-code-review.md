# Informe de code-review — presupuesto-prereserva-cta-descarte-y-e2

- Fecha: 2026-07-18
- Revisor: code-reviewer (solo lectura; NO aplica fixes)
- Rama: feature/presupuesto-prereserva-cta-descarte-e2 vs master
- Nota: todo el diff esta en el working tree (sin commitear). Revisado contra HEAD (=tip de master). 47 ficheros, 3 workstreams sobre pre_reserva.

## Workstreams revisados
- A - Frontend presentacional: reordena AccionesPreReserva.tsx (Confirmar pago de senal PRIMERO, verde accent-success; Editar presupuesto debajo en brand-primary; descarte al final, outline no-verde) y pinta el boton Confirmar de ConfirmarSenalDialog.tsx en verde accent-success.
- B - Back+front descarte pre_reserva: transicion pre_reserva -> reserva_cancelada REUTILIZANDO POST /reservas/{id}/descartar via un use-case orquestador que despacha por fase; UoW atomica (SELECT ... FOR UPDATE + liberarFecha() + promocion de cola + AUDIT_LOG con motivo opcional); errores 404/409/422. UI: guarda en lib/, dialogo con motivo opcional, hook que consume el endpoint reutilizado del SDK.
- C - Backend E2 + fix Resend: activa la plantilla E2 (render real, adjuntosRequeridos [presupuesto], sale de CODIGOS_DIFERIDOS) y arregla el fallido de Resend: URL del almacen local (localhost) inalcanzable, se resuelve a bytes y se envia como content Buffer.

## Hallazgos

### Bloqueantes
- Ninguno. Los guardrails duros se respetan (ver Escrutinio). No hay motivo de bloqueo de merge por arquitectura/seguridad.

### Altos
- [H-1] (proceso/contrato) E2E y verificacion end-to-end de C sin ejecutar (evidencia ausente). QA dejo BLOQUEADOS curl, E2E Playwright y la verificacion end-to-end del fix de Resend (reports/2026-07-18-qa-summary.md, PUNTO DE MAYOR RIESGO). Consecuencias:
  - El bug original (E2 fallido) solo esta cubierto por unit tests del adaptador; su correccion real (PDF como Buffer alcanzable por Resend con el stack completo) NO se ha confirmado end-to-end.
  - Responsive (checklist #12): no hay evidencia en los 3 viewports (390/768/1280); el guion existe pero no se ejecuto (reports/e2e-screenshots/ vacio). El codigo es mobile-first por inspeccion (botones w-full en <sm, Dialog shadcn/Radix, pie que apila en <sm), pero falta la evidencia que el checklist exige.
  - Recomendacion: levantar la API del worktree y ejecutar los guiones N+2/N+3 y la verificacion C con EMAIL_TRANSPORT=fake/resend-sandbox antes de mergear, o aceptar explicitamente el riesgo residual.

### Medios
- [M-1] (contrato) Drift del campo code del 422 entre spec y backend. El schema DescartarReservaOrigenInvalidoError (docs/api-spec.yml L7040-7053 y schema.d.ts) declara code con enum [origen_invalido], pero el backend emite code = transicion_no_permitida: DescartePreReservaOrigenInvalidoError.codigo es transicion_no_permitida (descartar-prereserva.use-case.ts:100) y el controller reenvia code: error.codigo (descartar-consulta.controller.ts rama 422). El cuerpo 422 real NO cumple el enum documentado. Impacto acotado: el hook useDescartarPreReserva ramifica por HTTP status 422, no por code, asi que la UI no se rompe; pero es divergencia contrato-implementacion. Recomendacion: unificar. Preferible cambiar el codigo del error del backend a origen_invalido (cambiar el enum del contrato a transicion_no_permitida haria 409 y 422 indistinguibles por code).

### Bajos
- [B-1] (frontend) Mensaje del 409 divergente entre lib y backend. descartarPreReserva.ts:27 define el fallback como no puede descartarse mientras el backend devuelve no puede modificarse (DescartePreReservaEstadoTerminalError). Es solo fallback (el hook usa el mensaje del servidor primero), sin impacto funcional; unificar el copy por coherencia.
- [B-2] (consistencia) catalogo-plantillas.ts supera 300 lineas (352 fisicas). NO es violacion de regla dura: max-lines <=300 solo esta configurado en apps/web/eslint.config.js (con skipBlankLines+skipComments), no en apps/api. Con comentarios/blancos descontados queda muy por debajo. Se anota como consistencia, no como bloqueo.

### OK verificado
- Multi-tenancy: todas las queries nuevas filtran por tenant_id y fijan RLS (fijarTenant(tx, tenantId) como PRIMERA op de cada tx en la UoW y en el lector); el tenant viene del JWT (comando), nunca del path/body.
- Errores en espanol; nombres en espanol (PascalCase/camelCase/kebab-case).
- DTO reutilizado (DescartarConsultaRequestDto, ya validado con class-validator en US-013); motivo opcional. Sin importes (no aplica Decimal/Float en este change).
- Cliente HTTP: solo se regenero schema.d.ts; client.ts e index.ts sin diff (no editado a mano).
- TS strict, sin any injustificado.

## Escrutinio prioritario

1. Guardrails duros - OK.
   - Hexagonal: el unico fichero de domain/ tocado (maquina-estados.ts) no importa @nestjs, @prisma ni infrastructure/; anade guarda declarativa pura. Los casos de uso de application/ dependen solo de puertos (DescartePreReservaUoWPort, EstadoReservaLectorPort); Prisma/Nest solo en infrastructure/.
   - Bloqueo de fecha: SOLO via liberarFecha() (mecanica SELECT ... FOR UPDATE + DELETE sobre fecha_bloqueada con UNIQUE(tenant_id, fecha)); promocion de cola reutiliza PromocionColaPort.promoverPrimeroEnCola (US-018). Grep confirma cero Redis/Redlock/ioredis en el diff.
   - Maquina de estados: tabla declarativa ORIGENES_TRANSICION_DESCARTAR_PRERESERVA + esOrigenValidoParaDescartarPreReserva(), mono-origen; sin if/else de negocio (el orquestador enruta por estado, no evalua guardas dispersas). Origen invalido -> 422; terminal/carrera -> 409.
   - Arrow-functions: sin function declarativo en los ficheros nuevos (metodos de clase Nest exentos). components/ solo .tsx: la guarda y constantes viven en lib/descartarPreReserva.ts.
   - max-lines <=300 (web): todos los .tsx/.ts de apps/web nuevos muy por debajo.

2. D-2 orquestador - OK.
   - No rompe US-013: la rama consulta delega intacta en DescartarConsultaPorClienteUseCase (->2z); el comportamiento 2z no se toca.
   - Contrato del endpoint reutilizado intacto: misma firma HTTP, mismo body { motivo? }, Roles(gestor), tenant del JWT; solo se amplia la semantica (documentada en api-spec.yml).
   - Mapeo de errores en el controller: 404 (ReservaNoEncontrada), 409 (EstadoTerminal), 422 (OrigenInvalido). Correcto salvo el drift de code del 422 (M-1).
   - Cualquier estado que no sea consulta/pre_reserva -> 422 sin invocar hijos.

3. Atomicidad/concurrencia - OK.
   - Re-guarda BAJO el lock: dentro de la tx, SELECT ... FOR UPDATE de la fila RESERVA y re-evaluacion de esOrigenValidoParaDescartarPreReserva; terminal->409, otro->422, rollback sin efectos.
   - Liberacion + promocion exactamente-una-vez: liberarFechaEnTx dentro de la tx; la promocion A15 se dispara POST-COMMIT una sola vez cuando hay cola (mismo patron que US-013/US-018). El test de concurrencia C-1/C-2 (Promise.allSettled) prueba 1 ganador / 1 rechazado, 1 sola transicion en AUDIT_LOG, <=1 fila FECHA_BLOQUEADA, y promocion de la cola exactamente una vez.
   - Rollback total: la UoW no atrapa errores; cualquier fallo de un paso revierte toda la tx.

4. D-1 + fix Resend - SEGURO.
   - El camino localhost -> content Buffer MANTIENE las restricciones de seguridad: rutaLocalDeUrlAlmacen() deriva la clave de la URL del almacen y hace path.resolve(almacenDir, clave), pero la validacion real vive centralizada en leerPdfLocal(): rechaza cualquier ruta que no empiece por almacenDir+sep (o sea exactamente almacenDir) y exige extension .pdf. Un ../ en la URL (p. ej. .../almacen/../../etc/passwd.pdf) se resuelve fuera del dir y leerPdfLocal() lanza -> NO hay arbitrary file read. El percent-encoding no se decodifica, asi que tampoco traversa. Los tres caminos (almacen local -> Buffer; URL cloud publica -> path; path local FS -> Buffer con guarda) quedan cubiertos.
   - Riesgo del adjunto requerido (D-1): el bloqueo por PDF ausente es OBSERVABLE y REINTENTABLE, no silencioso - el motor no crea COMUNICACION enviada (adjunto_no_disponible) y la idempotencia (reserva_id, E2) permite reintento cuando el PDF exista. No se envia un E2 sin presupuesto.

5. Tests editados en GREEN - LEGITIMOS (no debilitamiento).
   - catalogo-plantillas.spec.ts: sacar E2 de E_DIFERIDOS es coherente con activarla (su activacion se prueba en catalogo-plantillas-e2.spec.ts, 6 tests). Correcto.
   - activar-prereserva-integracion.spec.ts (3.11): pasa de E2 registrada (len 1) a E2 NO registrada (len 0). Es reflejo REAL del nuevo comportamiento D-1 (adjunto requerido): en Jest, react-pdf degrada el PDF a null (flakiness ESM conocida) y el motor bloquea el E2 sin PDF. El commit de la pre_reserva sigue verificandose (post-commit, no revierte). NO es un debilitamiento para pasar el test; el camino feliz (PDF presente => E2 con adjunto y render real) SI esta cubierto en despachar-email-e2.service.spec.ts con catalogo real + PDF https + FakeEmailAdapter.
   - descartar-prereserva-concurrencia.spec.ts: el seed usa ttl_expiracion = NULL para satisfacer la constraint chk_firme_sin_ttl (bloqueo firme). Es una adecuacion legitima al esquema, no un relajamiento de aserciones (las aserciones exactamente-una-vez se mantienen estrictas).

6. Cobertura del bug original E2 - RIESGO RESIDUAL (ver H-1). El comportamiento del adaptador (localhost->Buffer) esta cubierto por unit tests, pero la correccion real del fallido con el stack completo (react-pdf real + Resend real/sandbox) NO se verifico (bloqueo de entorno de QA). Es el punto de mayor riesgo del change y motiva la reserva del veredicto.

## Conclusion
Arquitectura, atomicidad/concurrencia y seguridad del path del adjunto: correctos, sin bloqueantes. Quedan (a) un drift menor de code en el 422 (M-1), (b) la verificacion end-to-end del fix de Resend y (c) la evidencia responsive en 3 viewports - ambos (b)(c) bloqueados por entorno en QA, no por el codigo. Apto para merge condicionado a cerrar la verificacion end-to-end de C y la evidencia E2E/responsive (o a aceptar explicitamente ese riesgo), y a alinear el code del 422.

Veredicto: APTO CON RESERVAS
