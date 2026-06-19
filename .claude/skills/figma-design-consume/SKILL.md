---
name: figma-design-consume
description: Usar cuando haya que implementar una UI a partir de un diseño de Figma consumido vía el MCP de Figma.
---

# Consumir diseños de Figma (MCP)

## Cuándo usar
- Cuando se recibe un link o nodo de Figma para implementar.
- Siempre que el frontend-developer traduzca diseño a código.

## Reglas
- El frontend-developer **DEBE** consumir diseños de Figma vía el **MCP de Figma**.
- **Antes** de `use_figma` cargar la skill `figma-use` (ver `/figma` del plugin).
- **No hardcodear valores**: usar los design tokens/variables de Figma.
- Implementar con **shadcn/ui + Tailwind** mapeando tokens.
- Si existe Code Connect, **reusar el componente mapeado** en vez de reimplementar.

## Patrón de referencia (flujo)
1. `get_metadata` → entender estructura/jerarquía de nodos.
2. `get_design_context` → contexto/código del nodo.
3. `get_variable_defs` → design tokens/variables.
4. `get_screenshot` → referencia visual.
5. `get_code_connect_map` → mapeo componente Figma ↔ código.
6. Implementar con shadcn/Tailwind usando los tokens; reusar componentes de Code Connect.

## Herramientas clave del MCP
- `get_design_context` — contexto/código de un nodo.
- `get_screenshot` — referencia visual.
- `get_metadata` — estructura/jerarquía.
- `get_variable_defs` — tokens/variables.
- `get_code_connect_map` — mapeo Figma ↔ código.

## Errores comunes
- Llamar a `use_figma` sin cargar antes la skill `figma-use`.
- Hardcodear colores/espaciados en vez de usar variables.
- Reimplementar a mano un componente que ya tiene Code Connect.
- Implementar sin entender la jerarquía (saltarse `get_metadata`).

## Fuentes
- MCP de Figma; skills `figma-use` y `/figma` del plugin.
- `docs/frontend-standards.md`. Skills: `shadcn-tailwind`, `frontend-feature`.
