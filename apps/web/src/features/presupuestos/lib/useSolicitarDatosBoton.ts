import { useEffect, useState } from 'react';
import { useSolicitarDatosPresupuesto } from '../api/useSolicitarDatosPresupuesto';

/**
 * Estado del botón "Solicitar datos al cliente" del modal de presupuesto (change
 * solicitud-datos-presupuesto-borrador): encapsula la mutación
 * `useSolicitarDatosPresupuesto`, el aviso inline de error (409/422 sin cerrar el modal)
 * y su reinicio al cerrar/reabrir, para no engordar `GenerarPresupuestoDialog`
 * (regla dura `max-lines`).
 *
 * En éxito (200/201) invoca `onExito` (el padre cierra el modal + banner + scroll); en
 * error fija `aviso` y NO cierra.
 */
export const useSolicitarDatosBoton = (
  reservaId: string,
  abierto: boolean,
  onExito: () => void,
) => {
  const solicitar = useSolicitarDatosPresupuesto();
  const [aviso, setAviso] = useState<string | null>(null);
  const { reset } = solicitar;

  useEffect(() => {
    if (!abierto) {
      reset();
      setAviso(null);
    }
  }, [abierto, reset]);

  const solicitarDatos = () => {
    setAviso(null);
    solicitar.mutate(
      { id: reservaId },
      { onSuccess: onExito, onError: (err) => setAviso(err.mensaje) },
    );
  };

  return { solicitarDatos, aviso, cargando: solicitar.isPending };
};
