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

## 2. Arquitectura del Sistema

### **2.1. Diagrama de arquitectura:**

**Prompt 1:**

## Rol y contexto

A partir de este momento, **actúa como un Arquitecto de Software** con experiencia en:

- Distribución de componentes
- Integración de sistemas externos
- Patrones de comunicación

Aplica además los **fundamentos de patrones de arquitectura más usados**, incluyendo:

- Caché
- CDN
- Reverse proxy
- Load balancer
- Otros patrones relevantes

## Requisitos técnicos

Usa **servicios de la nube de AWS exclusivamente**.
La arquitectura debe cumplir con los **requisitos no funcionales** de:

- Escalabilidad
- Seguridad
- Mantenibilidad
- Alta disponibilidad

## Instrucciones de diseño

1. Crea una **arquitectura de alto nivel** para el sistema **Slotify**.
2. Usa **buenas prácticas**, **frameworks** y **herramientas** (open source o comerciales) cuando sea relevante.
3. Considera **toda la información obtenida hasta el momento**, incluido el **modelo de datos** y los **casos de uso** definidos.
4. Toda la funcionalidad definida en el **alcance del MVP** debe estar representada en el diseño.

## Entregables (artefactos separados)

- **Explicación general del diseño de la arquitectura.**
- **Diagrama del sistema en formato Mermaid.**
- **Prompt para generar el diagrama con el servicio de DiagramsGPT.**

Asegúrate de:

- Verificar que la **sintaxis Mermaid sea correcta**.
- **Corregir cualquier error** que pueda aparecer.
- Validar que toda la funcionalidad del MVP esté representada en el diseño.

## Guardado de resultados

Una vez generados los entregables, crea o sobreescribe el archivo `docs/architecture.md` en la raíz del proyecto con el siguiente contenido:

1. **Resumen breve** (2-3 párrafos) describiendo las decisiones de diseño principales.
2. El **diagrama Mermaid** completo dentro de un bloque de código.
3. El **prompt para DiagramsGPT** dentro de un bloque de texto. Este prompt tiene que ser claro y detallado para que DiagramsGPT pueda generar el diagrama correctamente y no sobredimensione el diseño de la aplicación, enfocándose solo en los componentes y servicios necesarios para el MVP.

## Restricciones

- No generes ningún otro tipo de artefacto que no esté especificado en los entregables.
- No sobredimensiones el diseño de la arquitectura, enfocándote solo en los componentes y servicios necesarios para el MVP.

**Prompt 2:**

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

**Prompt 3:**

## ROL 

Eres un Product Manager senior especializado en plataformas SaaS B2B

## CONTEXTO 

Adjunto especificación funcional del producto #file:SlotifyGeneralSpecs.md y diagramas de arquitectura #file:architecture.md  y #file:c4-diagrams.md  del producto 

## OBJETIVO 

Quiero realizar una descripción general de la arquitectura del producto para la entrega de documentación técnica del trabajo realizado

## RESTRICCCIONES 

La respuesta tiene que contemplar únicamente el alcance definido para el MVP

## OUTPUT 

## 2. Arquitectura del Sistema
### **2.1. Diagrama de arquitectura:**
> Usa el formato que consideres más adecuado para representar los componentes principales de la aplicación y las tecnologías utilizadas. Explica si sigue algún patrón predefinido, justifica por qué se ha elegido esta arquitectura, y destaca los beneficios principales que aportan al proyecto y justifican su uso, así como sacrificios o déficits que implica.
### **2.2. Descripción de componentes principales:**
> Describe los componentes más importantes, incluyendo la tecnología utilizada
### **2.3. Descripción de alto nivel del proyecto y estructura de ficheros**
> Representa la estructura del proyecto y explica brevemente el propósito de las carpetas principales, así como si obedece a algún patrón o arquitectura específica.

### **2.2. Descripción de componentes principales:**

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
## ROL 
Eres un Arquitecto software senior especializado en plataformas SaaS B2B
## CONTEXTO 
Adjunto especificación funcional del producto #file:SlotifyGeneralSpecs.md y diagramas de arquitectura #file:architecture.md  y #file:c4-diagrams.md del producto 
# OBJETIVO 
Quiero realizar una descripción general de la arquitectura del producto para la entrega de documentación técnica del trabajo realizado
# RESTRICCCIONES 
La respuesta tiene que contemplar únicamente el alcance definido para el MVP
# OUTPUT 
## 2. Arquitectura del Sistema
### **2.3. Descripción de alto nivel del proyecto y estructura de ficheros**
> Representa la estructura del proyecto y explica brevemente el propósito de las carpetas principales, así como si obedece a algún patrón o arquitectura específica.

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

## Instrucciones Iniciales

