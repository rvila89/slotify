---
description: Estándares y buenas prácticas para la documentación técnica de Slotify, incluyendo estructura, proceso de actualización y reglas de idioma.
globs:
alwaysApply: true
---
# Reglas y patrones de documentación y AI specs — Slotify

## Introducción
La **documentación técnica** abarca toda la documentación relativa al proyecto: modelo de datos, README, especificación de la API, diagramas y demás documentos `.md` que describen cómo está estructurado, cómo se ejecuta y cómo opera Slotify.

## Reglas generales de idioma
- **ESCRIBE SIEMPRE EN ESPAÑOL** toda la documentación, incluidos comentarios y explicaciones dentro de los ficheros. Aplica tanto a documentación nueva como a la actualización de la existente, y también a la documentación dentro del código (comentarios, explicaciones de funciones o campos).
- Respeta el **lenguaje ubicuo del dominio** definido en [base-standards.md §2](./base-standards.md): conceptos de negocio en español (reserva, presupuesto, fianza, cola de espera), nombres de librerías y APIs de framework en su forma nativa.
- No traduzcas identificadores de código de terceros ni palabras clave técnicas.

## Conjunto de documentos en `docs/`

| Documento | Contenido | ¿Quién lo modifica? |
|---|---|---|
| `architecture.md` | Arquitectura MVP y objetivo de producción | Contexto canónico — **no modificar sin acuerdo** |
| `er-diagram.md` | Diagrama entidad-relación canónico (Mermaid) | Fuente de verdad del modelo de datos |
| `use-cases.md` | 36 casos de uso (UC-01…UC-36) y máquina de estados | Contexto canónico |
| `c4-diagrams.md` | Diagramas C4 (Context, Container MVP, Component) en PlantUML | Se regenera vía `.github/prompts/c4-diagrams.prompt.md` |
| `data-model.md` | Definición de entidades, campos y reglas de validación para implementación | Actualizar ante cambios de modelo |
| `api-spec.yml` | Contrato OpenAPI 3.0 de la API (fuente del cliente type-safe del front) | Actualizar ante cambios de endpoints |
| `base-standards.md` | Principios transversales y política de idioma | Actualizar con acuerdos de equipo |
| `backend-standards.md` | Estándares del backend NestJS | Actualizar ante cambios de stack/patrón |
| `frontend-standards.md` | Estándares del frontend React | Actualizar ante cambios de stack/patrón |
| `documentation-standards.md` | Este documento | Actualizar con acuerdos de equipo |
| `development_guide.md` | Puesta en marcha del entorno y tests | Actualizar ante cambios de instalación |
| `openspec-tasks-mandatory-steps.md` | Checklist obligatorio de `tasks.md` | Convención del harness OpenSpec |

## Documentación técnica: proceso de actualización
Antes de cualquier commit o `git push`, o si se te pide documentar un commit, **siempre** debes revisar qué documentación técnica conviene actualizar.

Al actualizar documentación:
1. Revisa todos los cambios recientes en el código.
2. Identifica qué ficheros de documentación necesitan actualizarse según los cambios. Ejemplos claros:
   - Cambios en el modelo de datos → actualiza `data-model.md` **y** `er-diagram.md` (deben quedar consistentes entre sí y con `schema.prisma`).
   - Cambios en la API → actualiza `api-spec.yml` (y regenera el cliente del front si procede).
   - Cambios en librerías, migraciones de base de datos o cualquier cosa que afecte la instalación → actualiza el `*-standards.md` correspondiente y `development_guide.md`.
   - Cambios de arquitectura/contenedores → solicita la regeneración de `c4-diagrams.md` con el prompt de `.github/prompts/`.
3. Actualiza cada fichero afectado **en español**, manteniendo la consistencia con la documentación existente.
4. Asegura que todo esté correctamente formateado y siga la estructura establecida.
5. Verifica que las **referencias cruzadas entre documentos** sigan siendo coherentes (entidades, enums, endpoints y nombres de módulos alineados entre `data-model.md`, `api-spec.yml`, `er-diagram.md` y `*-standards.md`).
6. Reporta qué ficheros se actualizaron y qué cambios se hicieron.

## Formato y estilo
- Encabezado de documento con metadatos (documento, proyecto, versión, fecha, fuente) como en `architecture.md` y `er-diagram.md`.
- Tablas Markdown para diccionarios de datos, enums y endpoints.
- Bloques de código etiquetados con el lenguaje (`ts`, `prisma`, `yaml`, `mermaid`, `plantuml`, `bash`).
- Enlaces relativos entre documentos de `docs/`.
- Fechas en formato `DD/MM/AAAA`.

## AI specs

Esta regla establece un proceso obligatorio para que el Agente IA:
*   Aprenda del feedback, las indicaciones y las sugerencias del usuario durante las interacciones.
*   Identifique de forma proactiva oportunidades de mejora de las reglas de desarrollo existentes a partir de esos aprendizajes.
*   Mantenga su asistencia alineada con las necesidades cambiantes del proyecto y las expectativas del usuario.
*   Incorpore el feedback del usuario a su marco operativo para maximizar su valor.

Aplica tras cualquier interacción donde el usuario proporcione feedback explícito o implícito, sugerencias, correcciones, nueva información o preferencias. **El Agente IA DEBE analizar activamente todas las interacciones en busca de estas oportunidades de aprendizaje, no solo esperar pasivamente feedback directo.**

### Errores comunes y anti-patrones a evitar por el Agente IA

*   **Saltarse el proceso de aprobación:** aplicar modificaciones de reglas sin obtener antes revisión y aprobación explícita del usuario.
*   **Propuestas sin vínculo:** proponer cambios de reglas sin conectarlos claramente con el feedback o los aprendizajes concretos de la interacción.
*   **Modificaciones imprecisas:** sugerir cambios sin identificar con precisión qué regla o sección debe cambiar, dificultando la revisión.
*   **Feedback no atendido:** no iniciar el proceso de aprendizaje y revisión cuando el usuario da feedback relevante que podría mejorar las reglas.
*   **Scope creep:** actualizar varias reglas no relacionadas a la vez o exceder el alcance del feedback recibido.
*   **Cambios no solicitados:** modificar reglas proactivamente sin conexión directa con feedback o una oportunidad de aprendizaje. Las actualizaciones de reglas deben ser reactivas y guiadas por feedback.
*   **Falta de confirmación:** no avisar al usuario tras implementar con éxito una modificación de regla aprobada.
