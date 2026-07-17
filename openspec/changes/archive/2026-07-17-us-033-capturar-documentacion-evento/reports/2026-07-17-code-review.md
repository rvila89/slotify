# Code review — US-033 Capturar documentacion obligatoria del evento

- Fecha: 2026-07-17
- Revisor: code-reviewer (solo lectura, sin auto-fix)
- Rama: feature/us-033-capturar-documentacion-evento vs master
- Alcance: backend documentacion-evento/ (nuevo) + generalizacion puerto DOCUMENTO
  (US-023/024), maquina-estados.ts, contrato api-spec.yml, SDK regenerado,
  feature frontend documentacion-evento/ + refactor FichaConsulta.

## Resumen ejecutivo
Implementacion limpia y coherente con los guardrails duros de Slotify. Hexagonal
respetado, RLS/tenant desde JWT en todas las rutas, transaccion all-or-nothing,
contrato <-> backend casan 1:1 (codigos 422 y rutas), SDK generado sin edicion manual,
frontend mobile-first con estructura por dominio. No hay hallazgos bloqueantes ni
mayores. Se registran hallazgos menores/nit sobre laxitud de tipos y una justificacion
de diseno inexacta (sin impacto funcional).

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Mayores
- Ninguno.

### Menores
1. [tipos/documento-repo] listarPorReservaYTipos declarado OPCIONAL en
   documentos/domain/documento.repository.port.ts. La justificacion del comentario
   ("para no romper el fake de enviar-factura-senal.use-case.spec.ts") es INEXACTA:
   ese spec define su PROPIA interfaz local DocumentoRepositoryPort
   (facturacion/__tests__/enviar-factura-senal.use-case.spec.ts:70), no importa el puerto
   real, luego hacer el metodo obligatorio NO lo romperia. El unico consumidor real del
   puerto que no lista es el adaptador de idempotencia de US-023, que podria convivir con
   un metodo obligatorio ya implementado por el adaptador Prisma. Recomendacion: valorar
   hacerlo obligatorio y corregir el comentario. No bloqueante: el consumidor de US-033 lo
   invoca sobre un adaptador que si lo provee y los tipos garantizan su presencia.

2. [tipos/proyeccion] DocumentoEventoPersistido.reservaId/tenantId opcionales
   (application/subir-documento-evento.use-case.ts:79-89). Es solo laxitud de tipos en la
   proyeccion de respuesta: el aislamiento NO depende de estos campos; lo garantizan RLS
   (fijarTenant como primera op. de cada tx) y el filtrado explicito por tenant_id en el
   adaptador. crear siempre los rellena; el listado del checklist ya viene acotado a la
   reserva/tenant. Sin riesgo de fuga cross-tenant. Recomendacion: si se quiere endurecer,
   marcarlos requeridos en la proyeccion de crear. Menor.

### Nits
3. [defaults] En la generalizacion del adaptador, aDocumentoPersistido devuelve el tipo
   REAL de la fila (ya no hardcodea condiciones_particulares) y fechaCreacion real. El
   fallback de nombreArchivo paso de condicions-particulars.pdf a documento; US-033 siempre
   envia nombreArchivo, asi que el default no se alcanza en esta ruta. Sin impacto. Nit.
4. [proyeccion] aDocumentoEventoPersistido (UoW) y el mapeo de
   ListarDocumentosEventoPrismaAdapter usan (?? new Date(0)) / (?? 0) como defensa por si el
   puerto devolviera opcionales sin rellenar. Inalcanzable con el adaptador Prisma (siempre
   selecciona los campos), es puro guard de tipos. Nit.

## Verificacion por guardrail

