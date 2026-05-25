---
agent: 'agent'
description: 'Genera una arquitectura de alto nivel para una plataforma SaaS de gestión integral para espacios boutique de eventos privados, usando AWS con diagrama Mermaid y prompt para DiagramsGPT'
---

### Rol y contexto

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

### Requisitos técnicos

Usa **servicios de la nube de AWS exclusivamente**.
La arquitectura debe cumplir con los **requisitos no funcionales** de:

- Escalabilidad
- Seguridad
- Mantenibilidad
- Alta disponibilidad

### Instrucciones de diseño

1. Crea una **arquitectura de alto nivel** para el sistema **Slotify**.
2. Usa **buenas prácticas**, **frameworks** y **herramientas** (open source o comerciales) cuando sea relevante.
3. Considera **toda la información obtenida hasta el momento**, incluido el **modelo de datos** y los **casos de uso** definidos.
4. Toda la funcionalidad definida en el **alcance del MVP** debe estar representada en el diseño.

### Entregables (artefactos separados)

- **Explicación general del diseño de la arquitectura.**
- **Diagrama del sistema en formato Mermaid.**
- **Prompt para generar el diagrama con el servicio de DiagramsGPT.**

Asegúrate de:

- Verificar que la **sintaxis Mermaid sea correcta**.
- **Corregir cualquier error** que pueda aparecer.
- Validar que toda la funcionalidad del MVP esté representada en el diseño.

### Guardado de resultados

Una vez generados los entregables, crea o sobreescribe el archivo `docs/architecture.md` en la raíz del proyecto con el siguiente contenido:

1. **Resumen breve** (2-3 párrafos) describiendo las decisiones de diseño principales.
2. El **diagrama Mermaid** completo dentro de un bloque de código.
3. El **prompt para DiagramsGPT** dentro de un bloque de texto. Este prompt tiene que ser claro y detallado para que DiagramsGPT pueda generar el diagrama correctamente y no sobredimensione el diseño de la aplicación, enfocándose solo en los componentes y servicios necesarios para el MVP.

### Restricciones

- No generes ningún otro tipo de artefacto que no esté especificado en los entregables.
- No sobredimensiones el diseño de la arquitectura, enfocándote solo en los componentes y servicios necesarios para el MVP.
