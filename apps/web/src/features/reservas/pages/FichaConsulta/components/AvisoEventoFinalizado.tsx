import { AlertTriangle, CheckCircle2, Mail, X } from 'lucide-react';
import { etiquetaDocumentacionPendiente } from '../../../lib/finalizarEvento';
import type { components } from '@/api-client';

type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];

/**
 * Aviso de desenlace de la acción "Marcar evento como finalizado" (US-034 · UC-25).
 * La transición a `post_evento` SIEMPRE ocurrió (el 200 la garantiza; la transición
 * y el envío de E5 son operaciones separadas, design.md §D-2). Este aviso confirma
 * el avance y ramifica según `e5.resultado`:
 *  - `enviado`: E5 (agradecimiento + solicitud de IBAN + NPS) enviado al cliente.
 *  - `fallido`: la reserva avanzó pero el email no pudo enviarse → alerta de reenvío
 *    (el botón de reenvío se DIFIERE a otra US; aquí solo el mensaje).
 *  - `no_aplica`: sin fianza que devolver → no se menciona E5.
 *
 * Además, si la respuesta trae `documentacionPendiente`, lo recuerda como aviso
 * informativo no bloqueante (subible en post-evento). Componente de presentación
 * puro, mobile-first (apila en columna; sin overflow horizontal).
 */
type Props = {
  resultado: FinalizarEventoResponse;
  onCerrar: () => void;
};

export const AvisoEventoFinalizado = ({ resultado, onCerrar }: Props) => {
  const e5 = resultado.e5.resultado;
  const pendientes = resultado.documentacionPendiente ?? [];
  const esFallido = e5 === 'fallido';

  const claseContenedor = esFallido
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <div
      role="status"
      data-testid="aviso-evento-finalizado"
      className={`flex items-start gap-3 rounded-[16px] border p-4 ${claseContenedor}`}
    >
      {esFallido ? (
        <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      ) : (
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      )}

      <div className="flex flex-1 flex-col gap-3 font-body text-sm">
        <p className="font-medium">
          Evento finalizado. La reserva ha pasado a <strong>post-evento</strong>.
        </p>

        {e5 === 'enviado' && (
          <p data-testid="e5-enviado" className="flex items-start gap-2">
            <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Se ha enviado al cliente el email de agradecimiento con la solicitud del IBAN para la
            devolución de la fianza y la encuesta de satisfacción (NPS).
          </p>
        )}

        {e5 === 'fallido' && (
          <p data-testid="e5-fallido" className="flex items-start gap-2 font-medium">
            <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
            La reserva ha pasado a post-evento, pero el email de solicitud del IBAN no pudo
            enviarse. Podrás reenviarlo desde la ficha.
          </p>
        )}

        {/* `no_aplica`: no había fianza que devolver → no se menciona E5. */}

        {pendientes.length > 0 && (
          <div
            data-testid="aviso-finalizado-documentacion"
            className="flex flex-col gap-1 rounded-[12px] border border-black/10 bg-black/5 p-3"
          >
            <p className="font-medium">Quedó documentación pendiente de subir:</p>
            <ul className="list-disc pl-5">
              {pendientes.map((item) => (
                <li key={item}>{etiquetaDocumentacionPendiente(item)}</li>
              ))}
            </ul>
            <p>Puedes completarla desde la ficha en post-evento.</p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar aviso"
        className="shrink-0 rounded-full p-1 transition hover:bg-black/5"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
};
