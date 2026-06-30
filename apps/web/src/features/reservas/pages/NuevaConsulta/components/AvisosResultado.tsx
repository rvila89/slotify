import { AlertTriangle, CalendarCheck, CalendarX, CheckCircle2, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatearFecha, formatearFechaHora } from '../../../lib/fecha';
import type { ResultadoAlta } from '../../../model/types';

const claseAviso = 'flex items-start gap-3 rounded-[16px] border p-4';
const claseCerrar = 'rounded-full p-1 transition';

/**
 * Avisos del desenlace de un alta de consulta: 2b (fecha bloqueada), 2d (cola),
 * 2a (fecha no disponible) y el estado de la comunicación E1 (borrador con
 * comentarios vs auto-enviada). Cada aviso es cerrable vía `onCerrar`.
 */
export const AvisosResultado = ({
  resultado,
  onCerrar,
}: {
  resultado: ResultadoAlta;
  onCerrar: () => void;
}) => {
  const { reserva } = resultado;
  const tarifaTotal = reserva?.tarifaEstimada?.totalEur;

  return (
    <>
      {resultado.conFecha && reserva?.subEstado === '2b' && (
        <div
          role="status"
          data-testid="alerta-fecha-bloqueada"
          className={cn(claseAviso, 'border-emerald-200 bg-emerald-50 text-emerald-900')}
        >
          <CalendarCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">
              Consulta {reserva.codigo} creada — fecha reservada
            </p>
            <p className="font-body text-sm">
              La fecha <strong>{formatearFecha(resultado.fechaEnviada)}</strong> ha quedado{' '}
              <strong>bloqueada</strong> (bloqueo blando)
              {reserva.ttlExpiracion ? ` hasta el ${formatearFechaHora(reserva.ttlExpiracion)}` : ''}
              . Confírmala antes de que expire para no perder la reserva.
            </p>
            {typeof tarifaTotal === 'number' && (
              <p className="mt-1 font-body text-sm" data-testid="tarifa-estimada-importe">
                Se ha incluido una tarifa estimada de{' '}
                <strong>{tarifaTotal.toLocaleString('es-ES')} €</strong> en el email E1.
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onCerrar}
            className={cn(claseCerrar, 'text-emerald-700 hover:bg-emerald-100')}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {resultado.conFecha && reserva?.subEstado === '2d' && (
        <div
          role="status"
          data-testid="alerta-cola"
          className={cn(claseAviso, 'border-amber-200 bg-amber-50 text-amber-900')}
        >
          <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">Consulta {reserva.codigo} en cola de espera</p>
            <p className="font-body text-sm">
              La fecha <strong>{formatearFecha(resultado.fechaEnviada)}</strong> ya está ocupada por
              otra consulta. Tu consulta ha entrado en la cola en la{' '}
              <strong>posición {reserva.posicionCola}</strong>. Te avisaremos si la fecha se libera.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onCerrar}
            className={cn(claseCerrar, 'text-amber-700 hover:bg-amber-100')}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {resultado.conFecha && reserva?.subEstado === '2a' && (
        <div
          role="status"
          data-testid="alerta-fecha-no-disponible"
          className={cn(claseAviso, 'border-border-default bg-surface-muted text-text-primary')}
        >
          <CalendarX aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">
              Consulta {reserva.codigo} creada como exploratoria
            </p>
            <p className="font-body text-sm text-text-secondary">
              {reserva.avisoDisponibilidad ??
                `La fecha ${formatearFecha(resultado.fechaEnviada)} no está disponible.`}{' '}
              Hemos registrado la consulta sin fecha asignada; podrás proponer otra fecha más
              adelante.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onCerrar}
            className={cn(claseCerrar, 'text-text-secondary hover:bg-surface-subtle')}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {resultado.tieneComentarios && reserva && (
        <div
          role="alert"
          data-testid="alerta-e1-borrador"
          className={cn(claseAviso, 'border-amber-200 bg-amber-50 text-amber-900')}
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">
              {resultado.conFecha
                ? 'Borrador E1 pendiente de revisar'
                : `Consulta ${reserva.codigo} creada — borrador E1 pendiente`}
            </p>
            <p className="font-body text-sm">
              Como has añadido comentarios, el email de respuesta inicial (E1) ha quedado en{' '}
              <strong>borrador</strong> y <strong>no se ha enviado</strong>. Revísalo y confírmalo
              para enviarlo al cliente.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onCerrar}
            className={cn(claseCerrar, 'text-amber-700 hover:bg-amber-100')}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {!resultado.tieneComentarios && reserva && (
        <div
          role="status"
          data-testid="alerta-e1-enviado"
          className={cn(claseAviso, 'border-emerald-200 bg-emerald-50 text-emerald-900')}
        >
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">
              {resultado.conFecha ? 'Email E1 enviado automáticamente' : `Consulta ${reserva.codigo} creada`}
            </p>
            <p className="font-body text-sm">
              El email de respuesta inicial (E1) se ha <strong>enviado automáticamente</strong> al
              cliente.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onCerrar}
            className={cn(claseCerrar, 'text-emerald-700 hover:bg-emerald-100')}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </>
  );
};
