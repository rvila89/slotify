import { CheckCircle2, X } from 'lucide-react';
import { formatearEuros } from '../lib/dinero';
import type { EdicionPresupuestoResponse, ReenviarPresupuestoResponse } from '../model/types';

/**
 * Aviso de éxito tras editar o reenviar el presupuesto (US-015 · UC-15). Cubre los
 * tres desenlaces:
 *  - **Edición enviada** (`enviar=true`): nueva versión `enviado`, email E2 al cliente.
 *  - **Borrador guardado** (`enviar=false`): nueva versión `borrador`, sin email.
 *  - **Reenvío sin cambios**: misma versión, se ha reenviado el PDF por email.
 * La RESERVA permanece en `pre_reserva` (el bloqueo no se extiende). Componente de
 * presentación puro.
 *
 * Mobile-first: bloque `flex` con texto que fluye; el botón de cerrar queda a la
 * derecha sin romper en 390px.
 */
type Props = {
  resultado:
    | { clase: 'edicion'; datos: EdicionPresupuestoResponse }
    | { clase: 'reenvio'; datos: ReenviarPresupuestoResponse };
  onCerrar: () => void;
};

export const AvisoPresupuestoEditado = ({ resultado, onCerrar }: Props) => {
  const presupuesto = resultado.datos.presupuesto;
  const enviado = presupuesto.estado === 'enviado';
  const version = presupuesto.version;
  const total = presupuesto.total;
  const pdfUrl = presupuesto.pdfUrl;

  const mensajePrincipal =
    resultado.clase === 'reenvio'
      ? 'Presupuesto reenviado al cliente sin cambios. Se ha registrado el reenvío por email.'
      : enviado
        ? 'Presupuesto actualizado y enviado al cliente. La versión anterior se conserva como historial.'
        : 'Borrador del presupuesto guardado. No se ha enviado nada al cliente todavía.';

  return (
    <div
      role="status"
      data-testid="aviso-presupuesto-editado"
      data-clase={resultado.clase}
      className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"
    >
      <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      <div className="flex flex-1 flex-col gap-2 font-body text-sm">
        <p className="font-medium">{mensajePrincipal}</p>
        <p>
          {typeof version === 'number' && (
            <>
              Versión <strong>{version}</strong>
              {presupuesto.numeroPresupuesto ? ` · nº ${presupuesto.numeroPresupuesto}` : ''}.{' '}
            </>
          )}
          Total: <strong>{formatearEuros(total)}</strong>.
        </p>
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-emerald-700 underline"
          >
            Ver el PDF del presupuesto
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar aviso"
        className="shrink-0 rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
};
