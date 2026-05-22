---
agent: 'agent'
description: 'Genera una arquitectura de alto nivel para un sistema ATS usando AWS con diagrama Mermaid y prompt para DiagramsGPT'
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

1. Crea una **arquitectura de alto nivel** para el sistema **ATS**.
2. Usa **buenas prácticas**, **frameworks** y **herramientas** (open source o comerciales) cuando sea relevante.
3. Considera **toda la información obtenida hasta el momento**, incluido el **modelo de datos**.

### Entregables (artefactos separados)

- **Explicación general del diseño de la arquitectura.**
- **Diagrama del sistema en formato Mermaid.**
- **Prompt para generar el diagrama con el servicio de DiagramsGPT.**

Asegúrate de:

- Verificar que la **sintaxis Mermaid sea correcta**.
- **Corregir cualquier error** que pueda aparecer.

### Guardado de resultados

Una vez generados los entregables, crea o sobreescribe el archivo `docs/architecture.md` en la raíz del proyecto con el siguiente contenido:

1. **Resumen breve** (2-3 párrafos) describiendo las decisiones de diseño principales.
2. El **diagrama Mermaid** completo dentro de un bloque de código.
3. El **prompt para DiagramsGPT** dentro de un bloque de texto.

### Restricciones

- No generes ningún otro tipo de artefacto que no esté especificado en los entregables.
