import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSession } from '@/features/auth';
import { useColaEspera, ColaEsperaError } from '../api/useColaEspera';
import { SeccionBloqueante } from '../components/SeccionBloqueante';
import { SeccionCola } from '../components/SeccionCola';
import { ColaCargando, ColaError, FechaDisponible } from '../components/EstadosCola';
import { PromoverManualDialog } from '../components/PromoverManualDialog';
import type { ColaItem } from '../model/types';

/** Roles autorizados a promover manualmente una consulta de la cola (US-019). */
const ROLES_PROMOTORES = new Set(['gestor', 'admin']);

/**
 * Vista de la cola de espera de una fecha (US-017 · UC-11) con la acción de
 * promoción manual del Gestor (US-019 · UC-12 flujo alternativo manual).
 * Destino del clic en el indicador `🔁 N en cola` del calendario (US-039), que
 * navega aquí con el `reservaId` de la bloqueante. Proyecta dos secciones
 * (bloqueante + cola FIFO) desde `GET /reservas/{id}/cola`.
 *
 * Ramas de estado (según contrato/spec):
 *  - 404 → "Cola no encontrada" (reserva inexistente / otro tenant bajo RLS).
 *  - 200 `estaBloqueada: false` (FA-04) → "Fecha disponible", sin secciones.
 *  - 200 con `bloqueante` → sección bloqueante + cola (FA-01 cola vacía incluida).
 *
 * US-019: si el usuario tiene rol Gestor/Admin, cada consulta de la cola ofrece
 * "Promover a bloqueante". La acción es DESTRUCTIVA (expira la bloqueante actual), así
 * que abre un diálogo de confirmación explícito; solo al confirmar se dispara
 * `POST /reservas/{id}/promover` con `{ confirmado: true }`. Tras el 200, la query de
 * la cola se invalida (hook) y la vista se re-lee con la nueva bloqueante y la cola
 * reordenada. Un 409 (carrera perdida contra la promoción automática, D-4) muestra
 * "La cola ya fue actualizada automáticamente…" y también recarga la vista.
 *
 * Responsive mobile-first: contenido en columna, cortes en `sm:`/`lg:`, sin
 * anchos fijos que rompan en 390px (max-w centrado, sin overflow horizontal).
 */
export const ColaEsperaPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useColaEspera(id);
  const sesion = useSession();

  const [seleccionada, setSeleccionada] = useState<ColaItem | null>(null);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);

  const noEncontrada = error instanceof ColaEsperaError && error.noEncontrada;
  const puedePromover =
    sesion.status === 'authenticated' && ROLES_PROMOTORES.has(sesion.user.rol ?? '');

  const abrirPromocion = (item: ColaItem) => {
    setSeleccionada(item);
    setDialogoAbierto(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          to="/calendario"
          className="inline-flex w-fit items-center gap-1.5 font-body text-xs font-semibold text-text-secondary transition-colors hover:text-brand-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Volver al calendario
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          Cola de espera
        </h1>
        <p className="font-body text-sm text-text-secondary sm:text-base">
          Consulta bloqueante de la fecha y consultas en espera, ordenadas por posición.
        </p>
      </header>

      {isLoading ? (
        <ColaCargando />
      ) : error ? (
        <ColaError noEncontrada={noEncontrada} />
      ) : !data || !data.estaBloqueada || !data.bloqueante ? (
        <FechaDisponible />
      ) : (
        <>
          <SeccionBloqueante bloqueante={data.bloqueante} />
          <SeccionCola cola={data.cola} onPromover={puedePromover ? abrirPromocion : undefined} />
          {puedePromover && id ? (
            <PromoverManualDialog
              seleccionada={seleccionada}
              bloqueanteId={id}
              bloqueanteNombre={data.bloqueante.clienteNombre}
              abierto={dialogoAbierto}
              onAbiertoChange={setDialogoAbierto}
            />
          ) : null}
        </>
      )}
    </div>
  );
};
