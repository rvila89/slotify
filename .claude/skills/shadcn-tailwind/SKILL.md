---
name: shadcn-tailwind
description: Usar cuando haya que construir componentes UI con shadcn/ui sobre Tailwind, aplicando tokens de Figma y accesibilidad.
---

# Componentes con shadcn/ui + Tailwind

## Cuándo usar
- Al crear o componer componentes de UI en `apps/web`.
- Para aplicar design tokens y garantizar accesibilidad.

## Reglas
- Usar **shadcn/ui** como base de componentes sobre utilidades **Tailwind**.
- Los **tokens de diseño** provienen de las variables de Figma (`get_variable_defs`); mapearlos a variables CSS/tema Tailwind. **No hardcodear** colores/espaciados.
- Preferir **composición** de primitivas shadcn frente a componentes monolíticos.
- **Responsive obligatorio (mobile-first)**: estilos base para móvil + breakpoints Tailwind (`md:`, `lg:`…) para pantallas mayores. `lg:` es el corte mobile↔desktop. Ejemplos: ancho `w-full md:w-1/2 lg:w-1/3`; grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`; padding `p-4 md:p-6 lg:p-8`; mostrar/ocultar `hidden lg:flex` / `lg:hidden`. Para drawers/modales móviles, usar `Sheet`/`Dialog` (Radix, accesibles). Verificar en 3 viewports (390/768/1280) antes de finalizar.
- **Accesibilidad**: roles ARIA, foco visible, labels asociados, navegación por teclado (shadcn/Radix ya aportan base, no romperla).

## Patrón de referencia
```tsx
// Componer, no envolver de más
import { Button } from '@/components/ui/button';

export function ConfirmarReservaButton({ onConfirm, loading }: Props) {
  return (
    <Button variant="default" disabled={loading} onClick={onConfirm}>
      {loading ? 'Confirmando…' : 'Confirmar reserva'}
    </Button>
  );
}
```
- Tokens: definir en `tailwind.config`/CSS vars desde variables Figma; usar clases semánticas (`bg-primary`) no literales (`bg-[#1a73e8]`).

## Errores comunes
- **Implementar solo-desktop**: que se vea bien en escritorio pero rompa en móvil (sin breakpoints, anchos px fijos, nav lateral que no colapsa). No verificar en 390/768/1280.
- Hardcodear valores hex/px en vez de usar tokens.
- Duplicar lógica de Radix (focus, aria) en vez de apoyarse en shadcn.
- Componentes gigantes en lugar de composición de primitivas.
- Sobrescribir estilos con `!important` rompiendo el sistema de tokens.

## Fuentes
- `docs/frontend-standards.md`; variables de Figma vía MCP (`figma-design-consume`).
- Skills: `frontend-feature`, `tanstack-forms`.
