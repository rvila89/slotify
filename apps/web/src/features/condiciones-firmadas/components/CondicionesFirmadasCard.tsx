import { useState } from 'react';
import { notify } from '@/lib/notify';
import { CheckCircle2, FileSignature, Info, PenLine, RefreshCw } from 'lucide-react';
import {
  MENSAJE_CONDICIONES_NO_ENVIADAS,
  MENSAJE_FIRMA_PENDIENTE,
  condicionesEnviadas,
  condicionesFirmadas,
} from '../lib/estado';
import { formatearFechaHora } from '../lib/fecha';
import { RegistrarFirmaDialog } from './RegistrarFirmaDialog';

/**
 * Tarjeta de la ficha de la reserva para "Registrar condiciones firmadas"
 * (US-024 · UC-19, segundo flujo). Encapsula los cuatro estados de la UI:
 *  1. **E3 no enviado** (`condPartFechaEnvio` nulo): acción NO disponible; mensaje
 *     "Las condiciones particulares no han sido enviadas al cliente aún".
 *  2. **Pendiente de firma** (`condPartFirmadas=false`, E3 enviado): alerta
 *     informativa no bloqueante (FA-01) + acción "Registrar condiciones firmadas".
 *  3. **Firmada** (`condPartFirmadas=true`): resumen con la fecha `condPartFechaFirma`.
 *  4. **Re-firma**: desde el estado firmado se puede volver a subir una versión.
 *
 * El montaje de la tarjeta lo decide `FichaConsultaPage` (solo en los estados válidos
 * del ciclo: reserva_confirmada / evento_en_curso / post_evento). El backend revalida
 * (409 CONDICIONES_NO_ENVIADAS / 422 ESTADO_INVALIDO). Mobile-first: sin overflow
 * horizontal, botón `w-full` en móvil y `sm:w-auto`, objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  /** `RESERVA.condPartFechaEnvio` — E3 enviado (US-023) si no es nulo. */
  condPartFechaEnvio?: string | null;
  /** `RESERVA.condPartFirmadas` — copia firmada ya registrada. */
  condPartFirmadas?: boolean | null;
  /** `RESERVA.condPartFechaFirma` — timestamp del registro de la firma. */
  condPartFechaFirma?: string | null;
};

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted sm:w-auto';

export const CondicionesFirmadasCard = ({
  reservaId,
  condPartFechaEnvio,
  condPartFirmadas,
  condPartFechaFirma,
}: Props) => {
  const [abierto, setAbierto] = useState(false);

  const enviadas = condicionesEnviadas({ condPartFechaEnvio });
  const firmadas = condicionesFirmadas({ condPartFirmadas });

  return (
    <section className={claseSeccion} aria-labelledby="ficha-condiciones-firmadas">
      <div id="ficha-condiciones-firmadas" className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <FileSignature aria-hidden className="size-4" />
        </span>
        <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
          Firma de condiciones particulares
        </h2>
      </div>

      {!enviadas ? (
        <p
          role="status"
          data-testid="condiciones-no-enviadas"
          className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-900"
        >
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          {MENSAJE_CONDICIONES_NO_ENVIADAS}. Completa primero el envío de las condiciones al
          cliente (E3).
        </p>
      ) : firmadas ? (
        <>
          <p
            role="status"
            data-testid="condiciones-firmadas-resumen"
            className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 font-body text-sm text-emerald-800"
          >
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <span>
              Condiciones particulares <strong>firmadas</strong>
              {condPartFechaFirma && (
                <>
                  {' '}
                  el <strong>{formatearFechaHora(condPartFechaFirma)}</strong>
                </>
              )}
              . La copia firmada queda registrada en la reserva.
            </span>
          </p>

          <p className="font-body text-sm text-text-secondary">
            Si dispones de una versión más legible del documento, puedes volver a subirla. Se
            conservará el histórico y la más reciente será la de referencia.
          </p>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setAbierto(true)}
              data-testid="accion-refirmar-condiciones"
              className={claseBotonSecundario}
            >
              <RefreshCw aria-hidden className="size-5" />
              Subir nueva versión firmada
            </button>
          </div>
        </>
      ) : (
        <>
          <p
            role="status"
            data-testid="alerta-firma-pendiente"
            className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-900"
          >
            <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <span>
              <strong>{MENSAJE_FIRMA_PENDIENTE}</strong>. Registra la copia firmada por el
              cliente cuando la recibas.
            </span>
          </p>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setAbierto(true)}
              data-testid="accion-registrar-firma-condiciones"
              className={claseBotonPrimario}
            >
              <PenLine aria-hidden className="size-5" />
              Registrar condiciones firmadas
            </button>
          </div>
        </>
      )}

      {enviadas && (
        <RegistrarFirmaDialog
          reservaId={reservaId}
          yaFirmada={firmadas}
          abierto={abierto}
          onAbiertoChange={setAbierto}
          onRegistrado={() =>
            notify.success(
              firmadas
                ? 'Nueva versión de las condiciones firmadas registrada.'
                : 'Firma de condiciones particulares registrada correctamente.',
            )
          }
        />
      )}
    </section>
  );
};
