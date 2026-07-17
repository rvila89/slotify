# Informe de code-review - US-046 (Revisar y enviar email borrador)

- Change: us-046-revisar-enviar-email-borrador
- Rama: feature/us-046-revisar-enviar-email-borrador (base master)
- Fecha: 2026-07-17
- Alcance: primera superficie HTTP del modulo comunicaciones (listar / enviar /
  descartar borrador + email manual), reutilizando el motor de US-045.
- Naturaleza: informe de SOLO LECTURA. No se modifico codigo de negocio.

## Metodo
- Diff revisado sobre el arbol de trabajo (git diff + untracked): master...HEAD no
  arrojaba diff (merge-base == master HEAD) porque los cambios aun no estan commiteados.
- Verificacion: eslint apps/api src/comunicaciones -> exit 0; eslint apps/web sobre
  features/comunicaciones + FichaConsultaPage + AvisosResultadoTransicion -> sin errores
  (solo warnings pre-existentes de deprecacion del plugin boundaries); jest
  src/comunicaciones -> 17 suites / 133 tests OK.
- Contraste DTOs vs docs/api-spec.yml vs SDK generado.

---

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Alta
- Ninguno.

### Media
- [QA/responsive] Evidencia de viewports incompleta. El checklist exige evidencia en 3
  viewports (390 / 768 / 1280). El report E2E (2026-07-17-step-N+3-e2e-playwright.md)
  solo documenta y captura el viewport movil de 390px
  (e2e-us046-comunicaciones-mobile-390.png) mas una captura del dialogo; no hay captura
  ni verificacion explicita a 768 ni a 1280.
  - Atenuante fuerte: el codigo es demostrablemente mobile-first y adaptable por
    inspeccion: los componentes usan breakpoints Tailwind (sm: en cabeceras, footers y
    grids de dialogos, sm:flex-row, w-full sm:w-auto), sin anchos px fijos que rompan en
    movil, con break-words / min-w-0 en el destinatario y max-h-[90vh] overflow-y-auto en
    los dialogos. No hay nav lateral nueva que colapsar.
  - Recomendacion: completar la evidencia QA con capturas a 768 y 1280 (o dejar
    constancia escrita de la verificacion) antes del Gate 2. No es un defecto de codigo.

### Baja
- [consistencia/infra] listarPorReserva inlinea set_config(app.tenant_id) en lugar de
  usar el helper PrismaService.fijarTenant(tx) que si usan los adaptadores
  cargar-comunicacion y cargar-reserva-contexto de esta misma US. El SQL es identico al
  del helper: es puramente estilistico; unificar mejora la consistencia. No afecta a la
  correccion ni al aislamiento.
- [observacion fuera de alcance - deuda] Asimetria del filtro explicito por tenant_id. El
  nuevo listarPorReserva filtra EXPLICITAMENTE por tenantId en el WHERE (defensa en
  profundidad correcta, dado que en dev/test el rol de BD es superuser BYPASSRLS y RLS no
  se fuerza). En cambio, el metodo de US-045 buscarPorReservaYCodigo
  (comunicacion.repository.prisma.adapter.ts:104-120) NO filtra por tenant_id en el WHERE
  (solo fija app.tenant_id para la policy RLS). Con BYPASSRLS esa lectura no quedaria
  aislada por tenant. Es la misma clase de fuga que el bug 2 corregido aqui, pero en una
  superficie de US-045. NO es alcance de US-046 (no lo toca este diff); se senala como
  deuda para un change propio.

---

## Verificacion del checklist / guardrails

### Hexagonal (OK)
- domain/esemailvalido.ts: funcion pura de flecha, sin frameworks ni Prisma.
- domain/comunicacion.repository.port.ts: solo interfaces mas un error de dominio; sin
  framework/ORM. Nuevos tipos ListarPorReservaParams / ComunicacionListItem limpios.
- Use-cases de application/ dependen SOLO de puertos/colaboradores inyectados; sin
  imports de infraestructura. comunicacion-errors.ts es aplicacion pura.
- Adaptadores Prisma y controller confinados a infrastructure/ e interface/. El hook
  no-infra-in-domain no tiene nada que bloquear.

### Multi-tenancy / RLS (OK)
- El controller toma tenantId/usuarioId SIEMPRE del JWT (CurrentUser -> usuario.tenantId
  / usuario.sub), NUNCA del path/body. El id/idComunicacion del path son identificadores
  de recurso, no el tenant.
- Los tres adaptadores de lectura fijan app.tenant_id en la transaccion Y filtran por
  tenantId en el WHERE (defensa en profundidad ante BYPASSRLS). Correccion del bug 2
  solida, con test de contrato mas integracion de aislamiento.
- Roles(gestor) mas RolesGuard -> 403 para autenticado sin rol.

### Bloqueo atomico de fecha (OK / N/A)
- No se toca FECHA_BLOQUEADA ni bloquearFecha/liberarFecha. Sin Redis ni locks
  distribuidos. La idempotencia del manual se resuelve con indice UNIQUE parcial de
  PostgreSQL, recreado de forma aditiva y no destructiva por SQL crudo (Prisma no modela
  el predicado WHERE de indices parciales).

