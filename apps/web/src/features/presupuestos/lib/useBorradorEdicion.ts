import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreviewEdicionPresupuesto } from '../api/usePreviewEdicionPresupuesto';
import type {
  DuracionHorasEdicion,
  EdicionExtraInput,
  EdicionPresupuestoPreviewRequest,
  MetodoPago,
} from '../model/types';

/**
 * Campos de la edición que provienen del formulario (React Hook Form + Zod): nº de
 * invitados, duración, descuento (+ motivo), precio manual y método de pago. Aquí
 * solo se observan (`watch`) para recalcular el preview; la validación vive en el
 * diálogo. Las cantidades de extras, dinámicas por naturaleza (extraId → cantidad),
 * se gestionan como estado local del hook (fuera de RHF), igual que en US-014.
 */
type CamposFormulario = {
  numInvitados: string;
  duracionHoras: string;
  descuento: string;
  precioManual: string;
  metodoPago: MetodoPago;
};

const aEntero = (valor: string): number | undefined => {
  const t = valor.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

const DURACIONES_VALIDAS: readonly DuracionHorasEdicion[] = [4, 8, 12];

const esDuracionValida = (n?: number): n is DuracionHorasEdicion =>
  n === 4 || n === 8 || n === 12;

/**
 * Estado editable del borrador de EDICIÓN del presupuesto (US-015 · UC-15) y
 * orquestación del `preview` (no persiste). Centraliza la lógica del diálogo para
 * mantener el componente de UI por debajo del límite de 300 líneas (regla dura):
 *  - mantiene el mapa de cantidades de extras (fuera de RHF por dinámico), sembrado
 *    la primera vez con las líneas `RESERVA_EXTRA` existentes del preview inicial;
 *  - construye el `EdicionPresupuestoPreviewRequest` (extras con cantidad > 0, el
 *    server congela el `precioUnitario`; el body NO dicta el precio);
 *  - re-lanza el preview con debounce cuando cambia cualquier entrada;
 *  - expone el resultado del preview y su error normalizado.
 */
export const useBorradorEdicion = (
  reservaId: string,
  abierto: boolean,
  { numInvitados, duracionHoras, descuento, precioManual, metodoPago }: CamposFormulario,
) => {
  const preview = usePreviewEdicionPresupuesto();
  const { mutate: lanzarPreview, reset: resetPreview } = preview;

  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  // Solo se siembran las cantidades desde `lineasExtras` una vez (primer preview con
  // éxito); después las manda el gestor. Evita pisar sus ediciones en cada recálculo.
  const sembrado = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cambiarCantidad = useCallback((extraId: string, cantidad: number) => {
    setCantidades((prev) => ({ ...prev, [extraId]: cantidad }));
  }, []);

  const extrasInput = useMemo<EdicionExtraInput[]>(
    () =>
      Object.entries(cantidades)
        .filter(([, cantidad]) => cantidad > 0)
        .map(([extraId, cantidad]) => ({ extraId, cantidad })),
    [cantidades],
  );

  const construirBody = useCallback((): EdicionPresupuestoPreviewRequest => {
    const body: EdicionPresupuestoPreviewRequest = { metodoPago, extras: extrasInput };

    const invitados = aEntero(numInvitados);
    if (invitados !== undefined) body.numAdultosNinosMayores4 = invitados;

    const duracion = aEntero(duracionHoras);
    if (esDuracionValida(duracion)) body.duracionHoras = duracion;

    if (descuento.trim() !== '' && Number(descuento) > 0) body.descuentoEur = descuento;
    if (precioManual.trim() !== '' && Number(precioManual) > 0) body.precioManualEur = precioManual;

    return body;
  }, [extrasInput, numInvitados, duracionHoras, descuento, precioManual, metodoPago]);

  // Recalcula el borrador (preview) al abrir y ante cualquier cambio, con debounce
  // para no saturar el motor de tarifa mientras se teclea.
  useEffect(() => {
    if (!abierto) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      lanzarPreview(
        { id: reservaId, body: construirBody() },
        {
          onSuccess: (data) => {
            if (sembrado.current) return;
            sembrado.current = true;
            const inicial: Record<string, number> = {};
            for (const linea of data.lineasExtras ?? []) {
              if (linea.extraId) inicial[linea.extraId] = linea.cantidad ?? 0;
            }
            if (Object.keys(inicial).length > 0) setCantidades(inicial);
          },
        },
      );
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [abierto, reservaId, construirBody, lanzarPreview]);

  // Al cerrar, descarta el borrador (sin persistencia) y reinicia el sembrado.
  useEffect(() => {
    if (!abierto) {
      resetPreview();
      setCantidades({});
      sembrado.current = false;
    }
  }, [abierto, resetPreview]);

  return { cantidades, cambiarCantidad, extrasInput, preview, DURACIONES_VALIDAS };
};
