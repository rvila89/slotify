# SLOTIFY

## PLANIFICACIÓN

### SESION DE DISCOVER CON CLAUDE WEB 

**Prompts**: explicar los prompts principales lanzados en esta sesión

**Resultado - Fase Discovery:**

Inicialmente quedaron descartadas dos ideas previas (plataforma para ciclistas amateurs y sistema de gestión de conciertos) por saturación de mercado validada y por no ser un punto de dolor "real" en mi dia.
A partir de justamente esta idea (buscar una solución a un problema real actual en mi vida) aparece esta nueva propuesta.

**Idea**: construir una solución de gestión integral para negocio familiar de alquiler de espacio para eventos.
**Objetivos sesion**: 
- Decidir si la nueva idea es viable como TFM
- Aterrizar su alcance

#### SINTESIS DE LA IDEA
**Nombre producto**: Slotify
**Descriptor de marca**: Plataforma de gestión para espacios de eventos
**Descripción producto**: Plataforma Saas de gestión integral para espacios de eventos privados de pequeño formato - masias, fincas, jardines, salones familiares - que centraliza la gestión completa de en un negocio en único backoffice.
**Caso de uso piloto**: Masisa l'Encís (Alt Penedès) - finca familiar gestionada por 4 personas.

#### VALIDACION DE MERCADO
**Mercado saturado**: PMS (Property Management System) para casas rurales con pernoctación (Lodgify, AvaiBook, Misterplan, OfiRural...) y software de gestión de eventos para venues grandes y catering (IVvy, EventPro, OfiEventos, Galdón...)
**Oportunidad detectada**: La gestión integral de eventos privados de pequeño formato está mal atendida: los grandes son caros y complejos y lo "sencillo" y "barato" es combinar hojas de Excel con Gmail / Drive ...

#### PUNTO DE DOLOR
Hace poco más de un año mi familia y yo iniciamos un proyecto/negocio familiar: Masia l'Encís, un espacio de más de 500 m² entre viñedos y olivos, situado en el corazón del Penedès, dedicado a todo tipo de celebraciones y eventos privados.
A día de hoy, la gestión del negocio se realiza entre cuatro personas —ninguna con perfil técnico— mediante correo electrónico (Gmail), hojas de cálculo en Google Drive y conversaciones sueltas por WhatsApp.

El proyecto está funcionando muy bien y ha tenido un crecimiento más elevado de lo esperado. Con él han llegado las grietas y los problemas de gestión derivados de no tener una herramienta integral donde centralizar todo el negocio: 
- No sabemos siempre en qué punto está cada consulta 
- No tenemos claramente definidos los estados de una solicitud
- Alguna vez hemos estado a punto de comprometer la misma fecha dos veces
- No disponemos de un historial de reservas
- La facturación vive dispersa entre nuestras bandejas de correo y hojas en Google Drive
- No contamos con un dashboard que centralice la información para hacer el seguimiento de cada consulta o reserva 
- No contamos con un dashboard que nos permita consultar el historial de ocupación y facturación (mensual, anual)
- Los correos y los presupuestos se redactan a mano con plantillas dispares 
- No tenemos fichas de reserva organizadas que permitan enviar recordatorios o notificaciones.

En definitiva, lo que empezó siendo una ilusión compartida se ha convertido en una carga operativa que erosiona la calidad del servicio y nuestra capacidad de crecer. De esa frustración nace **Slotify**.

#### ALCANCE MVP
Aunque el modelo de datos de la aplicación se defina desde el inicio como multi-tenant, el MVP se centrará en los siguientes módulos orientados a la gestión intregral de Masia l'Encís:
- Backoffice de reservas con gestión de estados explícita (consulta - pre_reserva - reserva_confirmada - reserva_completada, más reserva_cancelada) y calendario visual
- Generación de PDFs y emails automáticos (respuestas a consultas con cálculo interno de tarifa, presupuestos, factura, contratos, normas)
- Dashboard de negocio con KPIs (ocupación, ingresos, ratio consulta-reserva) y exports CSVs

#### STACK TECNOLÓGICO
- Monorepo: Turborepo (apps/web, apps/api, packages/shared)
- Frontend: Vite + React + TypeScript + Tailwind + shadcn/ui (SPA consumiendo OpenAPI)
- Backend: NestJS + TypeScript + Prisma (hexagonal + DDD + OpenAPI)
- Base de datos: PostgreSQL
- CI/CD: GitHub Actions

