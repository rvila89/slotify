# Design — us-044-visualizar-dashboard-operativo

> Decisiones técnicas del Dashboard Operativo. Alcance: **vista de lectura
> agregada**, sin mutación ni concurrencia. Trazable a US-044 / UC-34.

## Contexto

El Dashboard agrega, en una sola pantalla de inicio, el estado operativo del
tenant en 7 widgets heterogéneos que leen de 6 entidades (`RESERVA`,
`FECHA_BLOQUEADA`, `PRESUPUESTO`, `FACTURA`, `PAGO`, `FICHA_OPERATIVA`). El reto
de diseño no es la concurrencia (no hay), sino: (a) minimizar el coste de la
consulta agregada, (b) no duplicar la lógica de color ya existente en
`calendario` (US-039), y (c) mantener cada widget aislado (estado vacío/carga).

## Decisiones

### D-1: Un único endpoint agregado `GET /dashboard`

**Decisión.** Un solo endpoint de lectura devuelve la carga de los 7 widgets en
una respuesta estructurada (`{ hoyManana, pipeline, subProcesosCriticos,
pendientes, consultasEnCola, visitasProgramadas, proximos30Dias }`), en vez de 7
endpoints separados.

**Por qué.** Es la pantalla de inicio: una sola llamada reduce latencia y
round-trips en el arranque de la app. Al ser lectura pura sin paginación pesada
(el volumen operativo diario de un tenant es pequeño), el coste de agregar en
una query/transacción de solo-lectura es asumible. El backend calcula cada
widget con su propio filtro; el `tenant_id` se inyecta una vez.

**Alternativa descartada.** 7 endpoints (un fetch por widget en el front):
mejora el aislamiento de fallos por widget, pero multiplica round-trips y
complica el contrato para un beneficio marginal en este volumen. El aislamiento
de fallos/estado vacío se resuelve en el front (D-6) sin fragmentar el contrato.

### D-2: Reutilizar la derivación de color de `calendario` (US-039)

**Decisión.** El widget "Próximos 30 días" NO reimplementa el mapa de colores:
reutiliza la **función pura de derivación de color** que ya vive en la capability
`calendario` (estado/sub_estado → color canónico §11.3). Backend y front
comparten esa fuente única.

**Por qué.** La regla de negocio de US-044 dice explícitamente "el mismo código
de colores que el Calendario (US-039)". Duplicarla generaría deriva entre las dos
vistas. Es una función pura sin dependencias de infraestructura, trivial de
compartir.

**Implicación.** Si la lógica de color vive hoy en `apps/api/src/calendario/`
(dominio) y en el `model/`/`lib/` de la feature calendario del front, se extrae a
un punto reutilizable o se importa por su barrel público. No se copia el mapa.

### D-3: Semántica temporal por widget (hoy, mañana, próximas 24 h, 30 días)

**Decisión.** Las ventanas temporales se calculan en backend con la zona horaria
del tenant, no en el cliente:
- "Hoy y mañana": `fecha_evento ∈ {hoy, mañana}`.
- "Pendientes / TTL": `ttl_expiracion ∈ [now, now + 24 h]`.
- "Próximos 30 días": `fecha_evento BETWEEN today AND today + 30 días` (inclusive).
- "Visitas": `visita_programada_fecha > now`.

**Por qué.** Centralizar el cálculo temporal evita discrepancias por reloj de
cliente y respeta la regla de validación del rango inclusivo. Nota de memoria del
proyecto: existe una deuda conocida de off-by-one por TZ en `ttlExpiracion`
(display); este change **no** la arrastra a la lógica de negocio — los rangos se
calculan en backend con TZ correcta y se documentan.

### D-4: Aislamiento multi-tenant en la capa de repositorio + RLS

**Decisión.** El `tenant_id` del JWT se inyecta en el adaptador Prisma para
**todas** las consultas de los 7 widgets; RLS actúa como segunda barrera. Todos
los widgets filtran además por `activo = true` donde aplique.

**Por qué.** Regla dura del proyecto (FA-04, `CLAUDE.md`). Ningún widget puede
filtrar por su cuenta ni omitir el tenant. El dominio no conoce Prisma
(hexagonal): el puerto de consulta vive en `domain/`, el adaptador en
`infrastructure/`.