- Hexagonal: OK. application/ y domain/ NO importan @nestjs/* ni @prisma/*. El union
  TipoDocumentoDominio se declara en dominio sin importar el enum Prisma; el adaptador es
  quien mapea a TipoDocumentoPrisma. Puertos puros inyectados por token (Symbol).
- Multi-tenancy / RLS: OK. tenantId/usuarioId SIEMPRE de @CurrentUser (JWT), nunca del
  path/body (documentos-evento.controller.ts:88-89). Toda lectura/escritura fija
  SET LOCAL app.tenant_id como PRIMERA op. de la tx (fijarTenant) en UoW, carga de reserva y
  listado. Filtro explicito por tenant_id (defensa en profundidad). Reserva cross-tenant ->
  null -> 404. Clave de almacen incluye tenantId
  (documentos-evento/{tenantId}/{reservaId}/{tipo}/{uuid}.{ext}). DOCUMENTO.tenant_id
  heredado de la reserva.
- Bloqueo atomico de fecha: OK / N/A. No se introduce Redis/Redlock ni lock distribuido; no
  se toca FECHA_BLOQUEADA.
- Transaccion all-or-nothing: OK. Orden correcto: guardas SIN efectos -> almacen (fuera de la
  tx critica) -> UoW unica {crear DOCUMENTO + AUDIT_LOG crear + listado checklist}. Si el
  almacen falla, no se crea DOCUMENTO; si la tx falla, rollback completo. No hay DOCUMENTO
  huerfano; un binario puede quedar huerfano en almacen ante rollback de tx (aceptable: sin
  fila que lo referencie; consistente con US-023).
- Maquina de estados: OK. Guarda declarativa ESTADOS_VALIDOS_DOCUMENTACION_EVENTO +
  esEstadoQuePermiteDocumentacionEvento() (tabla, no if/else disperso). Es precondicion sobre
  estado actual (no transicion): no anade aristas al grafo (coherente con D-no-transicion).
  Estado invalido -> 422 ESTADO_NO_PERMITE_DOCUMENTACION.
- Contrato <-> backend: OK. Los 6 codigo del enum SubirDocumentoEventoValidacionError
  (ESTADO_NO_PERMITE_DOCUMENTACION, TIPO_DOCUMENTO_NO_PERMITIDO, ARCHIVO_REQUERIDO,
  FORMATO_NO_PERMITIDO, ARCHIVO_INVALIDO, TAMANO_EXCEDIDO) casan 1:1 con las clases de error
  del use-case y con el normalizador del frontend. RESERVA_NO_ENCONTRADA -> 404 compartido.
  Rutas POST /reservas/{id}/documentos-evento y GET .../checklist identicas en contrato,
  controller y SDK. DocumentoEvento con reservaId/nombreArchivo/tamanoBytes/fechaCreacion
  requeridos: el backend siempre los emite en crear.
- SDK generado: OK. Solo schema.d.ts cambia (209 adiciones, generado del contrato).
  client.ts/index.ts sin cambios de contenido (solo LF/CRLF). No hay edicion manual.
- Arrow functions / tipos: OK. Sin function declarativo en codigo nombrado (metodos de clase
  Nest exentos). Sin any/as any. TS strict.
- Errores/nombres en espanol: OK. Mensajes y codigo en espanol; convenciones de nombres
  correctas.
- Frontend estructura por dominio: OK. features/documentacion-evento/ con
  api/components/lib/model/ + barrel index.ts como unica API publica. components/ solo .tsx;
  helpers/tipos/estilos en lib//model/. SeccionesFicha importa la feature por su barrel
  @/features/documentacion-evento. Refactor de FichaConsultaPage extrae las secciones a un
  sub-componente co-localizado (mantiene max-lines).
- max-lines: OK. Fichero mayor de la feature 176 lineas (ChecklistItemDocumento.tsx); todos
  <=300.
- Responsive mobile-first: OK (con evidencia). Sin anchos px fijos; flex-col -> sm:flex-row
  en los items; objetivos tactiles >=48px; input capture=environment para DNI en movil.
  Evidencia E2E en 3 viewports (390/768/1280) en
  reports/2026-07-17-step-N3-e2e-playwright.md + reports/e2e-screenshots/.
- Tests primero (TDD): OK. Existen y pasan specs de contrato del puerto
  (documento.repository.port.spec.ts), guarda de estado (guarda-documentacion-evento.spec.ts),
  use-case, query, controller-http e integracion BD real. Regresion US-023/024 del puerto
  DOCUMENTO verde (13/13 BD real).

## Revision critica de las decisiones senaladas
1. Generalizacion del puerto DOCUMENTO: aditiva y compatible hacia atras. tipo literal ->
   union; el adaptador mapea a Prisma; aDocumentoPersistido ya devuelve el tipo real y
   fechaCreacion coherente. US-023 sigue usando condiciones_particulares +
   buscarPorReservaYTipo. Correcto.
2. listarPorReservaYTipos opcional: aceptable pero con justificacion imprecisa (ver Menor
   #1). No rompe nada.
3. reservaId/tenantId opcionales en la proyeccion: solo laxitud de tipos; el aislamiento lo
   garantiza RLS, no estos campos (ver Menor #2).
4. Ediciones en specs del tdd-engineer (subir-...spec.ts:149, obtener-checklist-...spec.ts:71):
   son correcciones OBJETIVAS de tipado (anadir el tipo del parametro del mock closure). NO
   debilitan aserciones ni relajan expectativas. Correcto.

## Veredicto: APTO
