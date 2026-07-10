import { useState } from 'react';
import { Info, RotateCcw } from 'lucide-react';
import { formatearEuros } from '../lib/dinero';
import { devolucionYaRegistrada, puedeRegistrarDevolucion } from '../lib/devolucionFianza';
import { toastLiquidacionExito } from '../lib/toastLiquidacion';
import { RegistrarDevolucionFianzaDialog } from './RegistrarDevolucionFianzaDialog';
import { FianzaDevueltaResumen } from './FianzaDevueltaResumen';
import type { FianzaStatus } from '../model/types';
import type { components } from '@/api-client';

type EstadoReserva = components['schemas']['EstadoReserva'];

/**
 * Tarjeta de la ficha de post-evento para "Registrar devolución de fianza" (US-036 · UC-27). Acción
 * simétrica inversa del cobro de fianza de US-030. Solo se ofrece cuando la precondición triple se
 * cumple: `estado = 'post_evento'` **Y** `fianzaStatus = 'cobrada'` **Y** `ibanDevolucion` presente.
 *
 * - Si la fianza ya está `devuelta`/`retenida_parcial`: la acción se oculta y se muestra el resumen
 *   final (`FianzaDevueltaResumen`) — la devolución es irreversible.
 * - Si falta el IBAN (aún en `cobrada`): mensaje guía para registrarlo primero (US-035).
 * - FA-04: al registrar sin justificante, la respuesta trae `avisoSinJustificante=true` y se muestra
 *   el aviso "Devolución registrada sin justificante. Puedes adjuntarlo más tarde…".
 *
 * El montaje de la tarjeta lo decide `FichaConsultaPage` (solo en `post_evento` con fianza cobrada);
 * el backend revalida la precondición (409 `PRECONDICION_NO_CUMPLIDA`). Mobile-first: sin overflow
 * horizontal, botón `w-full` en móvil y `sm:w-auto`, objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  estado: EstadoReserva;
  fianzaStatus?: FianzaStatus;
  /** Fianza cobrada (`RESERVA.fianzaEur`) — tope e indicador completa/parcial. */
  fianzaEur?: string | null;
  /** Fecha de cobro de la fianza (`RESERVA.fianzaCobradaFecha`) — mínimo de la fecha de devolución. */
  fianzaCobradaFecha?: string | null;
  /** Importe devuelto (`RESERVA.fianzaDevueltaEur`) — para el resumen del estado final. */
  fianzaDevueltaEur?: string | null;
  /** Fecha de la devolución (`RESERVA.fianzaDevueltaFecha`) — para el resumen. */
  fianzaDevueltaFecha?: string | null;
  /** Motivo de la retención (`RESERVA.motivoRetencion`) — solo en `retenida_parcial`. */
  motivoRetencion?: string | null;
  /** IBAN de devolución del CLIENTE; precondición de disponibilidad (US-035). */
  ibanDevolucion?: string | null;
};

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const DevolucionFianzaCard = ({
  reservaId,
  estado,
  fianzaStatus,
  fianzaEur,
  fianzaCobradaFecha,
  fianzaDevueltaEur,
  fianzaDevueltaFecha,
  motivoRetencion,
  ibanDevolucion,
}: Props) => {
  const [abierto, setAbierto] = useState(false);
  const [avisoSinJustificante, setAvisoSinJustificante] = useState(false);

  const yaRegistrada = devolucionYaRegistrada(fianzaStatus);
  const habilitada = puedeRegistrarDevolucion(estado, fianzaStatus, ibanDevolucion);
  const faltaIban = !yaRegistrada && fianzaStatus === 'cobrada' && !ibanDevolucion?.trim();

  return (
    <section className={claseSeccion} aria-labelledby="ficha-devolucion-fianza">
      <div id="ficha-devolucion-fianza" className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <RotateCcw aria-hidden className="size-4" />
        </span>
        <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
          Devolución de la fianza
        </h2>
      </div>

      {yaRegistrada && fianzaStatus ? (
        <FianzaDevueltaResumen
          fianzaStatus={fianzaStatus}
          fianzaDevueltaEur={fianzaDevueltaEur}
          fianzaDevueltaFecha={fianzaDevueltaFecha}
          motivoRetencion={motivoRetencion}
          avisoSinJustificante={avisoSinJustificante}
        />
      ) : (
        <>
          <p className="font-body text-sm text-text-secondary">
            Registra la transferencia de devolución de la fianza (
            {formatearEuros(fianzaEur)} cobrada) que ya has realizado al cliente. Podrás indicar una
            devolución completa o parcial y adjuntar el justificante.
          </p>

          {faltaIban && (
            <p
              role="status"
              data-testid="devolucion-falta-iban"
              className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-900"
            >
              <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
              Registra primero el IBAN de devolución del cliente para poder registrar la devolución
              de la fianza.
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setAbierto(true)}
              disabled={!habilitada}
              data-testid="accion-registrar-devolucion-fianza"
              className={claseBotonPrimario}
            >
              <RotateCcw aria-hidden className="size-5" />
              Registrar devolución de fianza
            </button>
          </div>

          <RegistrarDevolucionFianzaDialog
            reservaId={reservaId}
            fianzaEur={fianzaEur}
            fianzaCobradaFecha={fianzaCobradaFecha}
            abierto={abierto}
            onAbiertoChange={setAbierto}
            onRegistrado={(respuesta) => {
              setAvisoSinJustificante(respuesta.avisoSinJustificante);
              toastLiquidacionExito(
                respuesta.avisoSinJustificante
                  ? 'Devolución de fianza registrada sin justificante.'
                  : 'Devolución de fianza registrada correctamente.',
              );
            }}
          />
        </>
      )}
    </section>
  );
};
