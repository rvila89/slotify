import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreviewPresupuesto } from '../api/usePreviewPresupuesto';
import type { PresupuestoExtraInput, PreviewPresupuestoRequest } from '../model/types';

/**
 * Entradas del borrador que provienen del formulario (React Hook Form): el precio
 * manual se valida con Zod en el diálogo y aquí solo se observa (`watch`) para
 * recalcular el preview. Los extras, en cambio, son un mapa dinámico (extraId →
 * cantidad) que no encaja en un campo de formulario clásico, así que se gestionan
 * como estado local de este hook.
 */
type CamposFormulario = {
  precioManual: string;
};

/**
 * Estado editable del borrador de presupuesto (US-014 §5.2) y orquestación del
 * `preview` (no persiste). Centraliza la lógica del diálogo para mantener el
 * componente de UI por debajo del límite de 300 líneas:
 *  - mantiene el mapa de cantidades de extras (fuera de RHF por ser dinámico);
 *  - recibe el precio manual ya validado desde el formulario (RHF + Zod);
 *  - construye el `PreviewPresupuestoRequest` (extras con cantidad > 0);
 *  - re-lanza el preview con un pequeño debounce cuando cambia cualquier entrada;
 *  - expone el resultado del preview y su error normalizado.
 *
 * El precio manual solo es relevante cuando `tarifaAConsultar=true`; en el caso
 * normal el backend lo ignora, pero se sigue recalculando el preview para reflejar
 * los extras.
 */
export const useBorradorPresupuesto = (
  reservaId: string,
  abierto: boolean,
  { precioManual }: CamposFormulario,
) => {
  const preview = usePreviewPresupuesto();
  const { mutate: lanzarPreview, reset: resetPreview } = preview;

  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cambiarCantidad = useCallback((extraId: string, cantidad: number) => {
    setCantidades((prev) => ({ ...prev, [extraId]: cantidad }));
  }, []);

  const reiniciarExtras = useCallback(() => {
    setCantidades({});
  }, []);

  const extrasInput = useMemo<PresupuestoExtraInput[]>(
    () =>
      Object.entries(cantidades)
        .filter(([, cantidad]) => cantidad > 0)
        .map(([extra_id, cantidad]) => ({ extra_id, cantidad })),
    [cantidades],
  );

  const construirBody = useCallback((): PreviewPresupuestoRequest => {
    const body: PreviewPresupuestoRequest = { extras: extrasInput };
    if (precioManual.trim() !== '' && Number(precioManual) > 0) body.precioManualEur = precioManual;
    return body;
  }, [extrasInput, precioManual]);

  // Recalcula el borrador (preview) al abrir y ante cualquier cambio de entrada,
  // con un pequeño debounce para no saturar el motor de tarifa mientras se teclea.
  useEffect(() => {
    if (!abierto) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      lanzarPreview({ id: reservaId, body: construirBody() });
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [abierto, reservaId, construirBody, lanzarPreview]);

  // Al cerrar, descarta el borrador (FA-03: sin efecto, sin persistencia). El reset
  // de los campos del formulario lo hace el diálogo (dueño del `useForm`).
  useEffect(() => {
    if (!abierto) {
      resetPreview();
      setCantidades({});
    }
  }, [abierto, resetPreview]);

  return {
    cantidades,
    cambiarCantidad,
    reiniciarExtras,
    extrasInput,
    preview,
  };
};
