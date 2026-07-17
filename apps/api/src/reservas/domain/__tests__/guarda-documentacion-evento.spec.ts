/**
 * TESTS de la GUARDA DE PRECONDICIÓN de estado de la documentación del evento
 * (US-033 / UC-24) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-033 §Reglas de negocio ("Solo disponible cuando
 * `RESERVA.estado = evento_en_curso`"); spec-delta `documentacion-evento`
 * (Requirement "Guarda de estado — la documentación del evento solo se captura en
 * evento_en_curso"); design.md §D-no-transicion. La SUBIDA (escritura) solo se
 * admite en `evento_en_curso` (guarda ESTRICTA mono-estado, a diferencia de US-024
 * que admite `{reserva_confirmada, evento_en_curso, post_evento}`). No es una
 * transición del grafo: es una PRECONDICIÓN declarativa sobre el estado actual,
 * análoga a `esEstadoValidoParaRegistrarFirmaCondiciones` (US-024).
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una función pura sin
 * dependencias de infra. El checklist GET —más permisivo, consultable también en
 * `post_evento` (FA-01)— NO es esta guarda: solo la ESCRITURA la usa.
 *
 * RED: aún NO existe `esEstadoQuePermiteDocumentacionEvento` en `maquina-estados.ts`.
 * El import falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es
 * de `backend-developer`.
 */
import {
  esEstadoQuePermiteDocumentacionEvento,
  type EstadoReserva,
} from '../maquina-estados';

describe('esEstadoQuePermiteDocumentacionEvento — guarda ESTRICTA de escritura (US-033, 3.1)', () => {
  it('debe_permitir_la_documentacion_del_evento_solo_en_evento_en_curso', () => {
    expect(esEstadoQuePermiteDocumentacionEvento('evento_en_curso')).toBe(true);
  });

  const estadosProhibidos: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'pre_reserva',
    'reserva_confirmada',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estadosProhibidos)(
    'debe_rechazar_la_documentacion_del_evento_en_estado_%s',
    (estado) => {
      expect(esEstadoQuePermiteDocumentacionEvento(estado)).toBe(false);
    },
  );

  it('debe_rechazar_post_evento_para_la_ESCRITURA_aunque_el_checklist_GET_si_sea_consultable', () => {
    // La subida (escritura) NO se admite en post_evento; el checklist GET sí (FA-01),
    // pero eso lo decide la query de checklist, no esta guarda de escritura.
    expect(esEstadoQuePermiteDocumentacionEvento('post_evento')).toBe(false);
  });
});
