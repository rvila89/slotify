import { useMemo, useState } from 'react';
import { useCalendario } from '../api/useCalendario';
import { aEventos } from '../lib/eventos';
import { rangoDeVista } from '../lib/fecha';
import type { VistaCalendario } from '../model/types';
import { CalendarioBoard } from '../components/CalendarioBoard';
import { Leyenda } from '../components/Leyenda';

import 'react-big-calendar/lib/css/react-big-calendar.css';
import '../components/calendario.css';

/**
 * Página de Calendario de Disponibilidad (US-039, UC-29). Es la PÁGINA DE INICIO
 * del App Shell autenticado (sidebar → primera opción, ruta `/calendario`).
 *
 * - El rango `[desde, hasta]` lo calcula el frontend según la vista y el período
 *   activo (design §D-1); el backend solo agrega sobre ese rango.
 * - El `tenant_id` viaja en el JWT, nunca por query (US-039 §Aislamiento).
 * - Mes vacío → calendario navegable sin errores (US-039 §Mes sin reservas).
 * - El popover de detalle reutiliza los datos de la misma respuesta (sin 2ª
 *   llamada): la transformación a eventos lleva la `fuente` agregada.
 */
export const CalendarioPage = () => {
  const [fecha, setFecha] = useState<Date>(() => new Date());
  const [vista, setVista] = useState<VistaCalendario>('mes');

  const rango = useMemo(() => rangoDeVista(fecha, vista), [fecha, vista]);
  const { data, isLoading, isError, refetch } = useCalendario(rango, vista);

  const eventos = useMemo(() => aEventos(data?.fechas ?? []), [data]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-medium text-text-primary">Calendario de disponibilidad</h1>
        <Leyenda />
      </header>

      {isError ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border border-border-default bg-surface-muted p-6 font-body text-sm text-text-secondary"
        >
          <p>No se ha podido cargar el calendario.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-full bg-brand-primary px-4 py-2 font-semibold text-brand-foreground transition-opacity hover:opacity-90"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className="relative rounded-lg border border-border-default bg-canvas p-2 sm:p-4">
          {isLoading ? (
            <p className="absolute right-4 top-4 z-10 font-body text-xs text-text-secondary" aria-live="polite">
              Cargando…
            </p>
          ) : null}
          <CalendarioBoard
            eventos={eventos}
            fecha={fecha}
            vista={vista}
            onNavigate={setFecha}
            onVista={setVista}
          />
        </div>
      )}
    </section>
  );
};
