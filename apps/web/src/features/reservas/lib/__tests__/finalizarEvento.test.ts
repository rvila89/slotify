import { describe, expect, it } from 'vitest';
import {
  etiquetaDocumentacionPendiente,
  puedeFinalizarEvento,
} from '../finalizarEvento';

/**
 * US-034 · UC-25 — guarda de origen de cliente y etiquetas de la advertencia de
 * documentación. Espejo de la guarda de origen declarativa del backend
 * (`evento_en_curso → post_evento`): la acción solo se ofrece en `evento_en_curso`.
 */
describe('puedeFinalizarEvento (guarda de origen de la acción)', () => {
  it('debe_habilitar_la_accion_solo_en_evento_en_curso', () => {
    expect(puedeFinalizarEvento('evento_en_curso')).toBe(true);
  });

  it('debe_deshabilitar_la_accion_en_cualquier_otro_estado', () => {
    for (const estado of [
      'consulta',
      'pre_reserva',
      'reserva_confirmada',
      'post_evento',
      'reserva_completada',
      'reserva_cancelada',
    ] as const) {
      expect(puedeFinalizarEvento(estado)).toBe(false);
    }
    expect(puedeFinalizarEvento(undefined)).toBe(false);
  });
});

describe('etiquetaDocumentacionPendiente (advertencia no bloqueante)', () => {
  it('debe_traducir_las_claves_conocidas_del_checklist_US033', () => {
    expect(etiquetaDocumentacionPendiente('dni_anverso')).toBe('DNI (anverso)');
    expect(etiquetaDocumentacionPendiente('dni_reverso')).toBe('DNI (reverso)');
    expect(etiquetaDocumentacionPendiente('clausula_responsabilidad')).toBe(
      'Cláusula de responsabilidad',
    );
  });

  it('debe_normalizar_claves_desconocidas_sin_romper_fail_open', () => {
    expect(etiquetaDocumentacionPendiente('otro_documento_nuevo')).toBe(
      'Otro documento nuevo',
    );
  });
});
