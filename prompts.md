> Detalla en esta sección los prompts principales utilizados durante la creación del proyecto, que justifiquen el uso de asistentes de código en todas las fases del ciclo de vida del desarrollo. Esperamos un máximo de 3 por sección, principalmente los de creación inicial o  los de corrección o adición de funcionalidades que consideres más relevantes.
Puedes añadir adicionalmente la conversación completa como link o archivo adjunto si así lo consideras


## Índice

1. [Descripción general del producto](#1-descripción-general-del-producto)
2. [Arquitectura del sistema](#2-arquitectura-del-sistema)
3. [Modelo de datos](#3-modelo-de-datos)
4. [Especificación de la API](#4-especificación-de-la-api)
5. [Historias de usuario](#5-historias-de-usuario)
6. [Tickets de trabajo](#6-tickets-de-trabajo)
7. [Pull requests](#7-pull-requests)

---

## 1. Descripción general del producto

**Prompt 1:**

Asistente utilizado - AI Mega-Prompt Generator (Custom GPT en Chat GPT):

Necesito crear un prompt para construir de cero una plataforma Saas de gestión integral para espacios de eventos privados de pequeño formato - masias, fincas, jardines, salones familiares - que centralice toda la gestión completa de un negocio en un único backoffice.
Todavia no hay nada creado, así que debes adoptar el rol de product manager y definir esas funcionalidades claves que harán brillar la herramienta por encima de los competidores y conseguir solucionar con éxito los puntos de dolor indicados. A dia de hoy, al no disponer de ninguna herramienta, la gestión del negocio se realiza mediante correo electrónico (Gmail), hojas de cálculo en Google Drive y conversaciones sueltas por WhatsApp. Esto provoca los siguientes puntos de dolor:
- No sabemos siempre en qué punto está cada consulta/reserva 
- No tenemos claramente definidos los estados de una solicitud (consulta - pre_reserva - reserva_confirmada - reserva_completada, más reserva_cancelada) 
- Alguna vez hemos estado a punto de comprometer la misma fecha dos veces
- No disponemos de un historial de reservas
- La facturación vive dispersa entre nuestras bandejas de correo y hojas en Google Drive
- No contamos con un dashboard que centralice la información para hacer el seguimiento de cada consulta o reserva 
- No contamos con un dashboard que nos permita consultar el historial de ocupación y facturación (mensual, anual)
- Los correos y los presupuestos se redactan a mano con plantillas dispares 
- No tenemos fichas de reserva organizadas que permitan enviar recordatorios o notificaciones.

**Prompt 2:**

#CONTEXT:
Necesito diseñar desde cero una plataforma SaaS de gestión integral para espacios de eventos privados de pequeño formato como masías, fincas, jardines, villas y salones familiares.

Actualmente la operación del negocio se gestiona mediante:
- Gmail
- Google Sheets
- Google Drive
- WhatsApp

Esto provoca múltiples problemas operativos:
- No sabemos en qué punto está cada consulta o reserva
- No existen estados claros de reserva
- Riesgo de doble reserva de fechas
- No hay historial centralizado de clientes y eventos
- La facturación está dispersa
- No existe dashboard operativo
- No existe dashboard financiero
- Los presupuestos y correos se redactan manualmente
- No hay automatizaciones
- No existen fichas organizadas de reserva
- No hay recordatorios ni seguimiento estructurado

#GOAL:
Diseña la visión completa del producto SaaS y define:
- arquitectura funcional,
- módulos principales,
- automatizaciones,
- workflows,
- dashboards,
- diferenciadores competitivos,
- roadmap de desarrollo,
- y prioridades de implementación.

#RESPONSE GUIDELINES:
1. Analiza los puntos de dolor actuales y tradúcelos en problemas operativos concretos.
2. Define la propuesta de valor principal del SaaS.
3. Diseña todos los módulos funcionales necesarios.
4. Define el flujo completo de una reserva desde el lead hasta el cierre del evento.
5. Diseña un pipeline claro de estados de reserva (consulta, pre_reserva, reserva_confirmada, reserva_completada, reserva_cancelada).
6. Define automatizaciones clave de alto impacto.
7. Diseña dashboards operativos y financieros.
8. Propón funcionalidades diferenciales frente a CRMs genéricos.
9. Prioriza funcionalidades por:
   - MVP
   - V1
   - V2
   - funcionalidades premium futuras
10. Propón el stack tecnológico ideal.
11. Añade recomendaciones UX/UI específicas para este tipo de negocio.
12. Explica las ventajas competitivas reales del producto.

#ALCANCE MVP
Aunque el modelo de datos de la aplicación se defina desde el inicio como multi-tenant, el MVP se centrará en las siguientes funcionalidades básicas orientadas a la gestión intregral de Masia l'Encís (mi negocio familiar):
- Gestión de reservas desde el lead hasta el cierre del evento + calendario visual
- Generación de emails y pdfs automáticos (respuestas a consultas iniciales -con cálculo interno de tarifa-, generación de presupuestos a pre_reservas confirmadas, envío de facturas, notificaciones, comunicaciones, etc)
- Centralizar la información para hacer el seguimiento de cada consulta o reserva
- Consultar el historial de ocupación y facturación (mensual, anual)
- Dashboard de negocio con KPIs (ocupación, ingresos, ratio consulta-reserva) y exports CSVs

#OUTPUT:
Entrega la respuesta en formato Markdown profesional.

La respuesta debe incluir:
- índice,
- tablas,
- arquitectura modular,
- workflows,
- roadmap,
- KPIs,
- automatizaciones,
- recomendaciones accionables,
- y propuestas concretas de producto.

El resultado debe parecer una especificación funcional profesional preparada para iniciar diseño UX/UI y desarrollo técnico.

**Prompt 3:**

Iteraciones con el asistente para obtener una especificación funcional validada:

#Eres un Product Manager senior especializado en plataformas SaaS B2B para gestión integral de espacios de eventos privados de pequeño y mediano formato (masías, fincas, jardines, villas, salones boutique y espacios familiares).

Actualmente acompañas el desarrollo de Slotify, plataforma SaaS multi-tenant cuyo caso piloto es Masia l'Encís. El proyecto se desarrolla como Trabajo Final de Máster con deadlines.

La especificación funcional completa de Slotify está adjunta al proyecto como PRD-EspecificacionFuncional.md. Esa especificación es la fuente de verdad del producto. Antes de responder cualquier pregunta funcional, arquitectónica o de alcance, consúltala.

Comparto las siguientes nuevas indicacions para modificar #sym:# Especificación Funcional — Plataforma SaaS de Gestión Integral para Espacios de Eventos Privados  :

xxxxxx
Xxxxxx

Quiero un plan con los cambios especificados en el documento para que pueda validarlos antes de modificar la especificación

---

## Artefactos

### Diagrama Lean Canvas

Utilizo este prompt y lo ejecuto en el GPT Draw.io Creator

**Prompt 1:**

Adjunto Especificación Funcional de Slotify #file:SlotifyGeneralSpecs.md

Quiero que lo analices y generes código XML compatible con Draw.io para representar un Lean Canvas visual con las siguientes condiciones: 
Tu tarea: 
1. Lee el contenido del PRD y extrae tú mismo la información relevante para llenar los bloques del Lean Canvas, sin que yo lo tenga que estructurar. 
Estructura: 
- Cada bloque del Lean Canvas debe tener dos celdas apiladas verticalmente: 
1. Una celda superior con el título del bloque: - Color de fondo según el bloque. - Texto centrado, en negrita (fontStyle=1), fontSize=12. - Altura fija: 30 px. - Márgenes internos: spacingTop=4, spacingLeft=6. 
2. Una celda inferior con el contenido: - Fondo blanco (fillColor=#FFFFFF). - Texto en viñetas (-), con saltos de línea usando . - Fuente fontSize=10, alineado a la izquierda. - Altura fija: 120 px (salvo en bloques más altos). - Estilo: whiteSpace=wrap;html=1;spacingTop=4;spacingLeft=6. 
Distribución del Lean Canvas: 
- Fila 1: Problema, Segmentos de Clientes, Propuesta de Valor Única, Ventaja Competitiva (esta va al final, de forma vertical). 
- Fila 2: Solución, Canales, Fuentes de Ingresos. 
- Fila 3: Estructura de Costes, Métricas Clave. 
Colores de fondo para los títulos: 
- Problema: #F8CECC 
- Segmentos de Clientes: #D5E8D4 
- Propuesta de Valor Única: #FFF2CC 
- Solución: #F8CECC 
- Canales: #D5E8D4 
- Fuentes de Ingresos: #DAE8FC 
- Estructura de Costes: #DAE8FC 
- Métricas Clave: #FFF2CC - Ventaja Competitiva: #E1D5E7 📐 Dimensiones exactas: 
- Cada bloque horizontal: 250 px de ancho × 150 px de alto (30 para título + 120 para contenido). 
- "Estructura de Costes" y "Métricas Clave": 375 px de ancho × 150 px de alto. 
- "Ventaja Competitiva" debe tener 250 px de ancho × 450 px de alto para alinearse exactamente con las tres filas que ocupa a su izquierda. 
Instrucciones de formato: 
- Usa whiteSpace=wrap;html=1;spacingTop=4;spacingLeft=6 en todas las celdas de contenido. 
- No uses bordes redondeados. 
- El resultado debe estar contenido entre <mxGraphModel> y </mxGraphModel>. 
- No incluyas ninguna explicación ni resumen adicional, solo el código XML final. 
- Asegúrate que todo el código esté contenido en un solo bloque y en formato markdown para copiar y pegar fácilmente El PRD que debes analizar para completar el Lean Canvas se encuentra adjunto

### Casos de uso

**Prompt 2**:

#ROL
A partir de este momento, **actúa como un Analista de Requisitos** especializado en:
- Identificación de casos de uso críticos
- Definición de flujos de usuario
- Análisis de actores y sus necesidades
- Documentación de requisitos funcionales

Aplica además los **estándares de especificación de casos de uso** incluyendo:
- Notación UML
- Flujos básicos y alternativos
- Condiciones previas y posteriores
- Actores implicados

#GOAL
Realizar el analisis completo del contexto y de toda la funcionalidad requerida en el MVP y extraer todos los casos de uso necesarios para poder completarlo.

#CONTEXT
Adjunto #file:SlotifyGeneralSpecs.md con especificación funcional de todo el sistema
Adjunto también a continuación toda la funcionalidad que debe cubrir el MVP. Para ayudarte a entender cual es la funcionalidad que debes analizar al completo en el contexto para definir los casos de uso, tienes la siguiente información: **✅ Implementado en MVP TFM** (funcional y desplegado)
**📐 Solo diseñado en la especificación** (forma parte del PRD pero no se construye)

##Matriz de alcance del MVP TFM

| Funcionalidad | Estado MVP TFM |
|---|---|
| Auth básica + multi-tenant base (un solo tenant operativo) | ✅ Implementado |
| Pipeline completo de reservas: consulta (2.a, 2.b, 2.c, 2.d, **2.v**, 2.x, 2.y, 2.z) → pre_reserva → reserva_confirmada → pre_evento + liquidacion (paralelos) → evento_en_curso → post_evento → reserva_completada → reserva_cancelada | ✅ Implementado |
| Sub-procesos pre-evento + liquidación + fianza paralelos | ✅ Implementado |
| Cola de espera (sub-estados 2.d, 2.y, 2.z + promoción + reordenación + encadenamiento) | ✅ Implementado |
| **Sub-estado 2.v (visita programada)** con bloqueo hasta día post-visita (visita máx. 7d desde solicitud) + transiciones a 2.b/2.x/2.z | ✅ Implementado |
| Detección automática de leads recurrentes + tabla `consulta_vinculo` | 📐 Solo diseñado |
| Calendario visual con bloqueo atómico | ✅ Implementado |
| Ficha de reserva: datos cliente + datos evento | ✅ Implementado |
| Ficha operativa del evento (briefing, menús, timing) | ✅ Implementado (versión simple) |
| Histórico consultable con búsqueda y filtros básicos | ✅ Implementado |
| Importación CSV de reservas históricas | 📐 Solo diseñado (no se usa con Masia l'Encís) |
| Motor de tarifas (3 temporadas × 3 horas × 5 tramos invitados + 2 extras) | ✅ Implementado |
| Generación automática de presupuestos PDF | ✅ Implementado |
| Generación automática de facturas (señal, liquidación) | ✅ Implementado |
| **Factura de señal (40%) adjunta en email de confirmación** | ✅ Implementado |
| **Factura de liquidación (60% + extras) enviada al confirmar cobro** | ✅ Implementado |
| **Gestión de fianza:** cobro, recibo independiente, solicitud IBAN, devolución | ✅ Implementado |
| **Datos fiscales del cliente** (DNI, dirección, CP, población, provincia) para presupuestos y facturas | ✅ Implementado |
| **Presupuesto con desglose** (importe total + 40% señal + 60% liquidación + fianza) | ✅ Implementado |
| **Instrucciones de transferencia** en emails (beneficiario + concepto configurables por tenant) | ✅ Implementado |
| **Condiciones particulares:** generación, envío con factura 40%, registro de firma | ✅ Implementado |
| **Documentación día evento:** captura foto DNI (anverso/reverso) + cláusula responsabilidad firmada | ✅ Implementado |
| Factura complementaria post-evento (ajustes) | 📐 Solo diseñado |
| Emails automáticos del flujo principal (5 emails clave, ver lista abajo) | ✅ Implementado |
| Emails de cola (entrada en cola, promoción, descartado) | 📐 Solo diseñado |
| Recordatorios automáticos extendidos (T-15d, T-3d, T-1d, recordatorios de cobro, etc.) | 📐 Solo diseñado |
| Dashboard operativo (versión simple) | ✅ Implementado |
| Dashboard financiero + KPIs avanzados | 📐 Solo diseñado |
| Política de cancelación y liquidación tardía configurables | 📐 Solo diseñado (default "Negociable" hardcoded) |
| Audit log mínimo (tabla `audit_log` poblada automáticamente, sin UI) | ✅ Implementado |
| Parser de emails entrantes (LLM extrae info de consultas por email) | 📐 Solo diseñado |
| Integración Stripe para cobros | 📐 Solo diseñado |
| WhatsApp Business API | 📐 Solo diseñado |

#OUTPUT(artefactos separados)

- **Análisis de especificación**: Extracción de información clave
- **Matriz de evaluación**: Candidatos vs criterios de selección
- **Casos de Uso documentados**: Uno por cada caso seleccionado
- **Diagrama Mermaid por caso de uso**: Flujo visual (secuencia, flowchart o estado)
- **Tabla comparativa**: Resumen, actor, impacto, prioridad
- **Diagrama de interconexión**: Cómo se relacionan los casos

Crea o sobreescribe el archivo `docs/use-cases.md` en la raíz del proyecto con el siguiente contenido:

1. **Resumen breve** (2-3 párrafos) describiendo el sistema analizado, los actores identificados y los criterios de selección de los casos de uso.
2. Los **casos de uso documentados** con su flujo básico y diferenciador.
3. Los **diagramas Mermaid** de cada caso dentro de bloques de código individuales, con encabezado identificador.
4. La **tabla comparativa** de resumen (actor, impacto, prioridad).

#GUARDRAILS
-Muy importante: comprueba y valida que no queda ninguna funcionalidad no definida dentro del alcance del MVP en los casos de uso que entregues. 
- Verificar que la **sintaxis Mermaid sea correcta**
- Usar formatos claros y legibles
- Justificar la selección de los casos
- Conectar el análisis con el documento de entrada
- Enfoque en valor al usuario
- Los casos deben ser viables
- Los diagramas deben ser simples y comprensibles

### ER diagram

**Prompt 3**:
/er-diagram genera el diagrama de ER para todos los casos de uso identificados y extraidos en #file:use-cases.md con alcance para el MVP

### ARCH diagram

Ejecuto el prompt almacenado en .github (previamente modificado, indincandole sobretodo la importancia que toda la funcionalidad definida en el MVP esté representada en el diseño y que no sobredimensione el alcance de este)
**Prompt 4**:
/arch-diagram

### C4 diagram
**Prompt 5**:
Necesito crear los diagramas C4 para la plataforma Slotify que estamos diseñando. Haz uso del lenguaje PlantUML y de la siguiente referencia para darme el código necesario.

Una vez generados los diagramas, crea o sobreescribe el archivo `docs/c4-diagrams.md` en la raíz del proyecto con el siguiente contenido:

1. **Resumen breve** (2-3 párrafos) describiendo los niveles C4 representados y las decisiones de diseño clave.
2. El **código PlantUML completo** de cada diagrama dentro de bloques de código individuales, con un encabezado que indique el nivel (Context, Container, Component, etc.).

La referencia de estructura a seguir es la siguiente:

```plantuml
@startuml "slotify"

!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
' uncomment the following line and comment the first to use locally
' !include C4_Container.puml

LAYOUT_TOP_DOWN()
'LAYOUT_AS_SKETCH()
LAYOUT_WITH_LEGEND()


Person_Ext(anonymous_user, "Anonymous User")
Person(aggregated_user, "Aggregated User")
Person(administration_user, "Administration User")

System_Boundary(c1, "slotify"){

    Container(web_app, "Web Application", "Java, Spring MVC, Tomcat 7.x", "Allows users to view people, tribes, content, events, jobs, etc. from the local tech, digital and IT sector")

    ContainerDb(rel_db, "Relational Database", "MySQL 5.5.x", "Stores people, tribes, tribe membership, talks, events, jobs, badges, GitHub repos, etc.")

    Container(filesystem, "File System", "FAT32", "Stores search indexes")

    ContainerDb(nosql, "NoSQL Data Store", "MongoDB 2.2.x", "Stores from RSS/Atom feeds (blog posts) and tweets")

    Container(updater, "Updater", "Java 7 Console App", "Updates profiles, tweets, GitHub repos and content on a scheduled basis")
}

System_Ext(twitter, "Twitter")
System_Ext(github, "GitHub")
System_Ext(blogs, "Blogs")


Rel(anonymous_user, web_app, "Uses", "HTTPS")
Rel(aggregated_user, web_app, "Uses", "HTTPS")
Rel(administration_user, web_app, "Uses", "HTTPS")

Rel(web_app, rel_db, "Reads from and writes to", "SQL/JDBC, port 3306")
Rel(web_app, filesystem, "Reads from")
Rel(web_app, nosql, "Reads from", "MongoDB wire protocol, port 27017")

Rel_U(updater, rel_db, "Reads from and writes data to", "SQL/JDBC, port 3306")
Rel_U(updater, filesystem, "Writes to")
Rel_U(updater, nosql, "Reads from and writes to", "MongoDB wire protocol, port 27017")

Rel(updater, twitter, "Gets profile information and tweets from", "HTTPS")
Rel(updater, github, "Gets information about public code repositories from", "HTTPS")
Rel(updater, blogs, "Gets content using RSS and Atom feeds from", "HTTP")

Lay_R(rel_db, filesystem)

@enduml
```
--- no se si aplica

### CREACIÓN DE UNA SKILL PARA ACTUALIZAR TODOS ESTOS ARTEFACTOS Y DOCUMENTACIÓN DE UNA FORMA DINÁMICA
**Prompt 6**:
#CONTEXT:
Adopta el rol de un arquitecto de software senior, especialista en documentación viva (living documentation), ingeniería de software, automatización documental y mantenimiento de skills. Tu misión es crear y/o actualizar una skill especializada en documentación técnica de aplicaciones software que se ejecute automáticamente cuando existan cambios en el código fuente o en la documentación funcional/técnica y que determine de forma inteligente qué artefactos documentales deben regenerarse, actualizarse o validarse.

La skill debe actuar como un sistema de sincronización documental inteligente para una aplicación software y trabajar siempre en español.

Debes asumir que la documentación es viva y que cualquier cambio puede impactar diferentes niveles de arquitectura, análisis funcional y diseño técnico.

La skill debe detectar impactos sobre:

- Diagramas de arquitectura técnica
- Diagramas C4 (Context, Container, Component y Code)
- Diagramas entidad-relación (ER)
- Diagramas Lean Canvas
- Diagramas de secuencia
- Diagramas Mermaid existentes
- Diagramas de flujo
- Casos de uso (use-cases)
- Documento de especificaciones generales (por ejemplo SlotifyGeneralSpecs)
- Documentación técnica auxiliar
- Relaciones entre componentes, APIs, integraciones y bounded contexts
- Dependencias tecnológicas
- Convenciones arquitectónicas y decisiones técnicas (ADR si aplica)

La skill debe estar diseñada para ejecutarse cuando exista un cambio en:

- Código fuente
- Pull Requests
- Commits
- Archivos de documentación
- Cambios estructurales en modelos de datos
- Cambios de APIs
- Cambios de dependencias
- Cambios funcionales o de negocio

Debes diseñar la skill siguiendo una filosofía “impact-aware documentation”, es decir: NO regenerar todo indiscriminadamente, sino identificar el alcance real del cambio y actualizar únicamente los artefactos afectados.

Debes utilizar obligatoriamente estas librerías y frameworks:

- diagrams (Python):
https://github.com/mingrammer/diagrams

- C4-PlantUML:
https://github.com/plantuml-stdlib/C4-PlantUML

- Mermaid (como estándar documental adicional):
https://mermaid.js.org/

- Herramientas/librerías de soporte Mermaid (seleccionar y justificar según el caso):
  - Mermaid CLI (mmdc):
    https://github.com/mermaid-js/mermaid-cli
  - pyStateGram (si aporta valor para generación desde Python):
    https://github.com/MaslasBros/pyStateGram
  - parser o renderizador Mermaid para validación sintáctica y exportación automatizada cuando sea necesario

La skill debe decidir inteligentemente qué tecnología usar para cada tipo de diagrama:

Ejemplo esperado (adaptarlo y justificarlo):
- C4 Architecture → C4-PlantUML
- Arquitectura cloud/integraciones → diagrams (Python)
- Diagramas embebidos en Markdown → Mermaid
- Sequence diagrams → Mermaid o PlantUML según complejidad
- Flujos de negocio → Mermaid
- ER diagrams → Mermaid ER + representación avanzada cuando aplique
- Lean Canvas → Mermaid o plantilla Markdown estructurada

La skill debe producir diagramas:
- mantenibles
- versionables
- regenerables
- trazables
- legibles en repositorios Git
- compatibles con Markdown
- exportables a PNG/SVG/PDF cuando sea necesario

La skill debe incluir instrucciones precisas para:
- estructura de carpetas
- scripts Python necesarios
- flujo de ejecución
- detección de cambios
- reglas de decisión
- convenciones documentales
- automatización
- prompts internos de la skill
- dependencias necesarias
- formato de archivos
- gobernanza documental

La skill debe diseñarse para integrarse fácilmente en repositorios Git y pipelines CI/CD.

#GOAL:
Crear una especificación completa, implementable y lista para construir una skill de documentación viva de software que detecte cambios, determine impacto documental y regenere automáticamente únicamente los artefactos afectados, incorporando soporte nativo para Mermaid junto con diagrams y C4-PlantUML.

#RESPONSE GUIDELINES:
Sigue este proceso paso a paso:

1. Analiza el objetivo funcional de la skill y define claramente:
   - propósito
   - responsabilidades
   - límites
   - inputs
   - outputs
   - criterios de ejecución
   - casos de activación
   - casos de exclusión

2. Diseña una arquitectura completa de la skill incluyendo:
   - estructura de carpetas
   - convenciones de nombres
   - módulos internos
   - flujos de trabajo
   - componentes desacoplados
   - estrategia de extensibilidad
   - versionado documental

3. Diseña una “estrategia de selección de motor de diagramación”.

Debes construir una matriz explícita que determine:
   - cuándo usar Mermaid
   - cuándo usar C4-PlantUML
   - cuándo usar diagrams (Python)
   - cuándo combinar tecnologías
   - trade-offs
   - coste de mantenimiento
   - legibilidad en Git

4. Define una estrategia de detección de cambios:
   - análisis de git diff
   - análisis de commits
   - cambios documentales
   - cambios estructurales
   - cambios funcionales
   - cambios de dependencias
   - heurísticas para inferir impacto
   - matriz de impacto entre cambios y documentos

5. Diseña una “Matriz de Impacto Documental” con reglas explícitas.

6. Define una estrategia de actualización inteligente:
   - cuándo regenerar completamente
   - cuándo editar parcialmente
   - cuándo solo marcar para revisión humana
   - cómo minimizar ruido documental
   - cómo preservar contexto manual
   - cómo no romper diagramas Mermaid existentes

7. Diseña la generación de diagramas utilizando obligatoriamente:
   - diagrams (Python)
   - C4-PlantUML
   - Mermaid

Incluye:
   - convenciones
   - plantillas
   - naming conventions
   - estructura de archivos
   - versionado
   - validación
   - exportación
   - linting de diagramas

8. Genera scripts Python necesarios para automatizar:
   - detección de cambios
   - análisis de impacto
   - generación de diagramas
   - validación Mermaid
   - regeneración selectiva
   - sincronización documental

Incluye:
   - responsabilidades de cada script
   - pseudoimplementación
   - dependencias Python
   - comandos de ejecución

9. Diseña el flujo operativo completo end-to-end:
   - trigger
   - análisis
   - clasificación
   - impacto
   - decisión del motor de diagramado
   - actualización
   - validación
   - exportación
   - commit documental opcional

10. Diseña prompts internos de la skill para:
   - actualizar SlotifyGeneralSpecs
   - actualizar use-cases
   - actualizar diagramas Mermaid incrementalmente
   - explicar cambios detectados
   - justificar decisiones documentales
   - detectar inconsistencias

12. Cuando existan ambigüedades:
   - declara supuestos
   - propone alternativas
   - justifica decisiones

13. Incluye ejemplos concretos de:
   - Mermaid
   - C4-PlantUML
   - diagrams
   - scripts Python
   - CI/CD
   - reglas de impacto
   - actualización incremental

14. Usa pensamiento de arquitecto software:
   - modularidad
   - bajo acoplamiento
   - mantenibilidad
   - trazabilidad
   - automatización
   - documentación viva
   - extensibilidad

--- nose si aplica 

---

## 2. Arquitectura del Sistema

### **2.1. Diagrama de arquitectura:**

**Prompt 1:**
Actúa como arquitecto de software documentando el proyecto Slotify, una plataforma SaaS multi-tenant de gestión de espacios de eventos privados.

NO generes nada todavía. Tu única tarea en este mensaje es leer y resumir el contexto.

1. Lee estos archivos del workspace:
   - arquitectura.md (fuente de verdad para arquitectura)
   - er-diagram.md (modelo de datos)
   - use-cases.md (casos de uso)
   - c4-diagram.md

2. Devuélveme un resumen estructurado de:
   a) Los componentes de la ARQUITECTURA DE IMPLEMENTACIÓN DEL MVP (no la objetivo de producción AWS): frontend, backend, base de datos, jobs, auth, storage, email, observabilidad, y cómo se despliega (monorepo, dos destinos).
   b) Las tecnologías concretas de cada componente.
   c) Las decisiones de arquitectura explícitas y su justificación, especialmente: monolito modular vs microservicios; SPA Vite+React vs Next.js; NestJS con hexagonal/DDD/OpenAPI; PostgreSQL única sin Redis; bloqueo atómico por UNIQUE(tenant_id,fecha); cron simple vs serverless; JWT access+refresh.

REGLAS ESTRICTAS:
- Usa ÚNICAMENTE información presente en esos archivos. No añadas componentes, tecnologías ni patrones que no aparezcan en ellos.
- Si algo no está en los documentos, escribe "NO ESPECIFICADO" en vez de inventarlo.
- Distingue siempre MVP (lo que se construye) de objetivo de producción (visión AWS).

Cuando termines el resumen, espera mi siguiente instrucción. No generes diagramas aún.

**Prompt 2:**

Ahora genera el DIAGRAMA DE ARQUITECTURA de la implementación del MVP de Slotify, basándote EXCLUSIVAMENTE en el resumen que acabas de hacer.

FORMATO: usa Mermaid (sintaxis `graph TB`), porque es texto versionable en Git, se renderiza en GitHub/GitLab y en la memoria del TFM, y es coherente con el resto de la documentación del proyecto. Entrégalo dentro de un bloque ```mermaid.

CONTENIDO OBLIGATORIO del diagrama:
- El actor (gestor) accediendo desde el navegador.
- La SPA (Vite+React) servida como estáticos desde un CDN.
- El backend NestJS como proceso vivo, mostrando sus capas internas
  (interface, application, domain, infrastructure).
- La base de datos PostgreSQL única (anota RLS multi-tenant y UNIQUE(tenant_id,fecha)).
- El cron de barrido de TTLs/cola.
- Servicios externos: storage, email, observabilidad.
- Las conexiones etiquetadas con su propósito, marcando la llamada del navegador a la API como cross-origin (CORS).

REGLAS:
- Refleja que es UN monorepo con DOS destinos de despliegue (SPA a CDN, backend a su plataforma). No lo dibujes como un único servidor monolítico ni como microservicios.
- No incluyas componentes de la arquitectura objetivo AWS (ni ALB, ni Redis, ni Lambda, ni Cognito, etc.).
- Verifica que cada subgraph tenga su `end` y que la sintaxis Mermaid sea válida.

Después del diagrama, dame una lista de las suposiciones que hayas tenido que hacer, si alguna.

**Prompt 3:**

Ahora redacta la SECCIÓN ESCRITA que acompaña al diagrama, para la memoria del TFM. Estructúrala en exactamente estas cuatro partes:

1. PATRÓN ARQUITECTÓNICO: indica qué patrón sigue (monolito modular con arquitectura hexagonal y DDD en el backend) y describe brevemente cada concepto aplicado al proyecto. Si hay patrones secundarios (puertos y adaptadores, agregado raíz,
   máquina de estados como configuración), menciónalos.

2. JUSTIFICACIÓN DE LA ELECCIÓN: explica por qué se eligió esta arquitectura para ESTE contexto (TFM con plazo ajustado, un solo tenant piloto, desarrollo asistido por IA, riesgo crítico de doble reserva). Contrasta explícitamente con las
   alternativas descartadas (microservicios, Next.js full-stack, Redis para el lock, arquitectura AWS completa) y por qué se descartaron en esta fase.

3. BENEFICIOS PRINCIPALES: lista los beneficios concretos que aporta al proyecto (atomicidad transaccional nativa, simplicidad operativa, type-safety end-to-end, testabilidad para TDD, coherencia con el temario del máster, coste bajo de hosting).

4. SACRIFICIOS Y DÉFICITS: sé honesto sobre lo que esta arquitectura sacrifica (no escala horizontalmente como microservicios, acoplamiento de despliegue del backend, CORS por la separación de dominios, ausencia de alta disponibilidad, el coste de mantener dos frameworks). Para cada sacrificio, indica si es asumible en la fase MVP y cómo se resolvería en la arquitectura objetivo de producción.

REGLAS:
- Tono técnico, objetivo y realista. No vendas la arquitectura como perfecta: la sección de sacrificios debe ser tan rigurosa como la de beneficios.
- Apóyate solo en las decisiones documentadas en arquitectura.md. No inventes beneficios genéricos de SaaS que no apliquen.
- Prosa en castellano, sin bullets excesivos; máximo una lista por sección.
- Conecta cada beneficio/sacrificio con una decisión concreta del diagrama.

OUTPUT
Devuelve en bloque de código en formato markdown el diagrama de arquitectura generado en el anterior punto y a continuación la sección escrita solicitada

### **2.2. Descripción de componentes principales:**

**Prompt 1:**

##ROL
Actúa como arquitecto de software documentando el proyecto Slotify

##CONTEXT
Utiliza los siguientes ficheros para contextualizar el proyecto: er-diagram, architecture, use-cases. Usa solo la información de estos archivos;

##GOAL
Redactar la sección "2.2 Descripción de componentes principales" para la memoria del TFM de Slotify, basándote EXCLUSIVAMENTE en la arquitectura de implementación del MVP documentada en arquitectura.md (NO la arquitectura objetivo de producción AWS).

##INSTRUCCIONES
Esta sección 2.2 es un CATÁLOGO DESCRIPTIVO componente a componente. NO repitas la justificación de por qué se eligió el monolito o la SPA; aquí DESCRIBE cada pieza: qué es, qué responsabilidad tiene, qué tecnología usa, y cómo se relaciona con las demás. La argumentación de las decisiones pertenece a 2.1, no aquí.

##OUTPUT
Una entrada por cada componente, con estos campos para cada uno:
  - Nombre del componente
  - Responsabilidad (qué hace y de qué se ocupa en el sistema)
  - Tecnología concreta (framework/librería/servicio y por qué encaja técnicamente, no por qué se eligió frente a alternativas)
  - Relaciones (con qué otros componentes habla y cómo: HTTP/REST, transacciones, etc.)
  - Alcance MVP: qué parte está implementada y qué queda como diseñado/post-TFM

COMPONENTES A DESCRIBIR (todos los del MVP; no incluyas componentes AWS):
  1. Frontend SPA (Vite + React + React Router + TypeScript; Tailwind + shadcn/ui; cliente generado desde OpenAPI)
  2. Backend NestJS y sus capas internas (interface, application, domain, infrastructure) — describe la responsabilidad de cada capa
  3. ORM Prisma
  4. Base de datos PostgreSQL (RLS multi-tenant, UNIQUE(tenant_id,fecha), FTS)
  5. Módulo de autenticación (JWT access+refresh, NestJS+Passport)
  6. Cron de barrido (TTLs, promoción de cola, recordatorios)
  7. Generación de PDF (presupuestos y facturas)
  8. Proveedor de email (plantillas E1-E8)
  9. Storage de documentos y justificantes
  10. Observabilidad (errores)

REGLAS ESTRICTAS:
- Usa SOLO lo documentado en arquitectura.md y, si hace falta para responsabilidades de datos, er-diagram.md. No inventes componentes, librerías ni responsabilidades.
- Si un detalle no está especificado, escribe "NO ESPECIFICADO" en vez de rellenarlo.
- Distingue MVP (implementado) de diseñado/post-TFM en el campo "Alcance MVP".
- Tono técnico y objetivo. Prosa en castellano. Puedes usar una ficha por componente (subtítulo + los campos), pero evita justificar decisiones (eso es 2.1).
- No menciones ALB, Redis, Lambda, Cognito ni ningún componente de la arquitectura AWS.
- La sección 2.1 ya cubre la VISTA DE CONJUNTO, el PATRÓN y la JUSTIFICACIÓN global. No dupliques esa información. Al final, lista cualquier suposición que hayas tenido que hacer.




### **2.3. Descripción de alto nivel del proyecto y estructura de ficheros**

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

### **2.4. Infraestructura y despliegue**

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

### **2.5. Seguridad**

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

### **2.6. Tests**

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

---

### 3. Modelo de Datos

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

---

### 4. Especificación de la API

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

---

### 5. Historias de Usuario

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

---

### 6. Tickets de Trabajo

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

---

### 7. Pull Requests

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**