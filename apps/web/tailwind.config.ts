import type { Config } from 'tailwindcss';

/*
 * Mapea los design tokens (CSS custom properties de src/index.css) a utilidades
 * de Tailwind. Fuente de verdad de los valores: docs/DESIGN.md §1–§3.
 * Los componentes consumen estas clases (bg-canvas, text-text-primary,
 * bg-state-confirmada, font-display, …), nunca hex inline.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: 'var(--color-brand-primary)',
          foreground: 'var(--color-primary-foreground)',
        },
        canvas: 'var(--color-bg-canvas)',
        surface: {
          muted: 'var(--color-surface-muted)',
          subtle: 'var(--color-surface-subtle)',
        },
        accent: {
          active: 'var(--color-accent-active)',
        },
        border: {
          default: 'var(--color-border-default)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
        },
        state: {
          confirmada: 'var(--color-state-confirmada)',
          bloqueada: 'var(--color-state-bloqueada)',
          cola: 'var(--color-state-cola)',
          disponible: 'var(--color-state-disponible)',
        },
        // Código de colores canónico del calendario (US-039 §11.3). El backend
        // emite el nombre lógico (`gris|ambar|verde|azul|rojo`); el frontend lo
        // mapea a estas clases. Idéntico en todas las vistas.
        cal: {
          gris: 'var(--color-cal-gris)',
          'gris-foreground': 'var(--color-cal-gris-foreground)',
          ambar: 'var(--color-cal-ambar)',
          'ambar-foreground': 'var(--color-cal-ambar-foreground)',
          verde: 'var(--color-cal-verde)',
          'verde-foreground': 'var(--color-cal-verde-foreground)',
          azul: 'var(--color-cal-azul)',
          'azul-foreground': 'var(--color-cal-azul-foreground)',
          rojo: 'var(--color-cal-rojo)',
          'rojo-foreground': 'var(--color-cal-rojo-foreground)',
        },
      },
      fontFamily: {
        display: 'var(--font-display)',
        body: 'var(--font-body)',
        sans: 'var(--font-body)',
        epilogue: 'var(--font-display)',
        manrope: 'var(--font-body)',
      },
      borderRadius: {
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
    },
  },
  plugins: [],
} satisfies Config;
