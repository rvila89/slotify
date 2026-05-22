---
agent: 'agent'
description: 'Genera un diagrama de entidad-relación (DER) profesional con configuración personalizable'
---

# Prompt Generador de Diagramas de Entidad-Relación

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

1. **Resumen breve** (2-3 párrafos) describiendo el dominio, las entidades principales y las decisiones de diseño más relevantes.
2. El **diagrama** completo en el formato seleccionado, dentro de un bloque de código.
3. El **diccionario de datos** resumido con las entidades y sus atributos clave.
