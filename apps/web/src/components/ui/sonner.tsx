import { Toaster as SonnerToaster } from 'sonner';

/**
 * Contenedor global de notificaciones (toasts) de la app, sobre `sonner`.
 * Estilo alineado con los tokens del proyecto (cream/brand/sand/ink): fondo
 * `bg-canvas`, borde `border-default`, texto `text-primary`, y variantes de
 * éxito/error/advertencia con los mismos tonos que los avisos inline del
 * dominio (emerald / red / amber). Se monta una única vez en `App`.
 *
 * Mobile-first: en `<sm` los toasts ocupan el ancho disponible con margen; en
 * pantallas grandes se anclan abajo a la derecha. No introduce overflow.
 */
export const Toaster = () => (
  <SonnerToaster
    position="bottom-right"
    richColors={false}
    closeButton
    toastOptions={{
      classNames: {
        toast:
          'group rounded-[16px] border border-border-default bg-canvas p-4 font-body text-sm text-text-primary shadow-lg',
        description: 'text-text-secondary',
        actionButton: 'rounded-full bg-brand-primary text-brand-foreground',
        cancelButton: 'rounded-full bg-surface-muted text-text-secondary',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        error: 'border-red-200 bg-red-50 text-red-700',
        warning: 'border-amber-200 bg-amber-50 text-amber-900',
      },
    }}
  />
);
