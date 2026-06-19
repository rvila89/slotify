---
name: sdk-codegen
description: Usar cuando haya que elegir, configurar o ejecutar el generador del cliente API tipado desde el contrato OpenAPI.
---

# Generación del SDK desde OpenAPI

## Cuándo usar
- Al decidir la herramienta de codegen (decisión diferida a **US-000**).
- Para configurar o ejecutar `pnpm generate:api`.
- Cuando el frontend necesita un cliente tipado nuevo o actualizado.

## Reglas
- La decisión de herramienta está **diferida a US-000**; la recomienda el agente **contract-engineer**.
- Script estándar: **`pnpm generate:api`** → salida en **`apps/web/src/api-client/`**.
- La salida es generada: no se edita a mano (ver `contract-sync`).
- Documentar y registrar la decisión con criterios, pros/cons.

## Patrón de referencia (evaluar y registrar)
**Opción A — orval** (recomendada por fit):
- Genera hooks de **TanStack Query** + esquemas **Zod** directamente desde OpenAPI.
- Mejor encaje: el frontend usa TanStack Query + Zod + React Hook Form.
- Contra: más configuración/opinión; salida más grande.

**Opción B — openapi-typescript + openapi-fetch**:
- Cliente `fetch` tipado ligero a partir de los tipos.
- Contra: **wiring manual** de TanStack Query (hooks a mano).

**Registro de la decisión**:
1. Comparar contra criterios: hooks Query, Zod, peso, mantenimiento.
2. Elegir y documentar en US-000.
3. Fijar `pnpm generate:api` y `apps/web/src/api-client/` como contrato del script.

## Errores comunes
- Empezar a generar sin cerrar la decisión de US-000.
- Cambiar la ruta de salida o el nombre del script ad-hoc.
- Editar el cliente generado.

## Fuentes
- `docs/frontend-standards.md`, `docs/architecture.md`.
- Skills: `contract-sync`, `frontend-feature`.