### D-5: Lectura pura — sin tests de concurrencia

**Decisión.** No se escriben tests de race condition ni de bloqueo atómico.

**Por qué.** El Dashboard no muta `RESERVA` ni ninguna entidad; múltiples widgets
pueden ejecutarse en paralelo sin riesgo (US-044 §Concurrencia). Las garantías de
concurrencia sobre `FECHA_BLOQUEADA` residen en las historias que escriben
(US-040 y el flujo de bloqueo). El stale-read de milisegundos de una vista de
inicio no es un riesgo operativo. El TDD-RED se centra en: filtros de cada
widget, agregación, derivación de color reutilizada, aislamiento tenant,
no-mutación y estados vacíos.

### D-6: Aislamiento de widget en el frontend (estado vacío/carga)

**Decisión.** Cada widget es un componente independiente que renderiza su propio
estado vacío descriptivo a partir del sub-objeto que le corresponde de la
respuesta agregada. Un widget vacío no bloquea ni oculta a los demás.

**Por qué.** Requisito FA-01. Aunque el fetch sea único (D-1), el render por
widget se aísla: si un sub-objeto viene vacío, ese widget muestra su mensaje
("No hay eventos hoy ni mañana", etc.) mientras el resto pinta datos.

### D-7: Navegación — enlaces a ficha y al Calendario, sin lógica duplicada

**Decisión.** Cada ítem enlaza a la ficha de la `RESERVA` (ruta existente). El
mini-calendario "Próximos 30 días" enlaza al Calendario completo (US-039) con la
fecha seleccionada, sin reimplementar disponibilidad. La navegación de retorno la
gestiona el historial del navegador (scroll restaurado por el browser).

**Por qué.** FA-02 y FA-03. El Dashboard es punto de entrada, no dueño de la
lógica de ficha ni de calendario; solo compone enlaces.

### D-8: Dashboard como nueva entrada del sidebar (Calendario sigue siendo landing)

**Decisión (resuelta en el gate humano).** El **Calendario permanece como
pantalla de inicio tras el login** (landing post-login, tal como lo define
`app-shell` / US-000A). El Dashboard NO es la landing ni introduce ninguna
redirección post-login: se añade como **una entrada más del sidebar del App
Shell** ("Dashboard"), al mismo nivel que el resto de secciones. La UI del
Dashboard es un grid mobile-first (390/768/1280): los 7 widgets se apilan en
móvil y se distribuyen en columnas en tablet/escritorio.

**Por qué.** Decisión explícita del usuario en el gate de revisión SDD: no se
cambia la landing existente para no reabrir el contrato de `app-shell`; el
Dashboard es una vista más, navegable desde el sidebar. Se conserva la regla
dura de responsive de `CLAUDE.md`: sin overflow horizontal, la nav lateral
colapsa a drawer en `<lg`.

**Implicación.** No se toca el comportamiento de inicio de sesión ni la ruta de
landing; solo se añade la entrada "Dashboard" y su ruta en el App Shell. El
supuesto de US-044 sobre "pantalla de inicio" queda anulado por esta decisión.

## Alcance explícito fuera (📐)

- Dashboard financiero + KPIs avanzados (§7.2): ingresos, ocupación, ticket
  medio, conversión, estacionalidad, comparativas. No se implementa.
- Filtro "clientes recurrentes" (§7.3, `consulta_vinculo`). No se implementa.
- Histórico de reservas: cubierto por US-042/US-043; no se duplica.
- Cualquier mutación de datos desde el Dashboard.

## Riesgos y notas

- **Coste de la query agregada**: si el volumen crece, D-1 podría necesitar
  paginación o troceo por widget; hoy no es el caso. Se documenta como deuda
  potencial, no se optimiza prematuramente.
- **Deriva de color con el Calendario**: mitigada por D-2 (fuente única).
- **Deuda TZ conocida** (memoria del proyecto): se evita en la lógica de rangos
  (D-3); el arreglo de display de `ttlExpiracion` queda para su change aparte.
