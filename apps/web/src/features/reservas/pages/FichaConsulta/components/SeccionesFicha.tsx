import {
  FacturaSenalCard,
  FacturaLiquidacionCard,
  FianzaComprobanteCard,
} from '@/features/facturacion';
import { FichaOperativaCard } from '@/features/ficha-operativa';
import { ComunicacionesCard } from '@/features/comunicaciones';
import { CondicionesFirmadasCard, debeMostrarSeccionCondiciones } from '@/features/condiciones-firmadas';
import { DocumentacionEventoCard, debeMostrarSeccionDocumentacion } from '@/features/documentacion-evento';
import type { ReservaDetalle } from '../../../model/types';

/**
 * Secciones de la ficha condicionadas por el estado de la RESERVA, extraídas de
 * `FichaConsultaPage` para mantener la página bajo el límite de líneas (regla dura
 * `max-lines`). Cada tarjeta se monta según el estado/sub-proceso y resuelve
 * internamente su propia UI. Componente de presentación puro: no tiene estado.
 *
 * Orden (fix-liquidacion-fianza-independientes): señal → liquidación (debajo) → ficha
 * operativa → condiciones → fianza (comprobante + devolución) → comunicaciones →
 * documentación del evento.
 */
type Props = {
  reservaId: string;
  reserva: ReservaDetalle;
  /** Éxito de envío manual del borrador E1: la página muestra el aviso arriba + scroll. */
  onEmailEnviado?: () => void;
  /** Éxito de registro de la firma de condicions particulars (Mejora C): la página
      muestra el banner inline arriba + scroll, en lugar del toast de Sonner. */
  onFirmaRegistrada?: (tipo: 'registrada' | 'reregistrada') => void;
  /** Éxito de envío de la factura de señal (E3): la página muestra el banner arriba + scroll. */
  onFacturaSenalEnviada?: () => void;
  /** Éxito de envío de la factura de liquidación (E4): la página muestra el banner arriba + scroll. */
  onFacturaLiquidacionEnviada?: () => void;
};

export const SeccionesFicha = ({
  reservaId,
  reserva,
  onEmailEnviado,
  onFirmaRegistrada,
  onFacturaSenalEnviada,
  onFacturaLiquidacionEnviada,
}: Props) => (
  <>
    {/* US-022: Factura de señal — primera sección en `reserva_confirmada`.
        Visible solo en ese estado; las fases posteriores no la repiten. */}
    {reserva.estado === 'reserva_confirmada' && (
      <FacturaSenalCard reservaId={reservaId} onEnviada={onFacturaSenalEnviada} />
    )}

    {/* US-028: Factura de liquidación — standalone, DEBAJO de la de señal, con la misma
        regla de visibilidad (`reserva_confirmada`). Flujo espejo de la señal. */}
    {reserva.estado === 'reserva_confirmada' && (
      <FacturaLiquidacionCard reservaId={reservaId} onEnviada={onFacturaLiquidacionEnviada} />
    )}

    {/* Ficha operativa del evento (US-025): editable desde `reserva_confirmada`
        y fases posteriores. El propio componente resuelve el 409
        `ficha_no_disponible` mostrando el mensaje contextual. */}
    {(reserva.estado === 'reserva_confirmada' ||
      reserva.estado === 'evento_en_curso' ||
      reserva.estado === 'post_evento') && <FichaOperativaCard reservaId={reservaId} />}

    {/* US-024: registrar la firma de las condiciones particulares. Visible en los
        tres estados válidos del ciclo (`reserva_confirmada`, `evento_en_curso`,
        `post_evento`). El backend revalida (409/422). */}
    {debeMostrarSeccionCondiciones(reserva) && (
      <CondicionesFirmadasCard
        reservaId={reservaId}
        condPartFechaEnvio={reserva.condPartFechaEnvio}
        condPartFirmadas={reserva.condPartFirmadas}
        condPartFechaFirma={reserva.condPartFechaFirma}
        onRegistrado={onFirmaRegistrada}
      />
    )}

    {/* Fianza pasiva (fix-liquidacion-fianza-independientes): subida del comprobante
        (opcional, no bloqueante) y, en `post_evento`, la acción "Devolver fianza".
        Montada de `reserva_confirmada` a `post_evento`. */}
    {(reserva.estado === 'reserva_confirmada' ||
      reserva.estado === 'evento_en_curso' ||
      reserva.estado === 'post_evento') && (
      <FianzaComprobanteCard
        reservaId={reservaId}
        estado={reserva.estado}
        fianzaStatus={reserva.fianzaStatus}
        fianzaEur={reserva.fianzaEur}
        fianzaComprobanteFecha={reserva.fianzaComprobanteFecha}
        fianzaDevueltaFecha={reserva.fianzaDevueltaFecha}
      />
    )}

    {/* US-046 · UC-36: sección "Comunicaciones" de la ficha. Visible en TODA RESERVA. */}
    <ComunicacionesCard reservaId={reservaId} onEmailEnviado={onEmailEnviado} />

    {/* US-033: captura de la documentación obligatoria del evento (checklist en
        tiempo real). Visible en `evento_en_curso` (subida + checklist) y
        `post_evento` (checklist en lectura). */}
    {debeMostrarSeccionDocumentacion(reserva.estado) && (
      <DocumentacionEventoCard reservaId={reservaId} estado={reserva.estado} />
    )}
  </>
);
