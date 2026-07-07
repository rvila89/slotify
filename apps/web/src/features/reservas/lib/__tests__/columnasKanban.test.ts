/**
 * Fase RED — US-050 · Pipeline de Reservas (Kanban + Listado) · UC-37.
 *
 * Trazabilidad: US-050 §Happy Path — Kanban, §Mapping fase → columna Kanban;
 * spec-delta `pipeline-ui` (Requirement "Agrupación de reservas por fase en las 5
 * columnas del Kanban"); design.md D-2 (mapa declarativo estado→columna, no lógica
 * dispersa); tasks.md Fase 3: 3.1.
 *
 * Contrato de producción que la fase GREEN (frontend-developer) debe cumplir en
 * `@/features/reservas/lib/columnasKanban`:
 *   - `COLUMNAS_KANBAN`: estructura de datos DECLARATIVA con las 5 columnas en orden
 *     (`Consulta`, `Pre-reserva`, `Confirmada`, `En Curso`, `Post-evento`), cada una
 *     con `id`, `label` y `dotColor` (token Figma node 0:523).
 *   - `columnaDeReserva(reserva)`: devuelve el `id` de columna de una reserva
 *     ubicándola por `subEstado` cuando es consulta (2a/2b/2c/2d/2v) y por `estado`
 *     en el resto; devuelve `null` para estados terminales/cerrados que no tienen
 *     columna (defensivo — no deberían llegar del endpoint).
 *   - `agruparPorColumna(reservas)`: agrupa una lista en las 5 columnas y omite
 *     silenciosamente las que no mapean a ninguna columna.
 *
 * RED: `@/features/reservas/lib/columnasKanban` aún no existe → el import de los
 * símbolos de producción falla y la batería está en ROJO por falta de
 * implementación (no por configuración del runner).
 */
import { describe, expect, it } from 'vitest';
import type { Reserva } from '../../model/types';
import {
  COLUMNAS_KANBAN,
  columnaDeReserva,
  agruparPorColumna,
} from '../columnasKanban';

/** Fábrica mínima de Reserva: solo los campos que consume el mapa de columnas. */
const reserva = (over: Partial<Reserva>): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0001',
    clienteId: crypto.randomUUID(),
    estado: 'consulta',
    canalEntrada: 'web',
    ...over,
  }) as Reserva;

describe('COLUMNAS_KANBAN — mapa declarativo de las 5 columnas (D-2)', () => {
  it('debe_exponer_las_5_columnas_en_orden_consulta_prereserva_confirmada_encurso_postevento', () => {
    // Arrange / Act
    const labels = COLUMNAS_KANBAN.map((c) => c.label);

    // Assert
    expect(labels).toEqual([
      'Consulta',
      'Pre-reserva',
      'Confirmada',
      'En Curso',
      'Post-evento',
    ]);
  });

  it('debe_asignar_a_cada_columna_su_dot_de_color_del_token_figma', () => {
    // Arrange
    const porLabel = Object.fromEntries(COLUMNAS_KANBAN.map((c) => [c.label, c.dotColor]));

    // Assert — tokens Figma node 0:523 (US-050 §Tokens de diseño Figma)
    expect(porLabel['Consulta']).toBe('#6a5c52');
    expect(porLabel['Pre-reserva']).toBe('#d98b74');
    expect(porLabel['Confirmada']).toBe('#8d4d39');
    expect(porLabel['En Curso']).toBe('#8d4d39');
    expect(porLabel['Post-evento']).toBe('#6a5c52');
  });
});