#### DECISIONES RELEVANTES TOMADAS EN ESTA FASE
La propuesta inicial de Claude planteaba un formulario en la web con cálculo de tarifa instantánea visible al cliente. Mi objeción, basada en mi conocimiento del negocio fue clara: "Priorizo hacer un primer contacto y poder negociar directamente con el cliente y ver la demanda inicial del espacio, que no que por el "posible embudo" de las tarifas se queden ya fuera ciertos contactos y no tenga visibilidad sobre ello ni oportunidad de negociar". Tras discusión, llamos al resultado siguiente: La tarifa se precalcula en el backoffice para uso del gestor, pero el cliente no ve precios en el formulario público (progressive disclosure of friction)

### SESION DE DISCOVER CLAUDE PROJECTS Y PERPLEXITY
Siguiendo las indicaciones de las sesiones de planificación y documentación efectivas con IA, utilizo inicialmente un custom-GPT de Chat GPT (AI Mega-Prompt Generator) para a través del siguiente prompt [enlace prompts.md] generar un system-prompt y un user-prompt para poder empezar a trabajar el desarrollo del proyecto en Perplexity y Claude Projects. Los dos asistentes generan una especificación funcional, siendo muchisimo mas completa la generada en Claude Projects y la que decido iterar para dejarla lo más definida posible

#### DECISIONES RELEVANTES TOMADAS EN ESTA FASE

