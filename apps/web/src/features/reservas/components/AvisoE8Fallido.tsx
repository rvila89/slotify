import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Alerta de FA-03 (US-035): el IBAN quedó guardado pero el email E8 (confirmación de
 * recepción del IBAN) no pudo enviarse (`COMUNICACION.estado='fallido'`). El fallo de
 * E8 NO revierte el IBAN (patrón guardar-luego-enviar, design.md §D-2). Ofrece un
 * botón de reenvío que reintenta la misma mutación (reenvía E8 al `CLIENTE.email`
 * apoyándose en el mecanismo de reintento del motor de `comunicaciones`).
 *
 * Presentacional puro, mobile-first: apila en columna; el botón ocupa el ancho
 * completo en móvil (`w-full`) y se ajusta al contenido en `sm:`. Objetivo táctil
 * ≥ 48px (`h-12`). Diseño ADAPTADO con los tokens del proyecto (no hay frame Figma).
 */
type Props = {
  mensaje: string;
  reenviando: boolean;
  onReenviar: () => void;
};

const claseBotonReenviar =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-amber-300 bg-white px-6 font-body text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const AvisoE8Fallido = ({ mensaje, reenviando, onReenviar }: Props) => (
  <div
    role="alert"
    data-testid="aviso-e8-fallido"
    className="flex flex-col gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-800"
  >
    <div className="flex items-start gap-3">
      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      <p className="font-body text-sm">{mensaje}</p>
    </div>
    <button
      type="button"
      onClick={onReenviar}
      disabled={reenviando}
      data-testid="boton-reenviar-e8"
      className={claseBotonReenviar}
    >
      <RefreshCw aria-hidden className={`size-4 ${reenviando ? 'animate-spin' : ''}`} />
      {reenviando ? 'Reenviando…' : 'Reenviar email de confirmación'}
    </button>
  </div>
);
