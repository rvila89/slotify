# CONTEXTO
Operas en el repo de Slotify, con acceso al workspace.
- `backlog.json`: grafo de dependencias autoritativo (campos `id`, `orden`, `depende_de`, ...). SOLO LECTURA, no lo modifiques.
- `docs/user-stories/US-*.md`: historias de usuario (AJUSTA esta ruta si difiere). Son el objetivo.

# OBJETIVO
Anteponer un bloque de frontmatter YAML a CADA archivo `US-*.md`, para trazar el estado de desarrollo.
Este estado es DISTINTO del campo "Estado:" que ya existe dentro de la sección "## 🆔 Metadatos" del cuerpo (ese es estado documental, Borrador/Revisado). NO toques ese campo ni ninguna otra línea existente.

# ESQUEMA EXACTO del frontmatter a insertar
---
id: <el US-XXX que aparece en la línea "ID:" del archivo>
estado: backlog
branch: null
pr: null
---

# REGLAS
1. IDEMPOTENTE: si el archivo YA empieza por un bloque `---` de frontmatter, NO lo modifiques; regístralo como "ya tenía frontmatter".
2. Inserta el bloque en la primera línea del archivo, seguido de una línea en blanco, y deja TODO el contenido existente intacto debajo (incluido el `# 🧾 Historia...`).
3. `estado` es SIEMPRE `backlog` (nada está desarrollado aún). `branch` y `pr` SIEMPRE `null`.
4. Deriva `id` de la línea "ID: US-XXX" del propio archivo. Si NO puedes determinar el id con certeza, NO LO INVENTES: pon `id: NO ESPECIFICADO` y márcalo en el informe.
5. YAML válido: enums sin comillas, `null` en minúscula.

# VERIFICACIÓN (obligatoria, no la omitas)
Tras editar, genera una tabla:
| archivo | id detectado | ¿existe en backlog.json? (sí/no) | acción (añadido / saltado / [VERIFICAR]) |
Y además lista explícitamente:
- IDs de `backlog.json` que NO tienen archivo `US-*.md` correspondiente  → [VERIFICAR]
- archivos `US-*.md` cuyo id NO está en `backlog.json`  → [VERIFICAR]
- cualquier archivo marcado `NO ESPECIFICADO`  → [VERIFICAR]
No declares éxito sobre archivos que no hayas verificado realmente.