##### Decisiones técnicas y de arquitectura
La decisión técnica de mayor calado en esta fase ha sido adoptar la estrategia **"opinado por fuera, configurable por dentro"**. El producto se construirá con un único flujo operativo visible al usuario (el modelo de Masia l'Encís), pero internamente todo lo configurable —máquina de estados, TTLs, porcentajes de pago, plantillas, tipos de evento, políticas de cancelación y liquidación tardía— se modela como configuración por tenant desde el día 1. Esto permite que el MVP sea simple y opinado para el caso piloto, pero la arquitectura esté preparada para un futuro sin tener que reescribir el core. El riesgo aceptado es claro: clientes con operativa radicalmente distinta a Masia l'Encís quedan fuera del objetivo en MVP/V1, pero se prefiere evitar el desarrollar un plataforma que intenta hacer todo y no hace nada bien.

Para sostener esta estrategia, se han fijado una serie de decisiones arquitectónicas no negociables desde el día 1: multi-tenancy con `tenant_id` en cada tabla y Row-Level Security en Postgres; la reserva como agregado raíz en el modelo (DDD); la máquina de estados, TTLs, porcentajes y plantillas almacenados como configuración por tenant, nunca hardcodeados; audit log completo sobre reservas y facturas; eventos de dominio como base de las automatizaciones; transacciones atómicas para bloqueos de fecha y operaciones de cola; sub-procesos paralelos modelados como campos independientes (`pre_evento_status`, `liquidacion_status`); consultas como entidades inmutables (las reaperturas crean entidades nuevas vinculadas); e índices específicos para detección de recurrencia (`email_normalized`) y promoción eficiente de cola (`consulta_bloqueante_id`, `posicion_cola`). La cola se modela como campos en la propia entidad reserva, no como tabla aparte, para mantener cohesión y simplificar queries.

##### Decisiones funcionales
A nivel funcional, las decisiones tomadas en esta fase reconfiguran cómo se entiende el negocio en el producto. La primera y más estructural es que **la reserva es la entidad central, no el cliente**: la mayoría de clientes en eventos privados no son recurrentes, por lo que el activo informacional clave es el histórico de reservas, no una visión cliente-céntrica al estilo CRM. El cliente queda como un atributo de la reserva.

El flujo financiero queda fijado en **pre-pago: 40% de señal en la confirmación y 60% de liquidación antes del evento** (deadline T-1d), descartando explícitamente el modelo de cobro post-evento. Asimismo, se ha decidido que el **pre-evento y la liquidación corran en paralelo** desde la confirmación de la reserva, no en secuencia, reflejando cómo trabaja realmente una masía: definir los detalles del evento y cobrar son procesos ortogonales que deben poder avanzar a su ritmo. El día del evento solo se ejecuta si ambos sub-procesos están cerrados.

El **bloqueo de fecha es condicional según la madurez del lead**: 3 días si el cliente indica fecha concreta en consulta, 3 días adicionales si falta confirmar el número de invitados, 7 días al pasar a pre-reserva con presupuesto enviado, y firme tras el cobro de la señal.

Se ha discutido y resuelto cómo gestionar dos casos de uso reales y frecuentes que hasta ahora se trataban de forma ad-hoc. El primero, **leads recurrentes**: las consultas son entidades inmutables; cuando un cliente vuelve tras una consulta terminal, se crea una entidad nueva vinculada automáticamente por detección de email, con pre-relleno de los datos heredados y posibilidad de desvincular manualmente desde la UI. Los clientes recurrentes no tienen prioridad sobre otros leads activos. El segundo, **cola de espera en fechas saturadas**: cuando un lead solicita una fecha bloqueada por otra consulta en estado 2.b, se le coloca automáticamente en una cola FIFO con notificación al cliente y opción a salir voluntariamente. Si la consulta bloqueante expira, el primero en cola es promovido automáticamente; si avanza a pre-reserva o a estado 2.c (porque el cliente da su palabra), la cola se vacía y se notifica a los descartados. La cola solo se activa con la bloqueante en 2.b, lo que acota el tiempo máximo de espera a 3 días.

Para soportar estos dos casos, se han incorporado nuevos estados terminales en el sub-estado consulta: `2.x consulta_expirada`, `2.y consulta_descartada_por_cola` y `2.z consulta_descartada_por_cliente`. Esta distinción es relevante porque permite analíticamente entender por qué se pierde cada lead y no distorsiona el funnel de conversión.

##### Decisiones alcance del MVP

El alcance del MVP TFM incluye el proceso completo end-to-end de una reserva, los sub-procesos paralelos pre-evento + liquidación, y la cola de espera con toda su mecánica. Es un alcance ambicioso pero asumido conscientemente por tres razones:

1. **El proceso de una reserva debe estar completo para tener valor demostrable.** Sub-procesos paralelos y cola son parte sustancial de la propuesta diferencial; recortarlos vaciaría el producto.
2. **La cola y los sub-procesos paralelos son donde más se puede aprovechar la IA en SDD+TDD.** Son lógica de negocio compleja con muchos edge cases y race conditions: terreno donde TDD asistido por IA aporta valor académico claro.
3. **Quedan fuera del MVP** las funcionalidades que no afectan al ciclo principal: detección de recurrentes, emails de cola, importador CSV, dashboard financiero completo, factura complementaria, Stripe, WhatsApp. Todas están diseñadas en este PRD pero no implementadas.

#### SYSTEM PROMPT ACTUALIZADO EN CLAUDE PROJECTS

Después de iterar con el asistente para obtener una especificación funcional validada, adjunto la especificación resultante y actualizo el system prompt en el Claude Project:

#SYSTEM ROLE:

Eres un Product Manager senior especializado en plataformas SaaS B2B para gestión integral de espacios de eventos privados de pequeño y mediano formato (masías, fincas, jardines, villas, salones boutique y espacios familiares).

Actualmente acompañas el desarrollo de **Slotify**, plataforma SaaS multi-tenant cuyo caso piloto es **Masia l'Encís**. El proyecto se desarrolla como Trabajo Final de Máster con deadlines: documentación técnica 12/06/2026, código funcional 10/07/2026, entrega final 29/07/2026. El desarrollo se realiza con metodologías **SDD (Spec-Driven Development) + TDD (Test-Driven Development) asistido por IA** en todas las fases del SDLC.

##FUENTE DE CONOCIMIENTO

La especificación funcional completa de Slotify está adjunta al proyecto como `EspecificacionFuncional.md`. Esa especificación es la **fuente de verdad** del producto. Antes de responder cualquier pregunta funcional, arquitectónica o de alcance, consúltala.

Reglas de uso de la spec:
- Si la spec ya decide algo (especialmente §13 "Decisiones cerradas"), **respétalo**. No propongas alternativas salvo que el usuario las cuestione explícitamente.
- Si una pregunta toca un área marcada **"📐 Solo diseñado"** en §9.2, recuérdalo: forma parte del PRD pero **no se construye en el MVP TFM**.
- Si una pregunta toca un área marcada **"✅ Implementado en MVP TFM"**, esa funcionalidad sí está en alcance de construcción.
- Si detectas una **contradicción** entre la spec y la pregunta del usuario, señálala antes de responder.
- Si la spec **no cubre** un caso, dilo explícitamente antes de proponer.
- No inventes comportamientos no documentados como si estuvieran en la spec.

##TU FUNCIÓN

Actúas como:
- Product Manager
- Business Analyst
- SaaS Strategist
- UX Strategist
- Operations Expert para hospitality y eventos
- Arquitecto funcional de software

Tu prioridad es diseñar producto SaaS:
- altamente operativo,
- fácil de usar,
- escalable,
- orientado a automatización,
- centrado en reducir errores humanos,
- y capaz de sustituir procesos dispersos realizados actualmente con Gmail, Google Sheets, Google Drive y WhatsApp.

##MODELO MENTAL OBLIGATORIO DE SLOTIFY

Estas son piedras angulares del producto. Cualquier diseño debe respetarlas:

- **La reserva es la entidad central.** El cliente es un atributo de la reserva. Nunca propongas diseños cliente-céntricos tipo CRM.
- **Un tenant = un espacio.** Multi-espacio queda fuera de alcance hasta V3+.
- **Pipeline jerárquico de estados** con sub-estados de consulta (2.a, 2.b, 2.c, 2.d, 2.x, 2.y, 2.z), sub-procesos paralelos pre_evento + liquidación, y estados terminales inmutables.
- **Cola FIFO automática** activa solo cuando la consulta bloqueante está en 2.b. Promoción, vaciado y reordenación son automáticos.
- **Bloqueo de fecha condicional según madurez del lead**: 3 días en consulta con fecha, +3 si falta nº invitados, 7 días en pre-reserva, firme en reserva confirmada.
- **Liquidación pre-evento, no post-evento**: 40% señal + 60% liquidación con deadline T-1d.
- **Consultas son entidades inmutables.** Las reaperturas crean entidad nueva vinculada vía `consulta_vinculo`. Nunca propongas "reabrir" una consulta terminal.
- **Estrategia "opinado por fuera, configurable por dentro"**: un único flujo visible al usuario, pero TTLs, porcentajes, plantillas y máquina de estados como configuración por tenant desde el día 1.

##CÓMO DEBES RESPONDER

Siempre debes:
- pensar en términos de workflows reales de negocio,
- proponer automatizaciones concretas,
- evitar funcionalidades genéricas de CRM,
- priorizar claridad operativa,
- minimizar fricción para usuarios no técnicos,
- diseñar experiencias pensadas para uso diario intensivo.

Cuando diseñes funcionalidades incluye:
- el problema que resuelven (mapeado a los dolores D1–D13 de la spec cuando aplique),
- los flujos de usuario,
- los edge cases,
- los KPIs relevantes,
- el impacto operacional y la facilidad de adopción,
- y, cuando sea relevante, **si entra en el alcance MVP TFM (✅) o queda como diseñado (📐)**.

Dado que el desarrollo se hace con SDD + TDD asistido por IA, cuando propongas funcionalidad piensa también en:
- cómo se especificaría (criterios de aceptación machine-readable),
- qué tests la cubrirían primero,
- y especialmente, **en zonas críticas (bloqueo atómico de fecha, máquina de estados, motor de tarifas, cola con concurrencia), prioriza siempre tests de concurrencia y race conditions antes que código**.

Debes estructurar tus respuestas como documentación profesional de producto preparada para:
- founders,
- product managers,
- diseñadores UX/UI,
- desarrolladores,
- equipos operativos,
- e inversores SaaS.

##ESTILO

Tu estilo debe ser:
- estratégico,
- estructurado,
- concreto,
- accionable,
- objetivo y realista,
- sin explicaciones genéricas ni teoría innecesaria.

Reglas de tono no negociables:
- Nunca empieces respuestas con elogios ni validaciones de cortesía.
- Si el usuario se equivoca o su razonamiento tiene un fallo, **díselo directamente antes de responder**, no después.
- Marca explícitamente lo que no sabes o donde tienes incertidumbre. Un "no sé" honesto es preferible a una respuesta inventada que suene bien.
- Estructura formativa por pasos cuando aporte valor pedagógico (el usuario está formándose en adopción de IA).

Nunca respondas con ideas vagas. Toda recomendación debe estar adaptada específicamente a Slotify y al sector de gestión de espacios para eventos privados.

##RIESGOS CRÍTICOS VIVOS DEL PROYECTO

Mantén estos riesgos presentes en cualquier diseño o recomendación:

- **R1 — Doble reserva y race conditions**: en bloqueo de fecha y, especialmente, en promoción/reordenación de cola.
- **R2 — Scope creep**: el MVP TFM ya es ambicioso para el plazo y la dedicación parcial.
- **R3 — Importador histórico**: sin él, no hay migración real del cliente piloto (📐 solo diseñado

### CREACION PROYECTO
En este momento, dentro también de la fase de planificación, creo el proyecto ya en directorio para empezar a iterar el PRD-Especficación funcional con el prompt (adjuntar link) para terminar de refinar y validar la especificación del producto y empezar a generar los artefactos necesarios para poder construirlo. Empiezo utilizando Copilot como asistente, con el uso de modelos Claude (Opus y Sonnet) para ese trabajo iterativo de refinamiento y validación.

## ARTEFACTOS (DISEÑO?)
Una vez finalizado el refinamiento y validado el SlotifyGeneralSpecs, empezamos a generar los distintos artefactos necesarios para poder construir el proyecto.

### USE CASES
Para poder generar los uses cases ejecutamos el prompt (enlace) indicando claramente el alcance del MVP solicitando que toda la funcionalidad contemplada para esta primera fase del producto este cubierta en los casos de uso generados

### ER DIAGRAM
Siguiendo con los artefactos, empezamos a trabajar de una forma más aterrizada el modelo de datos. Para ello utilizo el prompt que nos compartió el Mentor Daniel... y adjunto como contexto del prompt los uses-cases generados en el apartado anterior, así como una indicación que el alcance a cubrir es el indicado para el VMP (prompt---)
El primer artefacto generado no termina de convencerme y hay ciertas decisiones tomadas (como separar por entidades Reserva y Consulta, y otras) que no son fieles a los casos de uso y a la GeneralSpec. Empiezo un proceso de iteración volviendo al Claude Project web para conseguir el er-diagram definitivo

### ARCH DIAGRAM
Para generar el diagrama de arquitectura a alto nivel utilizo el prompt que nos compartió Daniel y que en su momento me funcionó muy bien, adaptandolo un poco a las necesidades de mi proyecto. Sobretodo le añado indicaciones y validaciones posteriores para asegurar que toda la funcionalidad definida en el MVP esté representada en el diseño.
Para el prompt que me permita generar el diagrama en Diagrams GPT le he indicado claramente que no sobredimensiones el diseño de la arquitectura, y que se enfoque solamente en los componentes y servicios necesarios para el MVP.

El resultado inicial es bastante sobre ingeniería y lo que hago a partir de esa primera versión es utilizar Claude Project para solicitar arquitectura y luego aprovechar para compararla con la dada a través de Copilot. En ese proceso comparativo y de refinamiento voy elaborando mejor el diseño de arquitectura final hasta tener una versión 3.2 final como resultado óptimo para poder empezar.

### C4 DIAGRAM
Para generar el diagrama c4 utilizo el prompt que nos compartió Daniel y que en su momento me funcionó muy bien, adaptandolo un poco a las necesidades de mi proyecto (prompt link)

### ARQUITECTURA DEL SISTEMA
Después de generar el artefacto anterior, y junto a los otros tres artefactos generados anteriormente (er-diagram, use-cases, c4-diagram) solicito a la propia IA una série de prompts para poder contextualizar la arquitectura final del sistema, el diagrama definitivo y definir las decisiones, justificaciones y el resultado final. Refino esos prompts y los ejecuto para tener ya definida completamente la arquitectura del sistema Slotify (MVP)

--- no se si aplica

### CREACION DE UNA SKILL PARA ACTUALIZAR DINÁMICAMENTE TODOS ESTOS DIAGRAMAS Y DOCUMENTACIÓN
Llegados a este punto, con el gran número de artefactos y diagramas desarrollados, veo la necesidad de crerar una skill que permita mantener y actualizar toda esta documentación cuando hayan cambios en el código que tengan un impacto sobre ello. (desarrollar mas el punto)

---

--------------------------

SEGUIR AQUI

## DISEÑO UX

## MODELO DE DATOS

## DESARROLLO

## TESTS