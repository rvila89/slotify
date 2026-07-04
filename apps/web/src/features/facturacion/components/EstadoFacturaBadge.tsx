import { cn } from '@/lib/utils';
import { estadoVisualFactura, type EstadoVisualFactura } from '../lib/estado';
import type { FacturaSenal } from '../model/types';

/**
 * Insignia tonal del estado visual de la factura de señal (US-022). Combina el
 * `estado` del ciclo de vida con los flags derivados (`esBorradorInvalido`,
 * `pdfPendiente`) en cuatro tonos con los tokens del proyecto:
 *  - `enviada`: verde (factura lista para E3, sin acciones).
 *  - `borrador-invalido`: rojo (faltan datos fiscales; aprobación bloqueada).
 *  - `pdf-pendiente`: ámbar (PDF en proceso; aprobación bloqueada, se reintenta).
 *  - `borrador`: neutro (borrador válido, listo para aprobar/rechazar).
 */
const CONFIG: Record<EstadoVisualFactura, { label: string; tono: string }> = {
  enviada: {
    label: 'Enviada',
    tono: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  'borrador-invalido': {
    label: 'Borrador inválido',
    tono: 'border-red-200 bg-red-50 text-red-700',
  },
  'pdf-pendiente': {
    label: 'PDF pendiente',
    tono: 'border-amber-200 bg-amber-50 text-amber-900',
  },
  borrador: {
    label: 'Borrador',
    tono: 'border-border-default bg-surface-muted text-text-secondary',
  },
};

export const EstadoFacturaBadge = ({ factura }: { factura: FacturaSenal }) => {
  const estado = estadoVisualFactura(factura);
  const { label, tono } = CONFIG[estado];
  return (
    <span
      data-testid="badge-estado-factura"
      data-estado={estado}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 font-body text-xs font-semibold',
        tono,
      )}
    >
      <span aria-hidden className="size-2 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
};