Necesito que generes un diagrama de entidad-relación (DER) profesional. Por favor, responde a las siguientes preguntas para personalizar el resultado. Las opciones no mencionadas aquí seguirán estándares técnicos recomendados.

---

## OPCIONES CONFIGURABLES DEL USUARIO

### 1. **Idioma del Diagrama**

Elige uno:
- [ ] **Español** - Entidades y atributos en español
- [ ] **Inglés** - Entidades y atributos en inglés (RECOMENDADO para proyectos formales)

### 2. **Contexto del Proyecto**

Describe brevemente el dominio del negocio:
- ¿Qué tipo de sistema estás diseñando? (Ej: Sistema de ventas, Gestión hospitalaria, Red social)
- ¿Cuáles son las entidades principales?
- ¿Qué relaciones existen entre ellas?

### 3. **Nivel de Detalle**

Elige uno:
- [ ] **Básico** - Solo entidades principales y relaciones clave
- [ ] **Estándar** - Entidades, atributos esenciales y relaciones (RECOMENDADO)
- [ ] **Completo** - Incluir atributos derivados, multivaluados y todas las restricciones

### 4. **Notación Preferida**

Elige uno:
- [ ] **Chen** - Notación académica (rectángulos, óvalos, diamantes)
- [ ] **Crow's Foot** - Notación práctica para implementación (RECOMENDADO)

### 5. **Formato de Salida**

Elige uno:
- [ ] **PlantUML** - Sintaxis textual, fácil de versionizar
- [ ] **Mermaid** - Renderizable directamente, visual
- [ ] **Draw.io XML** - Formato editable en draw.io
- [ ] **Descripción + Diagrama Mermaid** (RECOMENDADO)

### 6. **Restricciones Especiales**

¿Hay restricciones de negocio particulares que deba considerar?
- (Ej: auditoría, soft delete, multi-tenancy, etc.)

---

## CONFIGURACIÓN ESTÁNDAR (AUTOMÁTICA)

Estos aspectos se aplicarán directamente sin requerir selección:

### Nomenclatura
- **Entidades**: PascalCase en singular (Usuario, Producto, Pedido)
- **Atributos**: snake_case en minúsculas (nombre_usuario, fecha_creacion, es_activo)
- **Claves primarias**: id_{entidad} o {entidad}_id (ej: id_usuario)
- **Claves foráneas**: fk_{referencia} o {entidad}_id cuando es referencia (ej: usuario_id)

### Normalización
- Mínimo tercera forma normal (3NF)
- Sin atributos compuestos o multivaluados directamente en entidades
- Eliminación de redundancias
- Validación de dependencias funcionales

### Atributos Comunes Automáticos
Se añadirán automáticamente a todas las entidades (a menos que indiques lo contrario):
- `id_{entidad}` : INT <<PK>> - Identificador único
- `fecha_creacion` : TIMESTAMP - Auditoría
- `fecha_actualizacion` : TIMESTAMP - Auditoría
- `activo` : BOOLEAN DEFAULT TRUE - Soft delete

### Cardinalidad y Participación
- Todas las relaciones tendrán cardinalidad explícita (1:1, 1:N, N:M)
- Participación marcada claramente (obligatoria = línea sólida, opcional = línea punteada)
- Relaciones N:M se descompondrán en tablas de unión explícitas

### Validaciones de Calidad
Se verificará automáticamente:
- ✓ No hay entidades huérfanas
- ✓ Todas las claves foráneas apuntan a claves primarias válidas
- ✓ Ciclos de relaciones detectados y documentados
- ✓ Datos tipos coherentes en relaciones

### Documentación Incluida
- Diccionario de datos con descripción de cada entidad
- Explicación de cada relación y su cardinalidad
- Restricciones de negocio identificadas
- Decisiones de diseño justificadas

---

## FORMATO DE RESPUESTA ESPERADA

Una vez proporciones la información anterior, recibirás:

1. **Resumen de Configuración** - Confirmación de opciones seleccionadas
2. **Diagrama Visual** - En el formato elegido
3. **Diccionario de Datos** - Definición de todas las entidades y atributos
4. **Validaciones** - Checklist de estándares aplicados
5. **Notas de Diseño** - Decisiones y justificaciones

## RESTRICCIONES

- Solo genera el diagrama en la información solicitada.

## GUARDADO DE RESULTADOS

Una vez completados los entregables, crea o sobreescribe el archivo `docs/er-diagram.md` en la raíz del proyecto con el siguiente contenido:

1. **Resumen breve** describiendo el dominio, las entidades principales y las decisiones de diseño más relevantes.
2. El **diagrama** completo en el formato seleccionado, dentro de un bloque de código.
3. El **diccionario de datos** resumido con las entidades y sus atributos clave.

**Prompt 2:**

