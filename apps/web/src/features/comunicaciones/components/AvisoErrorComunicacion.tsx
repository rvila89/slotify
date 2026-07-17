import { AlertTriangle, Info } from 'lucide-react';

/**
 * Aviso de error inline de las acciones de comunicaciones (US-046 · UC-36). El
 * destinatario inválido (422) es una situación recuperable (tono informativo ámbar,
 * el borrador se conserva); el resto (conflicto de estado, fallo de proveedor,
 * genérico) usa tono de error (rojo). Mobile-first, sin overflow.
 */
type Props = {
  mensaje: string;
  /** `true` para el 422 (destinatario inválido, recuperable): tono ámbar informativo. */
  recuperable?: boolean;
  testId?: string;
};

export const AvisoErrorComunicacion = ({ mensaje, recuperable = false, testId }: Props) => (
  <div
    role="alert"
    data-testid={testId ?? 'aviso-error-comunicacion'}
    className={
      recuperable
        ? 'flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900'
        : 'flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700'
    }
  >
    {recuperable ? (
      <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
    ) : (
      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    )}
    <p className="font-body text-sm">{mensaje}</p>
  </div>
);
