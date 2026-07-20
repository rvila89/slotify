import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

/**
 * 3.6 — El `Badge` de estado muestra SIEMPRE el estado de la reserva.
 *   Change `presupuesto-confirmar-ux-e2-idioma`, workstream C — fase TDD RED.
 *
 * Trazabilidad: spec-delta `pipeline-ui` (ADDED "El estado de la reserva es siempre
 * visible en la FichaConsulta"): con sub-estado muestra la etiqueta del sub-estado
 * (comportamiento actual); sin sub-estado muestra la etiqueta del ESTADO PRINCIPAL
 * (`pre_reserva → «Pre-reserva»`, `reserva_confirmada → «Confirmada»`, `evento_en_curso
 * → «En Curso»`, `post_evento → «Post-evento»`, reutilizando `COLUMNAS_KANBAN`); el
 * badge NO devuelve `null` para un estado principal sin sub-estado.
 *
 * RED: hoy `Badge` SOLO acepta la prop `subEstado` y hace `if (!subEstado) return null`,
 * de modo que para un `estado` principal sin sub-estado NO renderiza nada. La nueva prop
 * `estado` aún no existe (fallo de typing esperado) y las aserciones de las etiquetas de
 * estado principal fallan por comportamiento. GREEN es de `frontend-developer`.
 */
describe('Badge — estado siempre visible (3.6)', () => {
  it('debe_mostrar_la_etiqueta_del_subEstado_cuando_hay_subEstado', () => {
    render(<Badge subEstado="2b" />);

    expect(screen.getByTestId('badge-sub-estado')).toHaveTextContent(
      'Consulta con fecha',
    );
  });

  it('debe_mostrar_Pre_reserva_cuando_el_estado_es_pre_reserva_sin_subEstado', () => {
    render(<Badge estado="pre_reserva" />);

    const badge = screen.getByTestId('badge-sub-estado');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('Pre-reserva');
  });

  it('debe_mostrar_Confirmada_cuando_el_estado_es_reserva_confirmada', () => {
    render(<Badge estado="reserva_confirmada" />);

    expect(screen.getByTestId('badge-sub-estado')).toHaveTextContent('Confirmada');
  });

  it('debe_mostrar_En_Curso_cuando_el_estado_es_evento_en_curso', () => {
    render(<Badge estado="evento_en_curso" />);

    expect(screen.getByTestId('badge-sub-estado')).toHaveTextContent('En Curso');
  });

  it('debe_mostrar_Post_evento_cuando_el_estado_es_post_evento', () => {
    render(<Badge estado="post_evento" />);

    expect(screen.getByTestId('badge-sub-estado')).toHaveTextContent('Post-evento');
  });

  it('debe_mostrar_Cancelada_cuando_el_estado_es_reserva_cancelada', () => {
    render(<Badge estado="reserva_cancelada" />);

    const badge = screen.getByTestId('badge-sub-estado');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('Cancelada');
  });

  it('debe_mostrar_Completada_cuando_el_estado_es_reserva_completada', () => {
    render(<Badge estado="reserva_completada" />);

    expect(screen.getByTestId('badge-sub-estado')).toHaveTextContent('Completada');
  });
});