### Maquina de estados (OK / N/A)
- No se modifica la maquina de estados de RESERVA. El ciclo de la COMUNICACION
  (borrador -> enviado/fallido) usa guardas explicitas y una unica clase de error por
  transicion; el descarte se modela como fallido mas AUDIT_LOG con causa distinguible (no
  hay estado descartado en el enum), documentado en design D-5. Sin if/else disperso.

### Mapeo de errores a HTTP (OK)
- 404 (NoEncontrada), 409 (EstadoNoBorradorError mas codigo/estadoActual), 422
  (DestinatarioInvalidoError), 502 (ProveedorEmailError). Los tres use-cases comparten
  las MISMAS clases desde comunicacion-errors.ts y el controller mapea por instanceof. La
  correccion del bug 3 (500 -> 422/502 en el manual) es solida y cuenta con test de
  regresion (comunicacion-errors.spec.ts) que asserta identidad de clase entre el modulo
  canonico y los re-exports de enviar/manual.

### Proyecciones fieles (bug 1) (OK)
- El puerto y el adaptador proyectan fechaCreacion y esReenvio reales
  (ComunicacionRegistrada / ComunicacionListItem); las mutaciones devuelven los datos
  reales de la fila (no new Date()/false fabricados en el controller) y el listado
  devuelve cuerpo y clienteId reales. Coherente con lo que precarga el dialogo de
  revision. Correccion solida.

### Tipos y datos (OK)
- Sin any, sin function declarativo (arrow-only), sin Float. Los casts a
  CodigoEmail/EstadoComunicacion son estrechamientos de los enums de Prisma a las uniones
  de dominio (patron existente del adaptador). Sin importes monetarios en esta US.

### DTOs / class-validator (OK)
- EnviarBorradorRequestDto (asunto/cuerpo opcionales con IsOptional/IsString/MinLength 1)
  y CrearEmailManualRequestDto (obligatorios) validados. Respuestas solo salida (sin
  validadores, correcto). El gestor solo edita asunto/cuerpo; codigoEmail y
  destinatarioEmail no forman parte del comando.

### Contrato OpenAPI vs DTOs vs SDK (OK)
- Los 4 endpoints existen en docs/api-spec.yml con operationId
  (listarComunicacionesReserva, enviarBorradorComunicacion, descartarBorradorComunicacion,
  crearEmailManual). Los esquemas Comunicacion / ComunicacionListItem (allOf mas
  accionable) / EnviarBorradorRequest / CrearEmailManualRequest y los tres envelopes de
  error (409 con estadoActual, 422, 502) coinciden campo a campo con los DTOs y con el
  mapeo del controller.
- schema.d.ts conserva el banner auto-generated Do not make direct changes y deriva del
  contrato; el frontend consume via apiClient.POST/GET y components schemas (sin edicion a
  mano). El hook protect-generated-client no tiene nada que bloquear.

### Frontend - estructura por dominio mas responsive (OK)
- Feature Bulletproof React: segmentos api/ components/ lib/ model/ mas barrel index.ts
  como unica API publica; components/ contiene SOLO .tsx (helpers/estilos/schemas en lib/,
  tipos en model/). Todos los archivos menores o iguales a 300 lineas (mayor: 229). ESLint
  (boundaries + max-lines + segment-purity) pasa sin errores.
- La integracion en FichaConsultaPage extrajo los avisos a AvisosResultadoTransicion.tsx
  para acomodar la nueva card; la pagina baja de 342 a 325 lineas brutas (efectivas < 300
  con skipComments/skipBlankLines) y sigue pasando lint.
- UI mobile-first con TanStack Query mas RHF/Zod; ver observacion Media sobre viewports.

### Tests primero / pasan (OK)
- 17 suites / 133 tests verdes en src/comunicaciones (specs RED-first del puerto
  listarPorReserva, esemailvalido, los tres use-cases, comunicacion-errors y la
  integracion del indice parcial contra BD real). QA previa: unit 128+, integracion 5 (BD
  real), curl 10 escenarios, E2E Playwright.

### Convenciones (OK)
- Nombres en espanol (PascalCase/camelCase/kebab-case), comentarios y errores en espanol.
  Excepcion menor: nombre de archivo esemailvalido.ts en minusculas seguidas (la funcion
  exportada esEmailValido si es camelCase); intencional por imitar validar-iban.ts.
  Aceptable.

---

## Veredicto: APTO

No hay hallazgos Bloqueantes ni de severidad Alta. Las tres correcciones de QA (proyeccion
fiel, filtro cross-tenant explicito, clases de error compartidas) estan bien implementadas
y cubiertas por tests de regresion. Las observaciones Media (evidencia QA de viewports
768/1280) y Baja (unificar fijarTenant; deuda de US-045 en buscarPorReservaYCodigo) no
impiden el merge y pueden abordarse como seguimiento; la deuda de US-045 esta
explicitamente fuera de alcance.
