import { CheckCircle2, FileCheck2, Info } from 'lucide-react';
import { useChecklistDocumentacionEvento } from '../api/useChecklistDocumentacionEvento';
import { permiteSubirDocumentacion } from '../lib/estado';
import { ORDEN_TIPOS } from '../lib/fichero';
import { CLASE_SECCION } from '../lib/estilos';
import { ChecklistItemDocumento } from './ChecklistItemDocumento';

/**
 * Tarjeta de la ficha de la reserva para la **captura de la documentación
 * obligatoria del evento** (US-033 · UC-24, N5). Muestra un checklist en tiempo
 * real de los tres tipos obligatorios (DNI anverso, DNI reverso, cláusula de
 * responsabilidad firmada) con su estado ✅/pendiente y una acción de subida por
 * ítem.
 *
 * El montaje de la tarjeta lo decide `FichaConsultaPage` según el estado de la
 * reserva (`debeMostrarSeccionDocumentacion`): visible en `evento_en_curso`
 * (subida + checklist) y en `post_evento` (checklist en lectura). Solo se permite
 * SUBIR en `evento_en_curso` (`permiteSubirDocumentacion`); el backend revalida
 * (422 ESTADO_NO_PERMITE_DOCUMENTACION).
 *
 * La documentación incompleta se muestra como aviso **informativo, no bloqueante**
 * (FA-01, N4): no impide nada.
 *
 * Diseño: no hay frame propio en el archivo Figma "Slotify" para esta pantalla; se
 * ADAPTA con los tokens del proyecto (`index.css` + `DESIGN.md`), reutilizando el
 * patrón de tarjeta de sección de la ficha (`CondicionesFirmadasCard`, US-024).
 * Mobile-first: sin overflow horizontal; los ítems apilan en móvil; objetivos
 * táctiles ≥ 48px. Funciona en 390 / 768 / 1280.
 */
type Props = {
  reservaId: string;
  /** `RESERVA.estado` — determina si se puede subir (solo `evento_en_curso`). */
  estado: string | null | undefined;
};

export const DocumentacionEventoCard = ({ reservaId, estado }: Props) => {
  const { data, isLoading, isError } = useChecklistDocumentacionEvento(reservaId);
  const puedeSubir = permiteSubirDocumentacion(estado);

  const itemsPorTipo = new Map((data?.items ?? []).map((item) => [item.tipo, item]));
  const pendientes = ORDEN_TIPOS.filter((tipo) => !(itemsPorTipo.get(tipo)?.completado ?? false));
  const todosCompletos = data ? pendientes.length === 0 : false;

  return (
    <section className={CLASE_SECCION} aria-labelledby="ficha-documentacion-evento">
      <div id="ficha-documentacion-evento" className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <FileCheck2 aria-hidden className="size-4" />
        </span>
        <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
          Documentación del evento
        </h2>
      </div>

      <p className="font-body text-sm text-text-secondary">
        Captura la documentación legal obligatoria del evento (foto del DNI y cláusula de
        responsabilidad firmada). Puedes hacer la foto desde el móvil o subir un archivo.
      </p>

      {isLoading && (
        <p data-testid="documentacion-cargando" className="font-body text-sm text-text-secondary">
          Cargando checklist…
        </p>
      )}

      {isError && (
        <p
          role="alert"
          data-testid="documentacion-error"
          className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
        >
          No se ha podido cargar el checklist de documentación. Actualiza la ficha e inténtalo de
          nuevo.
        </p>
      )}

      {data && (
        <>
          {todosCompletos ? (
            <p
              role="status"
              data-testid="documentacion-completa"
              className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 font-body text-sm text-emerald-800"
            >
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              <span>
                <strong>Documentación completa.</strong> Los tres documentos obligatorios del
                evento están registrados.
              </span>
            </p>
          ) : (
            <p
              role="status"
              data-testid="documentacion-pendiente"
              className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-900"
            >
              <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <span>
                Quedan <strong>{pendientes.length}</strong>{' '}
                {pendientes.length === 1 ? 'documento pendiente' : 'documentos pendientes'}. Este
                aviso es informativo: la documentación incompleta no bloquea la finalización del
                evento.
              </span>
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {ORDEN_TIPOS.map((tipo) => (
              <ChecklistItemDocumento
                key={tipo}
                reservaId={reservaId}
                tipo={tipo}
                item={itemsPorTipo.get(tipo)}
                puedeSubir={puedeSubir}
              />
            ))}
          </ul>

          {!puedeSubir && (
            <p
              data-testid="documentacion-solo-lectura"
              className="font-body text-xs text-text-secondary"
            >
              La subida de documentos solo está disponible mientras el evento está en curso.
            </p>
          )}
        </>
      )}
    </section>
  );
};