describe('columnaDeReserva — ubicación de una reserva por su fase (D-2)', () => {
  it.each(['2a', '2b', '2c', '2d', '2v'] as const)(
    'debe_ubicar_la_consulta_%s_en_la_columna_Consulta',
    (subEstado) => {
      // Arrange
      const r = reserva({ estado: 'consulta', subEstado });

      // Act
      const columna = columnaDeReserva(r);

      // Assert — resuelve al id de la columna "Consulta"
      const consulta = COLUMNAS_KANBAN.find((c) => c.label === 'Consulta');
      expect(columna).toBe(consulta?.id);
    },
  );

  it('debe_ubicar_pre_reserva_en_la_columna_Pre_reserva', () => {
    const r = reserva({ estado: 'pre_reserva', subEstado: undefined });
    const preReserva = COLUMNAS_KANBAN.find((c) => c.label === 'Pre-reserva');
    expect(columnaDeReserva(r)).toBe(preReserva?.id);
  });

  it('debe_ubicar_reserva_confirmada_en_la_columna_Confirmada', () => {
    const r = reserva({ estado: 'reserva_confirmada', subEstado: undefined });
    const confirmada = COLUMNAS_KANBAN.find((c) => c.label === 'Confirmada');
    expect(columnaDeReserva(r)).toBe(confirmada?.id);
  });

  it('debe_ubicar_evento_en_curso_en_la_columna_En_Curso', () => {
    const r = reserva({ estado: 'evento_en_curso', subEstado: undefined });
    const enCurso = COLUMNAS_KANBAN.find((c) => c.label === 'En Curso');
    expect(columnaDeReserva(r)).toBe(enCurso?.id);
  });

  it('debe_ubicar_post_evento_en_la_columna_Post_evento', () => {
    const r = reserva({ estado: 'post_evento', subEstado: undefined });
    const postEvento = COLUMNAS_KANBAN.find((c) => c.label === 'Post-evento');
    expect(columnaDeReserva(r)).toBe(postEvento?.id);
  });

  it.each(['2x', '2y', '2z'] as const)(
    'debe_devolver_null_para_la_consulta_terminal_%s_sin_columna',
    (subEstado) => {
      const r = reserva({ estado: 'consulta', subEstado });
      expect(columnaDeReserva(r)).toBeNull();
    },
  );

  it.each(['reserva_completada', 'reserva_cancelada'] as const)(
    'debe_devolver_null_para_el_estado_cerrado_%s_sin_columna',
    (estado) => {
      const r = reserva({ estado, subEstado: undefined });
      expect(columnaDeReserva(r)).toBeNull();
    },
  );
});

describe('agruparPorColumna — recuentos por columna (spec: cabecera con recuento)', () => {
  it('debe_agrupar_cada_reserva_en_su_columna_con_los_recuentos_correctos', () => {
    // Arrange — 3 consultas (una por sub-estado distinto), 2 pre_reserva, 1 confirmada,
    // 1 en curso, 1 post-evento + 1 terminal que NO debe contar en ninguna columna.
    const reservas: Reserva[] = [
      reserva({ estado: 'consulta', subEstado: '2a' }),
      reserva({ estado: 'consulta', subEstado: '2b' }),
      reserva({ estado: 'consulta', subEstado: '2v' }),
      reserva({ estado: 'pre_reserva', subEstado: undefined }),
      reserva({ estado: 'pre_reserva', subEstado: undefined }),
      reserva({ estado: 'reserva_confirmada', subEstado: undefined }),
      reserva({ estado: 'evento_en_curso', subEstado: undefined }),
      reserva({ estado: 'post_evento', subEstado: undefined }),
      reserva({ estado: 'consulta', subEstado: '2x' }), // terminal — se omite
    ];

    // Act
    const grupos = agruparPorColumna(reservas);
    const cuentaPorLabel = (label: string) => {
      const col = COLUMNAS_KANBAN.find((c) => c.label === label);
      return grupos[col!.id]?.length ?? 0;
    };

    // Assert
    expect(cuentaPorLabel('Consulta')).toBe(3);
    expect(cuentaPorLabel('Pre-reserva')).toBe(2);
    expect(cuentaPorLabel('Confirmada')).toBe(1);
    expect(cuentaPorLabel('En Curso')).toBe(1);
    expect(cuentaPorLabel('Post-evento')).toBe(1);
    // La terminal 2x no aparece en ninguna columna → total agrupado = 8, no 9.
    const total = COLUMNAS_KANBAN.reduce((n, c) => n + (grupos[c.id]?.length ?? 0), 0);
    expect(total).toBe(8);
  });
});
