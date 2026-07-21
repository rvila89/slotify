/**
 * TESTS del mapper de PROYECCIÓN `proyectarFicha` (US-025 / UC-20) — fase TDD RED del
 * change `2026-07-21-ficha-operativa-campos-operativos`.
 *
 * Fija el CONTRATO de la vista de lectura de la FICHA_OPERATIVA tras el ajuste de campos:
 *   - AÑADE `contactoEventoCorreo`, `horaLlegada` (HH:MM) y `duracion` (texto libre).
 *   - ELIMINA `menuSeleccionado` y `timingDetallado` de la respuesta (las columnas
 *     permanecen en la BD como nullable, pero NO se proyectan al dominio ni al contrato).
 *
 * Es un test PURO del mapper: NO toca Prisma real (hexagonal, hook `no-infra-in-domain`).
 * La fila Prisma se simula como un objeto plano con TODAS las columnas de la tabla
 * (incluidas las legacy `menuSeleccionado`/`timingDetallado`, que siguen existiendo en
 * BD) para verificar que el mapper las IGNORA y solo expone el nuevo conjunto de campos.
 *
 * RED: `proyectarFicha` aún proyecta `menuSeleccionado`/`timingDetallado` y no conoce
 * los nuevos campos; el tipo `FichaOperativa` de dominio todavía no los declara. En ROJO
 * hasta que `backend-developer` actualice `ficha-operativa.mapper.ts` y la entidad de
 * dominio. GREEN es de `backend-developer`.
 */
import type { FichaOperativa as FichaOperativaPrisma } from '@prisma/client';
import { proyectarFicha } from '../ficha-operativa.mapper';

const RESERVA_ID = '00000000-0000-0000-0000-0000000000aa';

/**
 * Fila Prisma simulada: incluye TODAS las columnas de la tabla `ficha_operativa`, entre
 * ellas las columnas legacy `menuSeleccionado`/`timingDetallado` (que permanecen en BD)
 * y las nuevas `contactoEventoCorreo`/`horaLlegada`/`duracion`. Se castea porque el tipo
 * generado por Prisma evoluciona con la migración; el mapper es quien fija qué se proyecta.
 */
const filaPrisma = (over: Record<string, unknown> = {}): FichaOperativaPrisma =>
  ({
    idFicha: 'ficha-1',
    reservaId: RESERVA_ID,
    numInvitadosConfirmado: 85,
    // Columnas legacy que siguen en BD pero NO deben proyectarse.
    menuSeleccionado: 'Menú degustación (legacy)',
    timingDetallado: '18h llegada, 19h cena (legacy)',
    // Campos del nuevo contrato.
    contactoEventoNombre: 'María López',
    contactoEventoTelefono: '600123456',
    contactoEventoCorreo: 'maria@example.com',
    horaLlegada: '18:00',
    duracion: '4h',
    notasOperativas: 'Alergia a los frutos secos',
    briefingEquipo: null,
    fichaCerrada: false,
    fechaCierre: null,
    ...over,
  }) as unknown as FichaOperativaPrisma;

describe('proyectarFicha — expone los nuevos campos operativos', () => {
  it('debe_proyectar_contacto_evento_correo_hora_llegada_y_duracion', () => {
    const ficha = proyectarFicha(filaPrisma(), 'en_curso');

    expect(ficha.contactoEventoCorreo).toBe('maria@example.com');
    expect(ficha.horaLlegada).toBe('18:00');
    expect(ficha.duracion).toBe('4h');
  });

  it('debe_proyectar_como_null_los_nuevos_campos_cuando_la_fila_los_tiene_a_null', () => {
    const ficha = proyectarFicha(
      filaPrisma({ contactoEventoCorreo: null, horaLlegada: null, duracion: null }),
      'pendiente',
    );

    expect(ficha.contactoEventoCorreo).toBeNull();
    expect(ficha.horaLlegada).toBeNull();
    expect(ficha.duracion).toBeNull();
  });

  it('debe_conservar_los_campos_de_contacto_y_estado_ya_existentes', () => {
    const ficha = proyectarFicha(filaPrisma(), 'en_curso');

    expect(ficha.reservaId).toBe(RESERVA_ID);
    expect(ficha.contactoEventoNombre).toBe('María López');
    expect(ficha.contactoEventoTelefono).toBe('600123456');
    expect(ficha.fichaCerrada).toBe(false);
    expect(ficha.preEventoStatus).toBe('en_curso');
  });
});

describe('proyectarFicha — NO expone los campos eliminados del contrato', () => {
  it('no_debe_incluir_menu_seleccionado_aunque_la_columna_exista_en_bd', () => {
    const ficha = proyectarFicha(filaPrisma(), 'en_curso');

    expect(ficha).not.toHaveProperty('menuSeleccionado');
  });

  it('no_debe_incluir_timing_detallado_aunque_la_columna_exista_en_bd', () => {
    const ficha = proyectarFicha(filaPrisma(), 'en_curso');

    expect(ficha).not.toHaveProperty('timingDetallado');
  });
});