## ROL 
Eres un Product Manager senior especializado en plataformas SaaS B2B
## CONTEXTO 
Adjunto especificación funcional del producto #file:SlotifyGeneralSpecs.md y diagramas de entidad-relación #file:er-diagram.md  del producto 
## OBJETIVO 
Quiero realizar una descripción general del modelo de datos del producto para la entrega de documentación técnica del trabajo realizado
## RESTRICCCIONES 
- La respuesta tiene que contemplar únicamente el alcance definido para el MVP
- Devolver la salida en bloque de código markdown
## OUTPUT 
Devolver en bloquedo de código markdown
## 3. Modelo de Datos
### **3.1. Diagrama del modelo de datos:**
> Recomendamos usar mermaid para el modelo de datos, y utilizar todos los parámetros que permite la sintaxis para dar el máximo detalle, por ejemplo las claves primarias y foráneas.
### **3.2. Descripción de entidades principales:**
> Recuerda incluir el máximo detalle de cada entidad, como el nombre y tipo de cada atributo, descripción breve si procede, claves primarias y foráneas, relaciones y tipo de relación, restricciones (unique, not null…), etc.

**Prompt 3:**

---

### 4. Especificación de la API

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

---

### 5. Historias de Usuario

**Prompt 1:**

Para empezar generando casos de uso:

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

**Prompt 2:**

Generador de Historias de Usuario para el MVP de Slotify
> Diseñado para ejecutarse **por área funcional** (12 áreas), no en una sola pasada.
---
**Prompt 1:**
## ROL

Eres un **Product Manager senior + Business Analyst** especializado en SaaS B2B para gestión de espacios boutique de eventos privados (masías, fincas, villas), trabajando con **Spec-Driven Development (SDD) + TDD asistido por IA**.

Tu tarea: generar **Historias de Usuario** del **MVP de Slotify**, trazables, verificables y listas para especificación machine-readable y tests.

**Estándar de calidad rector: INVEST.** Toda historia se rige por INVEST (ver sección dedicada). Es el criterio dominante de aceptación: una historia que no supera la puerta INVEST **no se emite** — se parte, se reescribe o se descarta. INVEST tiene la misma jerarquía que la regla de alcance (`✅`) y el modelo mental; ninguna historia puede sacrificar uno por otro.

---

## FUENTES DE VERDAD Y JERARQUÍA DE AUTORIDAD

Usa **exclusivamente** los documentos adjuntos al Project. No inventes nada fuera de ellos. Orden de autoridad ante conflicto:

1. **`SlotifyGeneralSpecs.md`** → fuente maestra. Define alcance MVP (§9.2), dolores D1–D13 (§1), KPIs (§7.4), emails E1–E8 (§9.3), automatizaciones A1–A30, módulos M1–M10 y decisiones cerradas (§13).
2. **`use-cases.md`** → catálogo canónico de los **36 casos de uso (UC-01 a UC-36)**, con actores, pre/post-condiciones, flujos básicos, flujos alternativos (FA-xx) y **prioridad ya asignada (§5)**.
3. **`er-diagram.md`** → **modelo de datos cerrado**. Única fuente de entidades y relaciones permitidas.
4. **`architecture.md` / `c4-diagrams.md`** → restricciones técnicas y de despliegue (úsalas solo para condicionar viabilidad y dependencias, no para inventar funcionalidad).

**Reglas de conflicto:**
- Si dos documentos se contradicen, **detente y señálalo explícitamente** antes de generar. No resuelvas el conflicto por tu cuenta.
- Si una historia requiere algo **no cubierto** por estos documentos, **dilo** y no la generes.
- Nunca presentes un comportamiento no documentado como si estuviera en la spec.

---

## REGLA DE ALCANCE (DURA — PRIORIDAD MÁXIMA)

Genera historias **únicamente** para funcionalidades marcadas **`✅ Implementado en MVP TFM`** en `SlotifyGeneralSpecs.md §9.2`.

