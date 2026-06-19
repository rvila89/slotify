# BITÁCORA DE DESARROLLO — SLOTIFY
> Proyecto de Trabajo Final de Máster  
> Plataforma SaaS de gestión integral para espacios de eventos privados  
> Autor: Roger Vila
> Última actualización: 11 de junio de 2026

---

## ÍNDICE

1. [Información del proyecto](#información-del-proyecto)
2. [Fase 1: Discovery y Planificación](#fase-1-discovery-y-planificación)
3. [Fase 2: Diseño de Artefactos](#fase-2-diseño-de-artefactos)
4. [Fase 3: Historias de Usuario y Backlog](#fase-3-historias-de-usuario-y-backlog)
5. [Fase 4: Diseño UX/UI](#fase-4-diseño-uxui)
6. [Fase 5: Planificación de Sprints](#fase-5-planificación-de-sprints)
7. [Fase 6: Modelo de Datos](#fase-6-modelo-de-datos)
8. [Fase 7: Desarrollo](#fase-7-desarrollo)
9. [Fase 8: Testing](#fase-8-testing)
10. [Lecciones aprendidas](#lecciones-aprendidas)
11. [Próximos pasos](#próximos-pasos)

---

## INFORMACIÓN DEL PROYECTO

### Datos generales
- **Nombre del producto**: Slotify
- **Descriptor de marca**: Plataforma de gestión para espacios de eventos
- **Tipología**: Plataforma SaaS B2B multi-tenant
- **Cliente piloto**: Masia l'Encís (Alt Penedès)
- **Metodología de desarrollo**: SDD (Spec-Driven Development) + TDD (Test-Driven Development) asistido por IA

### Cronograma del TFM
| Hito | Fecha límite | Estado |
|------|--------------|--------|
| Documentación técnica completa | 12/06/2026 | ✅ Entregado |
| Código funcional MVP | 10/07/2026 | ⏳ Pendiente |
| Entrega final TFM | 29/07/2026 | ⏳ Pendiente |

### Herramientas y asistentes IA utilizados
- **Claude Projects** (Claude Opus / Sonnet) — Especificación funcional, arquitectura, refinamiento iterativo
- **GitHub Copilot** — Desarrollo asistido en VS Code
- **ChatGPT** (Custom GPT: AI Mega-Prompt Generator) — Generación de system prompts
- **Perplexity** — Validación de mercado y benchmarking competitivo
- **Diagrams GPT** — Generación de diagramas de arquitectura

---

## FASE 1: DISCOVERY Y PLANIFICACIÓN

### 1.1 Sesión de Discovery con Claude Desktop
 
**Objetivo**: Validar viabilidad de la idea y definir alcance del MVP

#### Contexto previo
Antes de llegar a Slotify, se descartaron dos ideas previas:
1. **Plataforma para ciclistas amateurs**: mercado saturado, competencia establecida
2. **Sistema de gestión de conciertos**: no resolvía un punto de dolor real y directo

#### Decisión estratégica
Buscar una solución a un **problema real actual en mi vida personal**: la gestión operativa deficiente de Masia l'Encís, negocio familiar iniciado hace poco más de un año.

#### Prompts clave utilizados
Ver detalles completos en [prompts.md](prompts.md#prompt-1-discovery-inicial)

**Prompt inicial** (ejecutado en Custom GPT de ChatGPT):
- Rol: Product Manager
- Contexto: Negocio familiar de alquiler de espacio sin herramienta digital
- Puntos de dolor documentados: 9 problemas operativos críticos
- Output esperado: System prompt y user prompt para trabajar en Claude Projects

**Resultado**: Se generaron dos especificaciones funcionales:
- Perplexity: especificación básica
- Claude Projects: especificación completa y detallada (seleccionada para iterar)

#### Resultado - Fase Discovery:

**Idea validada**: Construir una solución de gestión integral para negocio familiar de alquiler de espacio para eventos privados.

**Objetivos de la sesión**: 
1. Decidir si la nueva idea es viable como TFM
2. Aterrizar alcance realista para el plazo disponible
3. Identificar diferenciadores competitivos

#### Validación de mercado

**Análisis de mercado realizado con Perplexity y Claude Projects**

**Segmentos de mercado saturados identificados**:
- **PMS (Property Management System) para alojamiento con pernoctación**: Lodgify, AvaiBook, Misterplan, OfiRural, Cloudbeds
- **Software de gestión de eventos para venues grandes y catering**: IVvy, EventPro, OfiEventos, Galdón Software, Planning Pod

**Oportunidad de mercado detectada**:
La gestión integral de **eventos privados de pequeño formato SIN pernoctación** está mal atendida. Las soluciones disponibles son:
- Herramientas enterprise: caras, complejas, sobredimensionadas
- Soluciones "económicas": combinación manual de Gmail + Google Sheets + Drive + WhatsApp

**Nicho objetivo validado**:
- Masías sin alojamiento
- Fincas para eventos de día
- Jardines boutique
- Salones familiares
- Espacios polivalentes de pequeño/mediano formato
- Mercado estimado: 5.000-8.000 espacios solo en España

**Gap de mercado**: No existe una solución SaaS específica, asequible y fácil de usar para este segmento.

#### Puntos de dolor documentados
**Contexto del negocio**: Hace poco más de un año, mi familia y yo iniciamos Masia l'Encís, un espacio de más de 500 m² entre viñedos y olivos en el Alt Penedès, dedicado a celebraciones y eventos privados.

**Situación actual**: La gestión se realiza entre 4 personas mediante herramientas dispersas: Gmail, Google Sheets, Google Drive y WhatsApp.

**Crecimiento**: El proyecto ha tenido un crecimiento superior al esperado, lo que ha expuesto las limitaciones del modelo de gestión actual.

**Problemas operativos identificados** (mapeados como D1-D9 en la especificación funcional):

| ID | Problema | Impacto | Frecuencia |
|----|----------|---------|------------|
| **D1** | No sabemos siempre en qué punto está cada consulta | Pérdida de seguimiento, duplicación de trabajo | Diaria |
| **D2** | No tenemos claramente definidos los estados de una solicitud | Confusión, falta de criterio común | Permanente |
| **D3** | Hemos estado a punto de comprometer la misma fecha dos veces | Riesgo crítico de reputación y legal | 2 veces |
| **D4** | No disponemos de un historial de reservas centralizado | Imposibilidad de analizar recurrencia, estacionalidad | Permanente |
| **D5** | La facturación vive dispersa entre emails y Drive | Pérdida de tiempo, riesgo fiscal | Mensual |
| **D6** | No hay dashboard de seguimiento de consultas/reservas | Falta de visibilidad operativa | Permanente |
| **D7** | No hay dashboard de ocupación y facturación | Imposibilidad de análisis financiero | Permanente |
| **D8** | Correos y presupuestos se redactan manualmente con plantillas dispares | Pérdida de tiempo, inconsistencias de marca | Por cada lead |
| **D9** | No hay fichas organizadas ni sistema de recordatorios | Riesgo de olvidar tareas críticas | Semanal |

**Diagnóstico**: Lo que empezó como una ilusión compartida se ha convertido en una **carga operativa** que erosiona la calidad del servicio y limita la capacidad de crecer.

**Conclusión de Discovery**: Slotify resuelve un problema real, tiene un caso de uso piloto validado y un mercado desatendido. **Proyecto viable para TFM**.

---

#### Alcance del MVP

**Principio arquitectónico**: Aunque el modelo de datos se define desde el día 1 como **multi-tenant**, el MVP se construye con un único flujo operativo (el de Masia l'Encís) para evitar sobre-ingeniería y scope creep.

**Funcionalidades incluidas en el MVP TFM** (✅):

1. **Gestión completa del ciclo de vida de una reserva**
   - Estados principales: consulta → pre_reserva → reserva_confirmada → evento_en_curso → post_evento → reserva_completada
   - Sub-estados de consulta: 2.a (exploratoria), 2.b (con fecha), 2.c (pendiente invitados), 2.d (cola), 2.v (visita), 2.x/2.y/2.z (terminales)
   - Máquina de estados con 16+ transiciones válidas

2. **Bloqueo atómico de fechas**
   - Basado en constraint UNIQUE en PostgreSQL
   - Transacciones con SELECT ... FOR UPDATE
   - Bloqueo condicional según madurez del lead (3/6/7 días hasta firme)
   - Sin Redis ni locks distribuidos (decisión arquitectónica)

3. **Cola de espera automática**
   - FIFO para fechas saturadas
   - Activación solo cuando consulta bloqueante está en estado 2.b
   - Promoción automática al expirar la consulta bloqueante
   - Vaciado automático si la bloqueante avanza a pre-reserva

4. **Sub-procesos paralelos**
   - Pre-evento (ficha operativa) + Liquidación (60% restante) corren en paralelo desde confirmación de reserva
   - No son secuenciales: se pueden completar en cualquier orden
   - Ambos deben estar cerrados para que el evento pueda iniciarse

5. **Backoffice de reservas**
   - Vista de calendario visual
   - Gestión de estados explícita
   - Historial de consultas y reservas
   - Audit log completo

6. **Motor de cálculo de tarifas**
   - Configurable por tenant
   - Variables: tipo_evento, num_invitados, dia_semana, temporada, extras
   - Cálculo interno (no visible al cliente en formulario público)

7. **Generación automatizada de PDFs y emails**
   - Respuestas a consultas iniciales
   - Presupuestos
   - Facturas (señal 40%, liquidación 60%)
   - Condiciones particulares del espacio
   - Confirmaciones de reserva
   - Recordatorios

8. **Dashboard de negocio**
   - KPIs: ocupación, ingresos, ratio consulta-reserva, tiempo promedio de conversión
   - Exports CSV para análisis externo

**Funcionalidades diseñadas pero NO implementadas en MVP** (📐):
- Detección automática de leads recurrentes
- Emails de cola (notificación de entrada/salida)
- Importador CSV de histórico
- Factura complementaria
- Integración Stripe para pagos online
- Integración WhatsApp
- Dashboard financiero avanzado
- Multi-espacio (un tenant, múltiples espacios)

**Justificación del alcance ambicioso**:
1. El proceso end-to-end debe estar completo para tener valor demostrable
2. La cola y los sub-procesos paralelos son diferenciadores competitivos
3. Estas áreas son ideales para demostrar SDD+TDD asistido por IA (lógica compleja, concurrencia, race conditions)

---

#### Stack tecnológico seleccionado

**Decisión**: Monorepo TypeScript full-stack con arquitectura hexagonal en backend
| Capa | Tecnología | Justificación |
|------|------------|---------------|
| **Monorepo** | Turborepo | Gestión unificada de apps/web, apps/api, packages/shared |
| **Frontend** | Vite + React + TypeScript | SPA moderna, build rápido, excelente DX |
| **UI** | Tailwind CSS + shadcn/ui | Sistema de diseño profesional y accesible out-of-the-box |
| **Backend** | NestJS + TypeScript | Framework opinado, módulos, DI, perfecto para hexagonal |
| **ORM** | Prisma | Type-safe, migraciones, generación de tipos |
| **Base de datos** | PostgreSQL | Robustez, transacciones ACID, Row-Level Security nativo |
| **Contrato API** | OpenAPI | Cliente HTTP autogenerado desde spec del backend |
| **Auth** | JWT | Access token en memoria + refresh token en cookie httpOnly |
| **Email** | Resend / Postmark | APIs modernas para transaccional |
| **PDF** | Puppeteer o react-pdf | Generación de facturas y presupuestos |
| **CI/CD** | GitHub Actions | Integración nativa con repositorio |
| **Testing** | Jest + Testing Library | Suite completa para TDD |

**Decisión clave**: Cliente HTTP del frontend generado automáticamente desde el contrato OpenAPI del backend para garantizar type-safety end-to-end.

---

#### Decisiones estratégicas tomadas en Discovery

**1. Tarifa NO visible al cliente en formulario público**

**Propuesta inicial de Claude**: Formulario web con cálculo de tarifa instantánea visible al cliente.

**Mi objeción** (basada en conocimiento del negocio):  
> "Priorizo hacer un primer contacto y poder negociar directamente con el cliente. Quiero ver la demanda inicial del espacio, no que por el posible embudo de las tarifas se queden fuera ciertos contactos sin que tenga visibilidad ni oportunidad de negociar."

**Decisión final**: La tarifa se pre-calcula en el backoffice para uso del gestor, pero el cliente no ve precios en el formulario público (**progressive disclosure of friction**). Esto maximiza el contacto inicial y permite negociación caso por caso.

**2. Multi-tenancy desde día 1, pero un único flujo visible**

Estrategia **"opinado por fuera, configurable por dentro"**:
- MVP construido con el flujo de Masia l'Encís (único flujo visible)
- Arquitectura interna preparada para multi-tenant (todo configurable por tenant desde día 1)
- Permite escalar sin reescribir el core cuando lleguen más clientes

---

### 1.2 Sesión de refinamiento con Claude Projects y Perplexity

**Herramientas**: ChatGPT (AI Mega-Prompt Generator) → Claude Projects → Perplexity

#### Proceso seguido

1. **Generación de system prompt**  
   - Uso de Custom GPT (AI Mega-Prompt Generator) en ChatGPT
   - Input: contexto del negocio, puntos de dolor, objetivos
   - Output: System prompt profesional para PM senior especializado en SaaS de eventos
   - Ver [prompts.md](prompts.md#prompt-2-refinamiento-funcional)

2. **Ejecución en paralelo**  
   - Claude Projects: especificación funcional detallada
   - Perplexity: especificación funcional básica
   - **Decisión**: Claude Projects genera output significativamente más completo → seleccionado para iterar

3. **Iteración del PRD**  
   - 8 rondas de refinamiento con Claude Projects
   - Validación de decisiones arquitectónicas críticas
   - Documentación de edge cases
   - Definición de la máquina de estados completa

#### Decisiones técnicas y arquitectónicas clave

#### Estrategia "opinado por fuera, configurable por dentro"

**Decisión de mayor calado**: El producto se construye con un único flujo operativo visible (Masia l'Encís), pero internamente todo lo configurable se modela como configuración por tenant desde el día 1:
- Máquina de estados
- TTLs (time-to-live) de bloqueos
- Porcentajes de pago (señal/liquidación)
- Plantillas de emails y PDFs
- Tipos de evento
- Políticas de cancelación
- Reglas de liquidación tardía

**Ventaja**: MVP simple y opinado para el caso piloto, pero arquitectura escalable sin reescribir el core.

**Riesgo aceptado**: Clientes con operativa radicalmente distinta a Masia l'Encís quedan fuera del MVP/V1.

#### Decisiones arquitectónicas no negociables

Fijadas desde el día 1 para sostener la estrategia anterior:

1. **Multi-tenancy nativo**
   - `tenant_id` en cada tabla de negocio
   - Row-Level Security (RLS) activo en PostgreSQL
   - Tenant y rol viajan en payload JWT firmado

2. **La reserva como agregado raíz** (DDD)
   - Toda lógica de estado, bloqueo y cola orbita alrededor de la entidad Reserva
   - El cliente es un atributo de la reserva, no una entidad central

3. **Máquina de estados, TTLs, porcentajes y plantillas como configuración por tenant**
   - Nunca hardcodeados en el código
   - Almacenados en tablas de configuración

4. **Audit log completo**
   - Sobre reservas y facturas
   - Inmutabilidad de eventos históricos

5. **Eventos de dominio como base de automatizaciones**
   - Patrón event-driven para notificaciones, transiciones de estado, jobs asíncronos

6. **Transacciones atómicas para operaciones críticas**
   - Bloqueo de fecha con `SELECT ... FOR UPDATE`
   - Operaciones de cola (promoción, reordenación)

7. **Sub-procesos paralelos modelados como campos independientes**
   - `pre_evento_status` y `liquidacion_status` en la entidad Reserva
   - No son secuenciales, pueden completarse en cualquier orden

8. **Consultas como entidades inmutables**
   - Las reaperturas crean entidades nuevas vinculadas via `consulta_vinculo_id`
   - Nunca se "reabre" una consulta terminal

9. **Índices específicos para operaciones críticas**
   - `email_normalized` para detección de recurrencia
   - `consulta_bloqueante_id, posicion_cola` para promoción eficiente

10. **Cola modelada como campos en la entidad Reserva**
    - No como tabla aparte
    - Mantiene cohesión y simplifica queries

#### Decisiones funcionales
A nivel funcional, las decisiones tomadas en esta fase reconfiguran cómo se entiende el negocio en el producto. La primera y más estructural es que **la reserva es la entidad central, no el cliente**: la mayoría de clientes en eventos privados no son recurrentes, por lo que el activo informacional clave es el histórico de reservas, no una visión cliente-céntrica al estilo CRM. El cliente queda como un atributo de la reserva.

El flujo financiero queda fijado en **pre-pago: 40% de señal en la confirmación y 60% de liquidación antes del evento** (deadline T-1d), descartando explícitamente el modelo de cobro post-evento. Asimismo, se ha decidido que el **pre-evento y la liquidación corran en paralelo** desde la confirmación de la reserva, no en secuencia, reflejando cómo trabaja realmente una masía: definir los detalles del evento y cobrar son procesos ortogonales que deben poder avanzar a su ritmo. El día del evento solo se ejecuta si ambos sub-procesos están cerrados.

El **bloqueo de fecha es condicional según la madurez del lead**: 3 días si el cliente indica fecha concreta en consulta, 3 días adicionales si falta confirmar el número de invitados, 7 días al pasar a pre-reserva con presupuesto enviado, y firme tras el cobro de la señal.

Se ha discutido y resuelto cómo gestionar dos casos de uso reales y frecuentes que hasta ahora se trataban de forma ad-hoc. El primero, **leads recurrentes**: las consultas son entidades inmutables; cuando un cliente vuelve tras una consulta terminal, se crea una entidad nueva vinculada automáticamente por detección de email, con pre-relleno de los datos heredados y posibilidad de desvincular manualmente desde la UI. Los clientes recurrentes no tienen prioridad sobre otros leads activos. El segundo, **cola de espera en fechas saturadas**: cuando un lead solicita una fecha bloqueada por otra consulta en estado 2.b, se le coloca automáticamente en una cola FIFO con notificación al cliente y opción a salir voluntariamente. Si la consulta bloqueante expira, el primero en cola es promovido automáticamente; si avanza a pre-reserva o a estado 2.c (porque el cliente da su palabra), la cola se vacía y se notifica a los descartados. La cola solo se activa con la bloqueante en 2.b, lo que acota el tiempo máximo de espera a 3 días.

Para soportar estos dos casos, se han incorporado nuevos estados terminales en el sub-estado consulta: `2.x consulta_expirada`, `2.y consulta_descartada_por_cola` y `2.z consulta_descartada_por_cliente`. Esta distinción es relevante porque permite analíticamente entender por qué se pierde cada lead y no distorsiona el funnel de conversión.

#### Decisiones alcance del MVP

El alcance del MVP TFM incluye el proceso completo end-to-end de una reserva, los sub-procesos paralelos pre-evento + liquidación, y la cola de espera con toda su mecánica. Es un alcance ambicioso pero asumido conscientemente por tres razones:

1. **El proceso de una reserva debe estar completo para tener valor demostrable.** Sub-procesos paralelos y cola son parte sustancial de la propuesta diferencial; recortarlos vaciaría el producto.
2. **La cola y los sub-procesos paralelos son donde más se puede aprovechar la IA en SDD+TDD.** Son lógica de negocio compleja con muchos edge cases y race conditions: terreno donde TDD asistido por IA aporta valor académico claro.
3. **Quedan fuera del MVP** las funcionalidades que no afectan al ciclo principal: detección de recurrentes, emails de cola, importador CSV, dashboard financiero completo, factura complementaria, Stripe, WhatsApp. Todas están diseñadas en este PRD pero no implementadas.

---

#### System Prompt actualizado en Claude Projects

Después de iterar con el asistente para obtener una especificación funcional validada, actualicé el system prompt en Claude Projects para fijar el contexto permanente:

---

### SYSTEM ROLE:

Eres un Product Manager senior especializado en plataformas SaaS B2B para gestión integral de espacios de eventos privados de pequeño y mediano formato (masías, fincas, jardines, villas, salones boutique y espacios familiares).

Actualmente acompañas el desarrollo de **Slotify**, plataforma SaaS multi-tenant cuyo caso piloto es **Masia l'Encís**. El proyecto se desarrolla como Trabajo Final de Máster con deadlines: documentación técnica 12/06/2026, código funcional 10/07/2026, entrega final 29/07/2026. El desarrollo se realiza con metodologías **SDD (Spec-Driven Development) + TDD (Test-Driven Development) asistido por IA** en todas las fases del SDLC.

### FUENTE DE CONOCIMIENTO

La especificación funcional completa de Slotify está adjunta al proyecto como `EspecificacionFuncional.md`. Esa especificación es la **fuente de verdad** del producto. Antes de responder cualquier pregunta funcional, arquitectónica o de alcance, consúltala.

Reglas de uso de la spec:
- Si la spec ya decide algo (especialmente §13 "Decisiones cerradas"), **respétalo**. No propongas alternativas salvo que el usuario las cuestione explícitamente.
- Si una pregunta toca un área marcada **"📐 Solo diseñado"** en §9.2, recuérdalo: forma parte del PRD pero **no se construye en el MVP TFM**.
- Si una pregunta toca un área marcada **"✅ Implementado en MVP TFM"**, esa funcionalidad sí está en alcance de construcción.
- Si detectas una **contradicción** entre la spec y la pregunta del usuario, señálala antes de responder.
- Si la spec **no cubre** un caso, dilo explícitamente antes de proponer.
- No inventes comportamientos no documentados como si estuvieran en la spec.

### TU FUNCIÓN

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

### MODELO MENTAL OBLIGATORIO DE SLOTIFY

Estas son piedras angulares del producto. Cualquier diseño debe respetarlas:

- **La reserva es la entidad central.** El cliente es un atributo de la reserva. Nunca propongas diseños cliente-céntricos tipo CRM.
- **Un tenant = un espacio.** Multi-espacio queda fuera de alcance hasta V3+.
- **Pipeline jerárquico de estados** con sub-estados de consulta (2.a, 2.b, 2.c, 2.d, 2.x, 2.y, 2.z), sub-procesos paralelos pre_evento + liquidación, y estados terminales inmutables.
- **Cola FIFO automática** activa solo cuando la consulta bloqueante está en 2.b. Promoción, vaciado y reordenación son automáticos.
- **Bloqueo de fecha condicional según madurez del lead**: 3 días en consulta con fecha, +3 si falta nº invitados, 7 días en pre-reserva, firme en reserva confirmada.
- **Liquidación pre-evento, no post-evento**: 40% señal + 60% liquidación con deadline T-1d.
- **Consultas son entidades inmutables.** Las reaperturas crean entidad nueva vinculada vía `consulta_vinculo`. Nunca propongas "reabrir" una consulta terminal.
- **Estrategia "opinado por fuera, configurable por dentro"**: un único flujo visible al usuario, pero TTLs, porcentajes, plantillas y máquina de estados como configuración por tenant desde el día 1.

### CÓMO DEBES RESPONDER

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

### ESTILO

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

### RIESGOS CRÍTICOS VIVOS DEL PROYECTO

Mantén estos riesgos presentes en cualquier diseño o recomendación:

- **R1 — Doble reserva y race conditions**: en bloqueo de fecha y, especialmente, en promoción/reordenación de cola.
- **R2 — Scope creep**: el MVP TFM ya es ambicioso para el plazo y la dedicación parcial.
- **R3 — Importador histórico**: sin él, no hay migración real del cliente piloto (📐 solo diseñado

---

### 1.3 Creación del proyecto en directorio local

**Objetivo**: Inicializar la estructura del proyecto en entorno local para comenzar el trabajo de especificación y generación de artefactos

**Acciones realizadas**:

1. **Creación del repositorio Git local**
   - Inicialización con `.gitignore` para Node.js y TypeScript
   - Configuración de Git con convenciones de commit semántico
   - Branch principal: `main`

2. **Estructura inicial de directorios**
   ```
   AI4Devs-finalproject/
   ├── context/              # Documentos estratégicos y contexto de negocio
   │   ├── lean-canvas-slotify.drawio
   │   └── SlotifyGeneralSpecs.md
   ├── docs/                 # Artefactos técnicos (use cases, ER, arquitectura, C4)
   ├── user-stories/         # Historias de usuario y backlog
   ├── scripts/              # Scripts de automatización (Python)
   ├── AGENTS.md             # Contexto para agentes de código
   ├── bitacora.md           # Este documento
   ├── prompts.md            # Registro de prompts ejecutados
   └── readme.md             # Documentación del proyecto
   ```

3. **Documentos de contexto iniciales**
   - `SlotifyGeneralSpecs.md`: Especificación funcional completa (resultado de la fase de refinamiento)
   - `AGENTS.md`: Contexto para agentes de código con reglas arquitectónicas críticas
   - `prompts.md`: Registro de prompts principales ejecutados en cada fase
   - `readme.md`: Descripción general del proyecto, stack, y cómo ejecutarlo

**Herramienta principal**: GitHub Copilot (modelo Claude Sonnet 4.6) en VS Code como asistente de desarrollo

**Prompt utilizado**: Ver [prompts.md](prompts.md#prompt-2-setup-proyecto)

---

## FASE 2: DISEÑO DE ARTEFACTOS
 
**Objetivo**: Generar los artefactos técnicos necesarios para fundamentar el desarrollo del MVP

**Principio aplicado**: Generar artefactos en orden lógico de dependencias:
1. Use Cases (qué hace el sistema)
2. ER Diagram (qué datos necesita)
3. Architecture Diagram (cómo se organiza)
4. C4 Diagrams (niveles de detalle arquitectónico)
5. Documentación consolidada (decisiones y justificaciones)

---

### 2.1 Casos de uso (Use Cases)

**Herramienta**: GitHub Copilot (Claude Sonnet 4.6) en VS Code  
**Prompt base**: Ver [prompts.md](prompts.md#prompt-3-generacion-use-cases)

**Contexto adjunto al prompt**:
- `context/SlotifyGeneralSpecs.md`: Especificación funcional completa
- Alcance explícito del MVP (funcionalidades ✅ vs funcionalidades 📐)
- Instrucción de cubrir toda la funcionalidad contemplada en la primera fase del producto

**Estrategia de ejecución**:
- Generación en una sola sesión (evita fragmentación y pérdida de contexto)
- Validación de cobertura contra la especificación funcional
- Revisión de consistencia entre casos de uso relacionados

**Resultado**: 41 casos de uso documentados en [docs/use-cases.md](docs/use-cases.md)

**Cobertura funcional detallada**:

| Área funcional | Casos de uso | Rango |
|----------------|--------------|-------|
| Gestión de consultas | 13 | UC-001 a UC-013 |
| Gestión de pre-reservas | 7 | UC-014 a UC-020 |
| Gestión de reservas confirmadas | 10 | UC-021 a UC-030 |
| Gestión de eventos | 8 | UC-031 a UC-038 |
| Bloqueo de fechas y cola | 3 | UC-039 a UC-041 |

**Formato del documento**:
- Cada caso incluye: actores, precondiciones, flujo principal, flujos alternativos, postcondiciones, reglas de negocio
- Trazabilidad explícita a requisitos funcionales de la especificación
- Validación de casos críticos: bloqueo atómico (UC-040), cola de espera (UC-017-020), sub-procesos paralelos (UC-025-030)

**Validación realizada**:
- ✅ Todos los estados de la máquina de estados están cubiertos
- ✅ Todas las transiciones válidas tienen su caso de uso
- ✅ Casos de concurrencia y race conditions documentados explícitamente
- ✅ Edge cases de cola de espera cubiertos (promoción, vaciado, salida voluntaria)

---

### 2.2 Diagrama Entidad-Relación (ER Diagram)

**Herramienta**: GitHub Copilot + Claude Projects (para refinamiento)  
**Prompt base**: Adaptación del prompt compartido por el mentor Daniel  
Ver [prompts.md](prompts.md#prompt-4-generacion-er-diagram)

**Contexto adjunto al prompt**:
- `docs/use-cases.md`: 41 casos de uso generados en la fase anterior
- `context/SlotifyGeneralSpecs.md`: Especificación funcional (como validación)
- Indicación explícita: alcance MVP

**Desafío encontrado en primera iteración**:

El primer artefacto generado por Copilot tomó decisiones de modelado **no fieles a las especificaciones**:
- ❌ Separaba `Reserva` y `Consulta` como entidades distintas (contradice la decisión arquitectónica de que "la reserva es el agregado raíz")
- ❌ Modelaba la cola como tabla separada (contradice la decisión de modelarla como campos en la propia reserva)
- ❌ Cliente como entidad separada (contradice la decisión de desnormalizar cliente en reserva)

**Solución aplicada**:

1. **Iteración en Claude Projects** (4 rondas de refinamiento)
   - Prompt específico: "Valida este ER diagram contra las decisiones arquitectónicas de SlotifyGeneralSpecs.md"
   - Resultado: Claude identificó las 3 inconsistencias principales
   - Generación de versión corregida con justificaciones

2. **Comparación lado a lado**: Copilot v1 vs Claude v1 vs Claude v2 final

3. **Validación contra principios DDD**:
   - ✅ Reserva como agregado raíz
   - ✅ Consistencia transaccional dentro del agregado
   - ✅ Referencias por ID fuera del agregado

**Artefacto final**: [docs/er-diagram.md](docs/er-diagram.md)

**Entidades principales del modelo**:

| Entidad | Propósito | Decisiones clave |
|---------|-----------|------------------|
| **TENANT** | Configuración multi-tenant | Único, con config de máquina de estados, TTLs, porcentajes, plantillas |
| **USUARIO** | Gestores del espacio | Rol (admin/gestor) en JWT |
| **RESERVA** | Agregado raíz | Cliente desnormalizado, cola como campos, sub-estados paralelos |
| **FECHA_BLOQUEADA** | Gestión atómica de bloqueos | Constraint UNIQUE(tenant_id, fecha) — sin Redis |
| **FACTURA** | Señal (40%) y liquidación (60%) | Una o dos facturas por reserva |
| **DOCUMENTO** | PDFs generados | Presupuestos, condiciones, fichas operativas |
| **AUDIT_LOG** | Trazabilidad completa | Inmutabilidad de eventos históricos |

**Decisiones de modelado críticas documentadas**:
1. Cliente desnormalizado en RESERVA (`cliente_nombre`, `cliente_email`, `cliente_telefono`)
2. Cola modelada como campos: `consulta_bloqueante_id`, `posicion_cola`, `cola_entrada_at`
3. Sub-procesos paralelos: `pre_evento_status`, `liquidacion_status` (no secuenciales)
4. Consultas inmutables con vinculación: `consulta_vinculo_id` (para leads recurrentes)
5. Índices específicos: `email_normalized`, `consulta_bloqueante_id + posicion_cola`

**Validación final**:
- ✅ Soporta las 41 casos de uso
- ✅ Respeta las 10 decisiones arquitectónicas no negociables
- ✅ Permite transacciones atómicas para bloqueo de fecha y cola
- ✅ Modelo preparado para multi-tenancy desde día 1

---

### 2.3 Diagrama de Arquitectura (Architecture Diagram)

**Herramienta**: GitHub Copilot + Claude Projects + Diagrams GPT  
**Prompt base**: Adaptación del prompt compartido por el mentor Daniel  
Ver [prompts.md](prompts.md#prompt-5-generacion-arch-diagram)

**Contexto adjunto al prompt**:
- `docs/use-cases.md` + `docs/er-diagram.md`
- Validación explícita: toda la funcionalidad del MVP debe estar representada
- Instrucción crítica: **no sobredimensionar** el diseño, enfocarse solo en componentes necesarios para el MVP

**Problema inicial — Sobre-ingeniería**:

El resultado inicial de Copilot incluía componentes innecesarios para el MVP:
- ❌ Redis para caché y locks distribuidos
- ❌ Cola de mensajes (RabbitMQ/SQS)
- ❌ Separación en microservicios (API Gateway, servicios independientes)
- ❌ CDN para assets
- ❌ ElasticSearch para búsqueda

**Análisis del problema**: Los LLMs tienden a generar arquitecturas "ideales" o "enterprise-grade" cuando no se les guía explícitamente hacia la simplicidad.

**Proceso iterativo aplicado**:

1. **Versión 1 (Copilot)**: Arquitectura inicial (sobre-ingenierizada)
2. **Versión 2 (Claude Projects)**: Solicitud explícita de arquitectura simplificada para MVP
3. **Comparación lado a lado**: Identificación de diferencias clave
4. **Versión 3.1**: Refinamiento colaborativo (qué componentes son realmente necesarios)
5. **Versión 3.2 FINAL**: Arquitectura óptima — simplicidad sin sacrificar escalabilidad futura

**Prompt de refinamiento clave**:
> "Genera una arquitectura minimalista para MVP de 3 meses. Solo componentes esenciales. Sin Redis, sin colas distribuidas, sin microservicios. Monolito modular bien diseñado que pueda escalar más adelante."

**Artefacto final**: [docs/architecture.md](docs/architecture.md)

**Componentes principales (simplificados para MVP)**:

**Capa de Frontend**:
- SPA React + Vite
- Tailwind CSS + shadcn/ui
- Cliente HTTP autogenerado desde OpenAPI

**Capa de Backend (monolito modular)**:
- API NestJS con arquitectura hexagonal
  - `/domain`: Lógica de negocio pura (agregados, value objects, eventos de dominio)
  - `/application`: Casos de uso (orquestación, transacciones)
  - `/infrastructure`: Adaptadores (DB, email, PDF, auth)
- OpenAPI spec autogenerada desde decoradores NestJS

**Capa de Datos**:
- PostgreSQL con Row-Level Security
- Prisma ORM (type-safe, migraciones)
- Sin caché adicional (PostgreSQL es suficiente para MVP)

**Servicios externos**:
- Email transaccional: Resend o Postmark
- Generación de PDFs: Puppeteer (server-side)

**Decisiones arquitectónicas críticas**:

| Decisión | Justificación |
|----------|---------------|
| **Monolito modular** (no microservicios) | Simplicidad operativa, despliegue único, transacciones ACID nativas |
| **Sin Redis** | Bloqueo atómico con PostgreSQL (constraint UNIQUE + SELECT FOR UPDATE) |
| **Sin cola de mensajes** | Jobs asíncronos con patrón "estado en fila + barrido periódico" (campo `ttl_expiracion` + cron) |
| **Arquitectura hexagonal** | Preparación para futuro sin acoplar el dominio a frameworks |
| **Cliente HTTP autogenerado** | Type-safety end-to-end, contrato garantizado |

**Validación de cobertura funcional**:
- ✅ Gestión completa del ciclo de vida de reservas
- ✅ Bloqueo atómico de fechas (sin locks distribuidos)
- ✅ Cola de espera (sin sistema de colas externo)
- ✅ Sub-procesos paralelos (modelados como campos de estado)
- ✅ Motor de tarifas (lógica en dominio)
- ✅ Generación de PDFs y emails (adaptadores en infraestructura)
- ✅ Dashboard de KPIs (queries optimizadas con índices)

**Lección clave aprendida**: Resistir la tentación de agregar tecnología "por si acaso". Cada componente agregado es deuda operativa. El MVP debe ser lo más simple posible que resuelva el problema.

---

### 2.4 Diagramas C4

**Herramienta**: GitHub Copilot + Claude Projects  
**Prompt base**: Adaptación del prompt del mentor Daniel  
Ver [prompts.md](prompts.md#prompt-6-generacion-c4-diagrams)

**Contexto adjunto al prompt**:
- `docs/architecture.md`: Arquitectura v3.2 final
- Petición explícita de 3 niveles: Context, Container, Component

**Artefacto generado**: [docs/c4-diagrams.md](docs/c4-diagrams.md)

**Niveles documentados**:

1. **C4 Context** (vista de sistema en su ecosistema)
   - Actores: Gestor del espacio, Cliente (lead), Sistema de email, Sistema de facturación
   - Sistema: Slotify (caja negra)
   - Relaciones: qué hace cada actor con el sistema

2. **C4 Container** (apps y servicios principales)
   - Frontend SPA (React + Vite)
   - Backend API (NestJS)
   - Base de datos (PostgreSQL)
   - Servicios externos (Resend/Postmark, Puppeteer)

3. **C4 Component** (módulos internos del backend)
   - ReservasModule (core del negocio)
   - BloqueoModule (gestión atómica de fechas)
   - ColaModule (promoción, vaciado)
   - TarifasModule (motor de cálculo)
   - EmailModule, PDFModule (generación de documentos)
   - AuthModule (JWT)
   - DashboardModule (KPIs)

**Formato**: Diagramas en notación Mermaid (renderizables en Markdown)

**Valor aportado**: Los diagramas C4 sirven como mapa para desarrolladores nuevos en el proyecto y como documentación viva para el TFM.

---

### 2.5 Documentación consolidada de arquitectura del sistema

**Herramienta**: GitHub Copilot  

**Acción realizada**: 

Consolidación de todos los artefactos anteriores (use-cases, ER diagram, architecture, C4) en una **documentación unificada** con:
- Decisiones arquitectónicas con justificaciones
- Trade-offs aceptados (qué se sacrifica y por qué)
- Evolución futura (cómo escalar más adelante)
- Diagramas definitivos

**Prompt utilizado**: Ver [prompts.md](prompts.md#prompt-7-consolidacion-arquitectura)

**Output**: Actualización de [docs/architecture.md](docs/architecture.md) con secciones adicionales:
- § Decisiones arquitectónicas no negociables (10 principios)
- § Trade-offs aceptados conscientemente
- § Deuda técnica conocida y plan de abordaje
- § Evolución a V2/V3 (cuándo agregar Redis, cuándo microservicios)

**Valor aportado**: Documentación completa de la arquitectura del sistema lista para el desarrollo y para la memoria del TFM.

---

## FASE 3: HISTORIAS DE USUARIO Y BACKLOG

**Objetivo**: Descomponer la funcionalidad en historias de usuario implementables y construir un backlog priorizado

---

### 3.1 Generación de historias de usuario

**Herramienta**: GitHub Copilot (Claude Sonnet 4.6)  
**Prompt base**: Ver [prompts.md](prompts.md#prompt-8-generacion-user-stories)

**Estrategia adoptada**: Generación **por área funcional** para evitar problemas de contexto

**Justificación**: Los LLMs tienen límites de contexto. Generar las 48 historias de una sola vez provocaría pérdida de coherencia. La generación por área funcional mantiene consistencia interna.
**Historias iniciales de setup**: US-000 (scaffolding) y US-000A (app-shell con layout y navegación)

---

### 3.2 Análisis de dependencias del backlog

**Herramienta**: Script Python determinista + GitHub Copilot  
**Script utilizado**: `scripts/extract_backlog.py`

**Proceso**:
1. **Extracción automatizada** de dependencias entre las 48 user stories
2. **Construcción del grafo** de dependencias (fan-out, ciclos, profundidad)
3. **Generación de análisis** como fuente de verdad del grafo

**Output**:
- `user-stories/_analisis.json`: Grafo completo de dependencias
- `user-stories/_trazabilidad.md`: Documento de trazabilidad

**Prompt utilizado**: Ver [prompts.md](prompts.md#prompt-6-analisis-dependencias)

---

### 3.3 Clasificación y estimación del backlog

**Herramienta**: GitHub Copilot  
**Input**: Análisis de dependencias generado en 3.2

**Proceso** (con prompt específico):
1. **Clasificar historias por capa arquitectónica**:
   - Fundacional: infraestructura, autenticación, setup
   - Spine: casos de uso core del negocio
   - Soporte: dashboards, reportes, UX

2. **Estimar talla técnica**: XS, S, M, L, XL  
   Criterios: complejidad lógica, riesgo de concurrencia, integraciones

3. **Generar backlog ordenado** como entrada para planificación de sprints

**Output**: `user-stories/_backlog.json`

**Prompt utilizado**: Ver [prompts.md](prompts.md#prompt-7-clasificacion-backlog)

---

## FASE 4: DISEÑO UX/UI

**Estado**: ✅ **COMPLETADO** (pendiente migración a Figma)

### 4.1 Diseño de pantallas principales y sistema de diseño

**Herramienta**: Google Stitch (Stitch Design)  
**Objetivo**: Diseñar las pantallas principales del MVP y establecer un sistema de diseño coherente

**Acciones realizadas**:

1. **Diseño de pantallas principales**
   - Vista de calendario de reservas (vista mensual y semanal)
   - Detalle de reserva (con máquina de estados visual)
   - Formulario de alta de consulta
   - Dashboard de KPIs y métricas
   - Vistas de gestión de pre-reservas
   - Pantallas de sub-procesos paralelos (pre-evento + liquidación)
   - Modal de cola de espera

2. **Sistema de diseño generado**
   - **Design tokens**: Colores, tipografía, espaciados, sombras
   - **Componentes base**: Botones, inputs, cards, modals, badges
   - **Componentes compuestos**: Calendario, tarjetas de reserva, estados visuales
   - **Patrones de interacción**: Notificaciones, mensajes de error, confirmaciones
   - **Responsive breakpoints**: Mobile, tablet, desktop

3. **Decisiones de diseño clave**
   - Uso de shadcn/ui como base de componentes (alineado con el stack técnico)
   - Paleta de colores semántica para estados de reserva
   - Indicadores visuales claros para sub-estados de consulta (2.a, 2.b, 2.c, 2.d, etc.)
   - Diseño centrado en usabilidad para usuarios no técnicos

**Resultado**: 15+ pantallas diseñadas en Google Stitch con sistema de diseño completo

---

### 4.2 Plan de migración a Figma

**Estado**: 📋 **PLANIFICADO**  
**Objetivo**: Migrar los diseños de Google Stitch a Figma para facilitar la integración con el desarrollo

**Plan de migración**:
1. Recrear sistema de diseño en Figma (design tokens, componentes)
2. Migrar las 15+ pantallas principales
3. Configurar variantes de componentes para estados
4. Documentar convenciones de nomenclatura
5. Exportar especificaciones técnicas

---

### 4.3 Integración con desarrollo frontend (planificado)

**Estado**: 📋 **PLANIFICADO PARA FASE DE DESARROLLO**

**Estrategia adoptada**: Conexión de subagente desarrollador frontend a Figma vía MCP

**Componentes de la estrategia**:

1. **MCP (Model Context Protocol) para Figma**
   - Plugin MCP instalado en Figma
   - Acceso programático a diseños, componentes y specs
   - Sincronización automática de cambios de diseño

2. **Subagente desarrollador frontend**
   - Acceso directo a los diseños en Figma vía MCP
   - Generación de componentes React pixel-perfect desde diseño
   - Validación automática de implementación vs diseño

3. **DESIGN.md como fuente de verdad**
   - Sistema de diseño documentado (tokens, componentes, patrones)
   - Convenciones de nomenclatura (componentes, variantes, props)
   - Reglas de accesibilidad (WCAG 2.1 AA)
   - Guías de responsive design
   - Decisiones de UX con justificaciones

**Valor esperado**:
- Desarrollo frontend más rápido y preciso
- Consistencia visual garantizada
- Menor fricción entre diseño y desarrollo
- Documentación viva del sistema de diseño

**Artefactos a generar**:
- `docs/DESIGN.md`: Documentación completa del sistema de diseño
- Biblioteca de componentes shadcn/ui customizados
- Storybook con todos los componentes documentados

---

### 4.4 Flujos de navegación y arquitectura de información

**Realizado en Google Stitch, pendiente de formalizar en Figma**

**Flujos principales diseñados**:

1. **Flujo de consulta → pre-reserva → reserva confirmada**
   - Happy path completo
   - Gestión de excepciones (expiración, descarte)
   
2. **Flujo de cola de espera**
   - Entrada automática en cola
   - Notificación de posición
   - Promoción automática
   - Salida voluntaria

3. **Flujo de sub-procesos paralelos**
   - Vista unificada de pre-evento + liquidación
   - Indicadores de progreso independientes
   - Bloqueo condicional del inicio de evento

4. **Flujo de dashboard y reportes**
   - Vista de KPIs principales
   - Exportación de datos (CSV)
   - Filtros por fecha, estado, tipo de evento

**Decisión de navegación**: Single Page Application (SPA) con navegación lateral fija y breadcrumbs para contexto

---

### 4.6 Próximos pasos en UX/UI

**Inmediatos** (antes de iniciar desarrollo):
1. Migración completa de diseños a Figma 
2. Generación de `docs/DESIGN.md` 
3. Configuración de MCP plugin en Figma
4. Exportación de specs técnicas para desarrollo

**Durante desarrollo**:
1. Iteración de diseños según feedback de implementación
2. Testing de usabilidad con usuarios reales (caso piloto)
3. Refinamiento de microinteracciones y animaciones

**Post-MVP**:
1. Testing formal de usabilidad con metodología definida
2. Optimización de flujos según métricas de uso
3. Diseño de funcionalidades de V2 (detección de recurrentes, importador CSV)

---

## FASE 5: PLANIFICACIÓN DE SPRINTS

**Estado**: 🔄 **EN PROGRESO**

### 5.1 Definición de sprints

**Pendiente de documentar**:
- Distribución de user stories por sprints
- Objetivos de cada sprint
- Capacidad estimada y velocidad

*(Esta sección se completará cuando se defina la planificación de sprints)*

---

## FASE 6: MODELO DE DATOS
 
**Estado**: ⏳ **PENDIENTE**

### 6.1 Implementación del schema de Prisma

**Pendiente de realizar**:
- Traducción del ER diagram a schema de Prisma
- Definición de índices críticos
- Configuración de Row-Level Security
- Primera migración

*(Esta sección se completará cuando se implemente el modelo de datos)*

---

## FASE 7: DESARROLLO
 
### 7.1 Diseño del Harness de Desarrollo con Claude Code

**Objetivo**: Diseñar la infraestructura de agentes IA que guiará todo el desarrollo de Slotify

Antes de escribir una sola línea de código, se tomó la decisión de invertir tiempo en diseñar el **arnés de ingeniería** que orquestaría el desarrollo asistido por IA. La premisa era clara: si íbamos a construir Slotify con Claude Code como copiloto principal, necesitábamos una arquitectura de agentes sólida, no una colección de prompts ad hoc.

#### Planteamiento

El proyecto ya contaba con una propuesta inicial de agentes en `.claude/agents`, pero ésta no había sido diseñada con visión crítica ni con conocimiento profundo del proyecto. El riesgo era evidente: agentes con responsabilidades solapadas, sin estrategia de contexto, sin hooks de guardia y sin integración real con el flujo SDD → TDD que se quería seguir.

La decisión fue **partir de cero conceptualmente**: analizar la documentación completa del proyecto, la arquitectura técnica, el contrato OpenAPI existente y las necesidades reales del flujo de desarrollo, para diseñar un harness de nivel producción.

#### Qué se quería diseñar

El harness debía cubrir cinco dimensiones críticas:

1. **Mapa de agentes**: Qué agentes conservar, cuáles eliminar, cuáles crear nuevos. Con énfasis especial en un agente Frontend que integrara el MCP de Figma para consumir diseños directamente, y agentes especializados en gobierno del contrato OpenAPI (validación, evolución, generación de SDKs y sincronización backend/frontend).

2. **Flujo completo de trabajo**: Desde la especificación (SDD) hasta la entrega documentada, pasando por los tests (TDD), la implementación y el QA. El contrato OpenAPI como fuente de verdad inamovible.

3. **Hooks de guardia**: Mecanismos automáticos que impidieran desviaciones del TDD, violaciones del contrato API o derivas arquitectónicas. El objetivo era que el propio entorno de desarrollo rechazara código que no cumpliera los estándares definidos.

4. **Estrategia de contexto**: Cómo minimizar el consumo de tokens entre agentes, cómo transferir memoria entre sesiones y cómo evitar que los agentes perdieran el hilo del proyecto en conversaciones largas.

5. **Estructura operativa**: La organización final de `.claude/agents`, `.claude/skills`, `CLAUDE.md` y los workflows diarios que el equipo (yo) seguiría durante el desarrollo.

#### Herramienta utilizada

El prompt fue ejecutado en **Claude Projects** (Claude Opus 4.5), pasándole como contexto toda la documentación técnica del proyecto disponible en `docs/`.

*(Esta sección se completará con los resultados del harness una vez ejecutado el prompt)*

### 7.1 Scaffolding del proyecto

**Pendiente de realizar**:
- Setup del monorepo con Turborepo
- Configuración de apps/web y apps/api
- Setup de Prisma, ESLint, Prettier
- Configuración de CI/CD con GitHub Actions

---

## FASE 8: TESTING

**Estado**: ⏳ **PENDIENTE**

### 8.1 Tests de bloqueo atómico de fecha

**Prioridad crítica (R1)**: Tests de concurrencia y race conditions

**Pendiente de realizar**:
- Tests unitarios de `bloquearFecha()` y `liberarFecha()`
- Tests de concurrencia con múltiples transacciones simultáneas
- Tests de integridad del constraint UNIQUE

### 8.2 Tests de máquina de estados

**Pendiente de realizar**:
- Tests de las 16+ transiciones válidas
- Tests de transiciones inválidas (deben fallar)
- Tests de guardas de transición

### 8.3 Tests de cola de espera

**Pendiente de realizar**:
- Tests de promoción automática
- Tests de vaciado de cola
- Tests de reordenación FIFO

*(Esta sección se completará progresivamente durante el desarrollo con TDD)*

---

## LECCIONES APRENDIDAS

### Fase de Discovery

**✅ Lo que funcionó bien**:
- Usar un problema real propio como punto de partida
- Validar mercado antes de comprometerse con la idea
- Iterar la especificación funcional hasta tener claridad total

**⚠️ Desafíos encontrados**:
- Tentación de sobre-diseñar (controlar el scope creep desde el inicio)
- Balance entre completitud del MVP y plazo ajustado

**💡 Aprendizajes clave**:
- La especificación funcional detallada es la inversión más rentable del proyecto
- Tener un caso de uso piloto real (Masia l'Encís) aporta validación constante
- La estrategia "opinado por fuera, configurable por dentro" resuelve la tensión entre simplicidad y escalabilidad

### Fase de Artefactos

**✅ Lo que funcionó bien**:
- Generar use cases primero (antes que ER o arquitectura) aporta claridad
- Iterar con múltiples asistentes (Copilot + Claude Projects) mejora la calidad del output
- Comparar versiones de arquitectura (v1, v2, v3.2) evita sobre-ingeniería

**⚠️ Desafíos encontrados**:
- Primera versión del ER diagram no respetaba las especificaciones → necesidad de iterar en Claude Projects
- Tentación de agregar Redis, colas distribuidas y microservicios → resistir y mantener simplicidad del MVP

**💡 Aprendizajes clave**:
- Los LLMs pueden generar arquitecturas sobre-ingenierizadas si no se les guía explícitamente hacia la simplicidad
- Validar cada artefacto contra la especificación funcional es crítico
- Documentar decisiones arquitectónicas con justificaciones ahorra tiempo después

### Fase de User Stories

**✅ Lo que funcionó bien**:
- Generación por área funcional (evita problemas de contexto)
- Script Python determinista para extraer dependencias (elimina ambigüedad)
- Clasificación por capa arquitectónica (Fundacional/Spine/Soporte) clarifica prioridades

**⚠️ Desafíos encontrados**:
- 48 user stories es un volumen alto para un MVP → validar que todas sean realmente necesarias

**💡 Aprendizajes clave**:
- Automatizar el análisis de dependencias con scripts es más confiable que hacerlo manualmente
- La trazabilidad explícita (user story → use case → requisito funcional) es valiosa para el TFM

---

## PRÓXIMOS PASOS

### Inmediatos

1. **Implementar modelo de datos** (Fase 6)
   - Traducir ER diagram a schema de Prisma
   - Configurar índices críticos
   - Primera migración

2. **Scaffolding del proyecto** (US-000, US-000A)
   - Setup del monorepo
   - Configuración de apps/web y apps/api
   - CI/CD con GitHub Actions

### Medio plazo

1. **Implementar capa fundacional** (US-001, US-002, US-039, US-040, US-041)
   - Autenticación JWT
   - Bloqueo atómico de fecha (con tests de concurrencia)
   - Máquina de estados base

3. **Primera funcionalidad end-to-end** (US-003, US-004)
   - Alta de consulta exploratoria y con fecha
   - Validar flujo completo frontend → backend → DB

### Largo plazo

1. **Implementar spine completo** (todas las US de gestión de reservas)
2. **Implementar sub-procesos paralelos** (pre-evento + liquidación)
3. **Implementar cola de espera** (promoción automática, vaciado)
4. **Generación de PDFs y emails** (presupuestos, facturas, condiciones)
5. **Dashboard de negocio** (KPIs, exports CSV)
6. **Testing exhaustivo** (especialmente concurrencia y race conditions)
7. **Documentación final del TFM**

---