import {
  FacturaSenalCard,
  DocumentosLiquidacionFianza,
  DevolucionFianzaCard,
} from '@/features/facturacion';
import { FichaOperativaCard } from '@/features/ficha-operativa';
import { CondicionesFirmadasCard, debeMostrarSeccionCondiciones } from '@/features/condiciones-firmadas';
import { DocumentacionEventoCard, debeMostrarSeccionDocumentacion } from '@/features/documentacion-evento';
import { IbanDevolucionCard } from '../../../components/IbanDevolucionCard';
import { puedeRegistrarIban } from '../../../lib/ibanDevolucion';
import type { ReservaDetalle } from '../../../model/types';

/**
 * Secciones de la ficha condicionadas por el estado de la RESERVA, extraídas de
 * `FichaConsultaPage` para mantener la página bajo el límite de líneas (regla dura
 * `max-lines`). Cada tarjeta se monta según el estado/sub-proceso y resuelve
 * internamente su propia UI. Componente de presentación puro: no tiene estado.
 */
type Props = {
  reservaId: string;
  reserva: ReservaDetalle;
};

export const SeccionesFicha = ({ reservaId, reserva }: Props) => (
  <>
    {reserva.estado === 'reserva_confirmada' && <FacturaSenalCard reservaId={reservaId} />}

    {reserva.estado === 'reserva_confirmada' && (
      <DocumentosLiquidacionFianza
        reservaId={reservaId}
        liquidacionStatus={reserva.liquidacionStatus}
        fianzaStatus={reserva.fianzaStatus}
        fechaEvento={reserva.fechaEvento}
        fianzaEur={reserva.fianzaEur}
        fianzaCobradaFecha={reserva.fianzaCobradaFecha}
      />
    )}

    {/* Ficha operativa del evento (US-025): editable desde `reserva_confirmada`
        y fases posteriores. El propio componente resuelve el 409
        `ficha_no_disponible` mostrando el mensaje contextual. */}
    {(reserva.estado === 'reserva_confirmada' ||
      reserva.estado === 'evento_en_curso' ||
      reserva.estado === 'post_evento') && <FichaOperativaCard reservaId={reservaId} />}

    {/* US-024: registrar la firma de las condiciones particulares. Visible en los
        tres estados válidos del ciclo (`reserva_confirmada`, `evento_en_curso`,
        `post_evento`). La tarjeta resuelve internamente los estados de la UI:
        E3 no enviado (acción no disponible), pendiente de firma (alerta FA-01 +
        acción), firmada (resumen) y re-firma. El backend revalida (409/422). */}
    {debeMostrarSeccionCondiciones(reserva) && (
      <CondicionesFirmadasCard
        reservaId={reservaId}
        condPartFechaEnvio={reserva.condPartFechaEnvio}
        condPartFirmadas={reserva.condPartFirmadas}
        condPartFechaFirma={reserva.condPartFechaFirma}
      />
    )}

    {/* US-033: captura de la documentación obligatoria del evento (checklist en
        tiempo real: DNI anverso/reverso + cláusula de responsabilidad firmada).
        Visible en `evento_en_curso` (subida + checklist) y `post_evento`
        (checklist en lectura, para mostrar pendientes tras finalizar — FA-01). La
        tarjeta gobierna internamente si se puede subir (solo `evento_en_curso`) y
        el aviso informativo no bloqueante de documentación pendiente. */}
    {debeMostrarSeccionDocumentacion(reserva.estado) && (
      <DocumentacionEventoCard reservaId={reservaId} estado={reserva.estado} />
    )}

    {/* US-035: registrar el IBAN de devolución. Solo visible en `post_evento` con
        fianza cobrada (`fianzaEur > 0`) — FA-04; precarga el IBAN existente del
        cliente en corrección — FA-02. El backend revalida la precondición (409). */}
    {puedeRegistrarIban(reserva.estado, reserva.fianzaEur) && (
      <IbanDevolucionCard reservaId={reservaId} ibanExistente={reserva.cliente?.ibanDevolucion} />
    )}

    {/* US-036: registrar la devolución de la fianza. Visible en `post_evento` con fianza cobrada
        (`fianzaEur > 0`). La tarjeta habilita la acción solo cuando además hay IBAN de devolución
        (precondición triple), muestra el resumen final si ya está devuelta/retenida_parcial y el
        aviso de FA-04 si se registró sin justificante. El backend revalida (409). */}
    {reserva.estado === 'post_evento' &&
      puedeRegistrarIban(reserva.estado, reserva.fianzaEur) && (
        <DevolucionFianzaCard
          reservaId={reservaId}
          estado={reserva.estado}
          fianzaStatus={reserva.fianzaStatus}
          fianzaEur={reserva.fianzaEur}
          fianzaCobradaFecha={reserva.fianzaCobradaFecha}
          fianzaDevueltaEur={reserva.fianzaDevueltaEur}
          fianzaDevueltaFecha={reserva.fianzaDevueltaFecha}
          motivoRetencion={reserva.motivoRetencion}
          ibanDevolucion={reserva.cliente?.ibanDevolucion}
        />
      )}
  </>
);