**PROHIBIDO** generar historias para funcionalidades `📐 Solo diseñado`. Lista negra explícita (NO generar):
- Detección automática de leads recurrentes / tabla `consulta_vinculo`
- Importación CSV de reservas históricas
- Factura complementaria post-evento
- Emails de cola (entrada, promoción, descarte) — la **mecánica** de cola sí está en MVP; los **emails** de cola no
- Recordatorios automáticos extendidos (T-15d, T-3d, T-1d, recordatorios de cobro)
- Dashboard financiero + KPIs avanzados
- Política de cancelación / liquidación tardía configurable (en MVP está *hardcoded* "Negociable")
- Parser de emails entrantes (LLM)
- Integración Stripe
- WhatsApp Business API
- Multi-espacio / multi-tenant operativo simultáneo (MVP = 1 tenant: Masia l'Encís)

Si un UC roza una zona `📐`, genera **solo la parte `✅`** y añade en `Notas de alcance` qué quedó fuera y por qué.

---

## MODELO MENTAL OBLIGATORIO (GUARDARRAÍLES)

Toda historia debe respetar, sin excepción:

1. **La reserva es la entidad central.** El cliente es un atributo de la reserva. **Nunca** generes historias cliente-céntricas tipo CRM.
2. **La consulta es una FASE de la reserva, no una entidad separada.** Las transiciones (2.a→2.b→…→pre_reserva→confirmada→completada) son cambios de `estado`/`sub_estado` de **una misma** entidad `RESERVA`. Nunca modeles "crear una consulta" y "crear una reserva" como entidades distintas.
3. **Consultas en estados terminales (2.x, 2.y, 2.z) son inmutables.** Nunca generes una historia de "reabrir consulta". (La reapertura por vínculo es `📐`, fuera de MVP.)
4. **Cola FIFO modelada como campos en la reserva** (`posicion_cola`, `consulta_bloqueante_id`), no como tabla auxiliar. La cola se activa solo cuando la bloqueante está en **2.b**. Promoción, vaciado y reordenación son automáticos.
5. **Bloqueo de fecha condicional según madurez**: 3 días en 2.b, +3 si falta nº invitados (2.c), bloqueo hasta día post-visita en 2.v, 7 días en pre_reserva, firme en reserva_confirmada.
6. **Liquidación pre-evento**: 40% señal + 60% liquidación con deadline T-1d. No post-evento.
7. **Bloqueo atómico** vía `FECHA_BLOQUEADA` con `UNIQUE(tenant_id, fecha)` en BD. No lógica aplicativa.
8. **"Opinado por fuera, configurable por dentro"**: un único flujo visible, pero TTLs/%/plantillas vienen de `TENANT_SETTINGS`.

---

## INVEST — ESTÁNDAR DE CALIDAD RECTOR (PUERTA OBLIGATORIA)

INVEST es el criterio dominante. **Antes de emitir cualquier historia**, aplícale esta puerta. Cada letra está operacionalizada para Slotify: no basta con afirmar que se cumple, hay que demostrarlo con la evidencia indicada o declarar la excepción justificada.

| Letra | Qué exige en Slotify | Cómo se demuestra / cuándo se incumple |
|-------|----------------------|----------------------------------------|
| **I — Independiente** | La historia aporta valor sin depender del *orden de implementación* de otras. **Excepción reconocida:** la máquina de estados es jerárquica y acoplada por diseño (2.a→2.b→2.c…, promoción de cola depende de expiración, que depende del bloqueo atómico). En estos casos, la dependencia **no se oculta: se declara** en `Dependencias` y se justifica por la spec. No inventes independencia falsa. | ✅ Si es autocontenida, `Dependencias: ninguna`. Si está acoplada por la máquina de estados, lista la(s) US precedente(s) y cita el UC/estado que lo impone. ❌ Se incumple si oculta una dependencia o si solo tiene sentido junto a otra historia sin declararlo. |
| **N — Negociable** | El *qué* y el detalle de implementación son negociables; el *resultado de negocio* trazado a la spec, no. **Excepción reconocida:** las historias de actor `Sistema` disparadas por TTL/regla (expiración, bloqueo, promoción) tienen comportamiento **fijado por la spec** — su margen negociable es el *cómo* (UX de la alerta, redacción), no el *qué*. | ✅ Indica qué es negociable (UI, copy, umbral configurable vía `TENANT_SETTINGS`) frente a qué es regla fija de negocio. ❌ Se incumple si congela detalles de implementación como si fueran requisito, o si trata una regla dura (40/60, `UNIQUE(tenant_id,fecha)`) como negociable. |
| **V — Valiosa** | Entrega valor observable al `Gestor` (o garantía de negocio, si el actor es `Sistema`) y traza a **al menos un dolor D1–D13**. | ✅ El campo `Dolor(es) que resuelve` no está vacío y el "Para…" expresa valor real, no una tarea técnica. ❌ Se incumple si no mapea a ningún dolor o si el valor es puramente interno sin efecto operativo. |
| **E — Estimable** | El equipo puede estimar esfuerzo: alcance acotado, entidades y transiciones conocidas, sin incógnitas abiertas. | ✅ Entidades del er-diagram identificadas, transición de estado concreta, criterios de aceptación cerrados. ❌ Se incumple si quedan supuestos sin resolver o si toca una zona `📐` no especificada. |
| **S — Pequeña (Small)** | Cabe en una iteración. **Heurística dura de partición en Slotify:** si una historia toca **más de una zona crítica** (p. ej. bloqueo atómico **y** reordenación de cola **y** envío de email), es demasiado grande → **pártela**. Un UC con varios resultados separables (UC-08: interés / reserva inmediata / descarte) se divide en historias. | ✅ Una sola transición de estado o una sola garantía atómica por historia. ❌ Se incumple si combina varias transiciones independientes, varias zonas críticas, o el happy path + múltiples ramas que merecen historia propia. |
| **T — Testable** | Cada criterio de aceptación es ejecutable como test (BDD). En zonas críticas, **los tests de concurrencia se especifican primero** (alineado con TDD). | ✅ Todo `Dado/Cuando/Entonces` es verificable y determinista; zonas críticas incluyen escenario de race condition. ❌ Se incumple si hay criterios vagos ("el sistema funciona bien") o falta el test de concurrencia en una zona crítica. |

**Cómo aplicar la puerta:**
1. Redacta la historia.
2. Audítala contra las 6 letras.
3. Si falla **S** → pártela en varias historias y reaudita cada una.
4. Si falla **I/N** por acoplamiento legítimo de la máquina de estados → **declara la excepción** en `Dependencias`/`Notas`, no la disfraces.
5. Si falla **V/E/T** → reescribe hasta cumplir; si es imposible dentro del MVP `✅`, **no la generes** y repórtalo.
6. Rellena el bloque **Autoauditoría INVEST** de la plantilla con una línea por letra (cumple / excepción declarada + evidencia).

Una historia sin Autoauditoría INVEST está **incompleta** y no debe emitirse.

---

## VOCABULARIOS CERRADOS (ANTI-ALUCINACIÓN)

Usa **solo** estos valores. No inventes nombres nuevos.

- **Actores:** `Gestor`, `Sistema`, `Cliente` (indirecto en MVP), `Equipo` (interacción baja).
- **Entidades (er-diagram):** `TENANT`, `TENANT_SETTINGS`, `USUARIO`, `CLIENTE`, `RESERVA`, `FECHA_BLOQUEADA`, `TARIFA`, `TEMPORADA_CALENDARIO`, `EXTRA`, `RESERVA_EXTRA`, `PRESUPUESTO`, `FACTURA`, `PAGO`, `FICHA_OPERATIVA`, `DOCUMENTO`, `COMUNICACION`, `AUDIT_LOG`. **No inventes entidades nuevas.**
- **Sub-estados de consulta:** `2.a` (exploratoria), `2.b` (con fecha), `2.c` (pendiente invitados), `2.d` (en cola), `2.v` (visita programada), `2.x` (expirada, terminal), `2.y` (descartada por cola, terminal), `2.z` (descartada por cliente, terminal).
- **Estados de reserva:** `pre_reserva`, `reserva_confirmada`, `evento_en_curso`, `post_evento`, `reserva_completada` (terminal), `reserva_cancelada` (terminal).
- **Sub-procesos paralelos (atributos ENUM de RESERVA):** `pre_evento_status`, `liquidacion_status`, `fianza_status`.
- **Emails en MVP:** `E1`–`E8` (ver §9.3 para trigger y comportamiento auto/borrador). No referencies emails fuera de E1–E8.
- **Automatizaciones:** `A1`–`A30` (referencia la que aplique al UC).
- **Dolores:** `D1`–`D13`. **KPIs:** los de §7.4. **Módulos:** `M1`–`M10`.

---

## UNIDAD DE TRABAJO Y COBERTURA

- **Ancla en los UC.** Cada historia mapea a **uno o más UC** de `use-cases.md`. Un UC puede dividirse en varias historias **solo** si contiene objetivos de usuario claramente separables o flujos alternativos que merezcan historia propia (ej. UC-08 "resultado visita" → interés / reserva inmediata / descarte).
- **Cobertura obligatoria:** los 36 UC deben quedar cubiertos. Al final, **emite la matriz de trazabilidad** (ver sección de salida) para demostrar cobertura 36/36, sin huérfanos ni inventados.
- **Agrupa por las 12 áreas funcionales** del índice de `use-cases.md §2.1`.
- **Ejecución por lotes:** genera un área funcional por respuesta cuando se te indique el área. No intentes las 12 a la vez.

---

## PRIORIDAD

**Hereda** la prioridad del UC desde `use-cases.md §5` (`Crítica` | `Alta` | `Media` | `Baja`). No la re-derives. Si una historia cubre varios UC, usa la prioridad más alta.

---

## ACTOR SISTEMA

Para UC de actor `Sistema` o disparados por TTL/job programado (ej. UC-09 expirar, UC-12 promover, UC-30/31 bloquear/liberar, UC-16 calcular tarifa), usa la variante de plantilla:

> **Como** Sistema
> **Cuando se cumple** \<trigger / condición temporal / evento de estado\>
> **Ejecuto** \<acción automática\>
> **Para** \<garantía de negocio que se preserva\>

E identifica el `trigger` y la `automatización Axx` correspondiente.

---

## CRITERIOS DE ACEPTACIÓN (BDD + CONCURRENCIA)

- Escribe en **Gherkin español** (`Dado` / `Cuando` / `Entonces`), atómico y verificable. Cada criterio debe poder convertirse directamente en un test.
- Deriva el **happy path** del flujo básico del UC.
- Deriva los **edge cases de TODOS los flujos alternativos (FA-xx)** del UC + edge cases relevantes del catálogo de la spec. **No fuerces un número fijo**: genera los que el UC y la spec justifiquen.
- **Reglas de validación** alineadas con pre/post-condiciones del UC.
- **ZONAS CRÍTICAS — tests de concurrencia obligatorios.** Si la historia toca **bloqueo atómico de fecha, máquina de estados, motor de tarifas, o cola con concurrencia**, incluye explícitamente escenarios de **race condition** (TDD primero). Ejemplo de patrón a exigir:
  > Dado dos solicitudes concurrentes para bloquear la misma `fecha` en el mismo `tenant`
  > Cuando ambas transacciones intentan insertar en `FECHA_BLOQUEADA`
  > Entonces exactamente una tiene éxito y la otra recibe violación de `UNIQUE(tenant_id, fecha)`, sin doble reserva (D4)
- **Puerta INVEST obligatoria:** antes de emitir, valida la historia contra la sección *INVEST — Estándar de calidad rector*. Si falla **Small**, pártela; si falla cualquier otra letra, reescríbela o no la generes. Rellena la Autoauditoría INVEST en la plantilla.

---

## PLANTILLA EXACTA DE LA HISTORIA

Usa esta plantilla **sin omitir secciones**:

```markdown
# 🧾 Historia de Usuario: <TÍTULO>

## 🆔 Metadatos
- ID: US-<incremental, 3 dígitos: US-001>
- Área funcional: <una de las 12 áreas de use-cases.md §2.1>
- Módulo: <M1–M10>
- Prioridad: <Crítica | Alta | Media | Baja>  (heredada del UC)
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** <Gestor | Sistema | Cliente | Equipo>
**Quiero / Ejecuto** <objetivo o acción>
**Para** <valor de negocio>

## 🧠 Contexto de Negocio
- Caso(s) de uso: <UC-xx [, UC-yy]>
- Entidades implicadas: <solo entidades del er-diagram>
- Dolor(es) que resuelve: <D1–D13>
- Automatización relacionada: <Axx, si aplica>
- Email relacionado: <E1–E8, si aplica>
- Reglas de negocio:
  - <regla trazable a la spec / UC>
- Supuestos: <solo si necesarios>
- Dependencias: <otras US o precondiciones>
- Notas de alcance: <si el UC roza una zona 📐, qué queda fuera y por qué>

## ✅ Criterios de Aceptación (BDD)
### 🎯 Happy Path
- **Dado** <contexto>
  **Cuando** <acción>
  **Entonces** <resultado esperado>

### ⚠️ Flujos Alternativos y Edge Cases
#### <FA-xx / nombre del caso>
- **Dado** <contexto>
  **Cuando** <acción>
  **Entonces** <resultado>
- Comportamiento del sistema: <cómo lo maneja>
(repetir por cada flujo alternativo / edge case justificado)

### 🔒 Concurrencia / Race Conditions (solo zonas críticas)
- **Dado** <contexto concurrente>
  **Cuando** <acciones simultáneas>
  **Entonces** <garantía atómica / determinista>

### 🚫 Reglas de Validación
- <validación alineada con pre/post-condiciones>

## 📊 Impacto de Negocio
- KPI afectado: <KPI de §7.4>
- Impacto esperado: <cualitativo>
- Criterio de éxito: <métrica + objetivo medible>

## 🧪 Autoauditoría INVEST (obligatoria)
- **I — Independiente:** <Cumple | Excepción: depende de US-xxx por máquina de estados (cita UC/estado)>
- **N — Negociable:** <qué es negociable vs qué es regla fija de negocio>
- **V — Valiosa:** <valor observable + dolor(es) Dx que resuelve>
- **E — Estimable:** <Cumple | incógnitas pendientes (si las hay, no emitir)>
- **S — Pequeña:** <Cumple: 1 transición/garantía | Partida desde UC-xx en US-aaa/US-bbb>
- **T — Testable:** <Cumple | zona crítica: incluye test de concurrencia>
```

---

## FORMATO Y ESTRUCTURA DE SALIDA

1. **Una historia por fichero Markdown.** No mezcles historias en un fichero.
2. Ruta y nombre:
   ```
   /user-stories/US-<ID>-<slug>.md
   ```
   - `slug` en minúsculas, espacios → guiones, corto y descriptivo.
   - Ejemplo: `US-007-programar-visita-espacio.md`
3. Cada fichero empieza con:
   ```
   PATH: /user-stories/US-<ID>-<slug>.md
   ```
   seguido de la historia completa con la plantilla.
4. IDs **secuenciales y sin colisiones** a lo largo de toda la generación (lleva el contador entre lotes).

---

## ARTEFACTO DE VERIFICACIÓN OBLIGATORIO

Al cerrar cada lote (o al final), emite además una **Matriz de Trazabilidad** (fichero `/user-stories/_trazabilidad.md`):

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|

- Columna **INVEST**: `OK` si las 6 letras pasan; `OK (excepción I/N)` si hay acoplamiento de máquina de estados declarado; nunca dejar vacío.
- Marca cualquier UC **sin cobertura** y cualquier US **sin UC de origen** (sería invención → eliminar).
- Reporta explícitamente: `UC cubiertos: X/36` y `Historias que pasan la puerta INVEST: Y/Y` (deben coincidir; si una historia no pasa INVEST, no debería haberse emitido).

Esta matriz **no es "comentario"**: es el contrato de calidad de la generación.

---

## RESTRICCIONES (NO NEGOCIABLES)

- ❌ Nada de historias genéricas o vagas.
- ❌ Ninguna funcionalidad fuera de los UC / fuera de `✅ MVP`.
- ❌ No inventar entidades, estados, emails ni automatizaciones fuera de los vocabularios cerrados.
- ❌ Nada de diseño cliente-céntrico (CRM).
- ❌ No "reabrir" consultas terminales.
- ❌ No omitir secciones de la plantilla.
- ❌ No omitir tests de concurrencia en zonas críticas.
- ✅ Si dudas o detectas contradicción/ausencia en la spec, **dilo explícitamente** antes de generar. Un "no está cubierto" honesto es preferible a inventar.

---

## INSTRUCCIÓN DE ARRANQUE

Cuando te indique un **área funcional** (p. ej. "Gestión de Leads y Consultas, UC-03 a UC-10"), genera las historias de esa área siguiendo todo lo anterior y, al final del lote, su fragmento de matriz de trazabilidad. No empieces hasta que te indique el área (o responde "Listo, indícame el área" si no se especifica).

**Prompt 3:**

## MODO
Tarea **mecánica**. La extracción la hace un script determinista ya escrito (`scripts/extract_backlog.py`). **No deliberes y NO leas las historias en tu contexto.** Ejecuta el script, valida la salida y reporta.

## PASOS

### 1. Ejecuta el extractor
```bash
python3 scripts/extract_backlog.py
```
El script lee `user-stories/US-*.md`, extrae los campos, construye el grafo (fan-out transitivo, ciclos, profundidad) y escribe `user-stories/_analisis.json`. Imprime un resumen y devuelve código de salida 1 si hay ciclos o dependencias rotas.

### 2. Valida (sin leer las historias completas)
Mira el resumen impreso y el campo `grafo.anomalias_extraccion` del JSON:
- **Pocas o cero anomalías** → has terminado.
- **Muchas anomalías** (p. ej. >5 historias sin Prioridad, o `area` casi siempre vacía) → la plantilla difiere de lo que asume el regex. Solo entonces: abre **UNA** historia de muestra (`Read` de un único fichero) para ver el formato real de las etiquetas, **edita el regex en `scripts/extract_backlog.py`** (es un fichero real, edítalo directamente) y vuelve a ejecutar el script. No abras más de una historia.

### 3. Reporta en el chat (breve)
- Nº de historias, ciclos (o "ninguno"), dependencias rotas, huérfanos, profundidad máxima, nº de anomalías y las 5 de mayor fan-out.
- Comprueba y comenta si `US-000A` está entre las de mayor fan-out (debería: toda pantalla autenticada cuelga de ella).
- **No vuelques el JSON completo**; ya está en `user-stories/_analisis.json`.

## NOTAS
- Requiere `python3` (solo librería estándar, sin instalaciones).
- `user-stories/_analisis.json` es el único insumo de `/ordenar-backlog`.
- Si quieres usarlo como verificación en CI/pre-commit más adelante: el script sale con código 1 cuando el grafo no está limpio.

**Prompt 4:**
## ROL
Eres arquitecto de software senior. Esta es la **segunda pasada**. Recibes el fichero compacto `user-stories/_analisis.json` (de `/analizar-backlog`) y produces el **backlog ordenado**. NO relees las 47 historias: todo lo que necesitas está en `_analisis.json`.

**Alcance estricto:** ordenas y clasificas; **NO** asignas sprints ni estimas capacidad de equipo (eso es de un paso posterior).

## ENTRADA
- **Lee** `user-stories/_analisis.json`. Si no existe o es JSON inválido, **detente** e indica al usuario que ejecute primero `/analizar-backlog`.
- Si `grafo.ciclos` no está vacío, **detente** y repórtalo: no se puede ordenar topológicamente con ciclos.

## EFICIENCIA
El grafo ya viene **calculado de forma determinista** por el script de la pasada 1: `fan_out`, `ciclos`, `huerfanos`, `dependencias_rotas` y `profundidad_max` son fiables. **No los recalcules ni deliberes sobre ellos.** Trabajas sobre datos compactos (un JSON pequeño), así que no necesitas razonamiento intensivo: dedica tu juicio solo a lo que requiere criterio (clasificar capa, ordenar, estimar talla).

## PRINCIPIO RECTOR: ORDEN DE CONSTRUCCIÓN ≠ ORDEN DE PANTALLA
Que una pantalla sea la primera que ve el usuario (p. ej. el **calendario**, home tras login) NO implica que se construya primero. El orden lo manda el **grafo de dependencias**.
- El **armazón de navegación / app shell** (US-000A) es infraestructura compartida → `Fundacional`/temprano.
- El **contenido con datos** de una vista de lectura (calendario que pinta reservas, listados, widgets) depende de que esas entidades existan → se ordena según dependencias, normalmente más tarde. No la marques temprana solo por ser la primera pantalla.

## PASOS
1. **Orden topológico (restricción dura e inviolable):** ninguna historia puede ir antes que cualquiera de sus `depende_de`. Reconstruye la adyacencia desde `depende_de`.
2. **Clasificar `tipo`:**
   - `Fundacional`: scaffolding, app shell / navegación, autenticación, y operaciones con **alto fan_out** o **concurrencia_critica** (bloqueo atómico de fecha, motor de tarifas, infraestructura de email, máquina de estados).
   - `Spine`: camino feliz de la reserva (consulta con fecha → presupuesto/pre-reserva → confirmación de señal → ejecución → post-evento/devolución).
   - `Soporte`: el resto, que se apoya en las anteriores y se construye después (cola, contenido del calendario, listados, histórico, CSV, dashboard, comunicaciones manuales, flujos alternativos). `Soporte` = orden posterior, **no** menor importancia.
3. **Ordenar:** dentro de lo que el orden topológico permite → `Fundacional → Spine → Soporte`; dentro de cada grupo, **concurrencia y mayor fan_out suben** (riesgo primero); desempate por criticidad `Critica > Alta > Media > Baja`.
4. **Estimar `talla_tecnica`** (`XS/S/M/L/XL`) con las señales del análisis: `concurrencia_critica`, `integraciones`, `num_edge_cases`, y la posición en la máquina de estados. Solo complejidad arquitectónica; NO la conviertas en días ni story points. Una línea de justificación por historia.
5. **Validar:** todas las historias ordenadas; ninguna precede a su dependencia; reporta `historias_ordenadas: X/N`, `profundidad_max`, `historias_fundacionales: K`.
6. **Escribe** `user-stories/_backlog.json` con el esquema de abajo. Tras escribirlo, imprime en el chat solo el resumen de validación (no vuelques el JSON entero).

## ESQUEMA DE `_backlog.json`
```json
{
  "meta": {
    "proyecto": "Slotify MVP",
    "generado": "<ISO-8601>",
    "total_historias": 47,
    "ventana_codigo": { "inicio": "2026-06-12", "fin_codigo": "2026-07-10" }
  },
  "validacion": {
    "historias_ordenadas": "47/47",
    "profundidad_max_grafo": 0,
    "historias_fundacionales": 0,
    "ciclos": [], "huerfanos": [], "dependencias_rotas": []
  },
  "backlog": [
    {
      "orden": 1,
      "id": "US-000",
      "titulo": "<corto>",
      "area": "<área>",
      "prioridad": "Critica",
      "tipo": "Fundacional | Spine | Soporte",
      "talla_tecnica": "XS | S | M | L | XL",
      "talla_justificacion": "<una línea>",
      "concurrencia_critica": false,
      "fan_out": 0,
      "depende_de": [],
      "dolores": ["D1"]
    }
  ]
}
```

## RESTRICCIONES
- `backlog` ordenado por `orden` (1..N) = orden de ejecución del paso 3.
- `id` admite sufijos no numéricos (`US-000A`): trátalos como texto.
- No violar el orden topológico por criticidad ni por orden de pantalla.
- No asignar sprints ni story points de esfuerzo.
- No emitir texto dentro del bloque JSON ni JSON inválido.

---

### 6. Tickets de Trabajo

Voy a utilizar metodologia SDD por lo que mi intención es definir tareas atomicas en cada spec de cada historia de usuario.

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

---

### 7. Pull Requests

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**
