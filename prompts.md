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

---

## 2. Arquitectura del Sistema

### **2.1. Diagrama de arquitectura:**

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

### **2.2. Descripción de componentes principales:**

**Prompt 1:**

**Prompt 2:**

**Prompt 3:**

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