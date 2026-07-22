/**
 * TESTS del PRE-RELLENO al LEER la ficha operativa (change `reserva-viva-edicion-
 * recalculo-ficha`, tasks.md 3.2 sub-test B) — fase TDD RED.
 *
 * Trazabilidad: spec-delta `ficha-operativa` (Requirement "Pre-relleno completo de la
 * ficha al leer desde RESERVA y CLIENTE"; Scenarios "Ficha ya existente muestra los datos
 * pre-rellenados al leer" y "Un valor propio de la ficha prevalece sobre el pre-relleno");
 * design.md §D-2. Regla por campo: `valorFicha ?? valorDerivadoDeReservaOCliente`.
 *
 * Mapa de pre-relleno (D-2):
 *   - personas             → derivarNumPersonas(RESERVA)
 *   - duracion (present.)  ← RESERVA.duracionHoras
 *   - horaLlegada          ← RESERVA.horario
 *   - contactoEventoNombre ← CLIENTE.nombre + ' ' + CLIENTE.apellidos
 *   - contactoEventoTelefono ← CLIENTE.telefono
 *   - contactoEventoCorreo ← CLIENTE.email
 *   - notasOperativas      ← RESERVA.comentarios
 *
 * INVARIANTE: LEER NO muta ni dispara transiciones (el pre-relleno es de PRESENTACIÓN);
 * un valor PROPIO persistido en la ficha PREVALECE sobre el derivado. El caso de uso se
 * ejercita contra DOBLES DE LOS PUERTOS (in-memory), sin Prisma (hexagonal).
 *
 * RED: hoy `LeerFichaOperativaUseCase` devuelve `reserva.ficha` TAL CUAL (sin pre-relleno)
 * y el puerto de carga no expone RESERVA/CLIENTE. Estas aserciones FALLAN por
 * comportamiento (y/o por tipos) hasta que `backend-developer` implemente el pre-relleno
 * al leer con el JOIN a CLIENTE. GREEN es de `backend-developer`.
 */
import {
  LeerFichaOperativaUseCase,
  type LeerFichaOperativaDeps,
  type LeerFichaOperativaComando,
  type ReservaFichaOperativa,
  type FichaOperativa,
} from '../application/leer-ficha-operativa.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-viva';

// ---------------------------------------------------------------------------
// Dobles: la RESERVA cargada trae la ficha + los datos de RESERVA y CLIENTE para el
// pre-relleno (el adaptador de carga hace el JOIN a CLIENTE, D-2). Los tipos nuevos
// (`reserva`, `cliente`) los añade `backend-developer`; en RED el import/uso falla.
// ---------------------------------------------------------------------------

const fichaVacia = (over: Partial<FichaOperativa> = {}): FichaOperativa => ({
  idFicha: 'ficha-1',
  reservaId: RESERVA_ID,
  numInvitadosConfirmado: null,
  contactoEventoNombre: null,
  contactoEventoTelefono: null,
  contactoEventoCorreo: null,
  horaLlegada: null,
  duracion: null,
  notasOperativas: null,
  briefingEquipo: null,
  fichaCerrada: false,
  fechaCierre: null,
  preEventoStatus: 'en_curso',
  ...over,
});

const reservaConDatos = (
  over: Partial<ReservaFichaOperativa> = {},
): ReservaFichaOperativa =>
  ({
    idReserva: RESERVA_ID,
    tenantId: TENANT,
    estado: 'reserva_confirmada',
    ficha: fichaVacia(),
    // Datos de la RESERVA para el pre-relleno.
    reserva: {
      duracionHoras: 8,
      horario: '18:00',
      comentarios: 'Alergia a frutos secos',
      numInvitadosFinal: null,
      numAdultosNinosMayores4: 48,
      numNinosMenores4: 2,
    },
    // Datos del CLIENTE (JOIN del adaptador de carga).
    cliente: {
      nombre: 'Ana',
      apellidos: 'López',
      telefono: '600111222',
      email: 'ana@example.com',
    },
    ...over,
  }) as ReservaFichaOperativa;

const montar = (reserva: ReservaFichaOperativa) => {
  const cargarReservaConFicha = jest.fn(async () => reserva);
  const deps: LeerFichaOperativaDeps = { cargarReservaConFicha };
  return { useCase: new LeerFichaOperativaUseCase(deps), cargarReservaConFicha };
};

const comando = (): LeerFichaOperativaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
});

// ===========================================================================
// 3.2 B — Campos NULOS en la ficha se pre-rellenan desde RESERVA/CLIENTE.
// ===========================================================================

describe('LeerFichaOperativaUseCase — pre-relleno de campos nulos (3.2 B)', () => {
  it('debe_rellenar_duracion_con_RESERVA_duracionHoras_cuando_la_ficha_no_tiene_valor', async () => {
    const { useCase } = montar(reservaConDatos());

    const ficha = await useCase.ejecutar(comando());

    // duracionHoras = 8 → presentación "8" (o "8h"): contiene el 8 de la RESERVA.
    expect(String(ficha.duracion)).toContain('8');
  });

  it('debe_rellenar_horaLlegada_con_RESERVA_horario_cuando_la_ficha_no_tiene_valor', async () => {
    const { useCase } = montar(reservaConDatos());

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.horaLlegada).toBe('18:00');
  });

  it('debe_rellenar_contactoEventoNombre_con_nombre_y_apellidos_del_cliente', async () => {
    const { useCase } = montar(reservaConDatos());

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.contactoEventoNombre).toBe('Ana López');
  });

  it('debe_rellenar_contactoEventoTelefono_con_el_telefono_del_cliente', async () => {
    const { useCase } = montar(reservaConDatos());

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.contactoEventoTelefono).toBe('600111222');
  });

  it('debe_rellenar_contactoEventoCorreo_con_el_email_del_cliente', async () => {
    const { useCase } = montar(reservaConDatos());

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.contactoEventoCorreo).toBe('ana@example.com');
  });

  it('debe_rellenar_notasOperativas_con_RESERVA_comentarios', async () => {
    const { useCase } = montar(reservaConDatos());

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.notasOperativas).toBe('Alergia a frutos secos');
  });

  it('debe_exponer_el_numInvitadosConfirmado_derivado_del_desglose_de_la_RESERVA', async () => {
    const { useCase } = montar(reservaConDatos());

    const ficha = await useCase.ejecutar(comando());

    // numInvitadosFinal null → 48 + 2 = 50 (derivarNumPersonas).
    expect(ficha.numInvitadosConfirmado).toBe(50);
  });
});

// ===========================================================================
// 3.2 B — El valor PROPIO persistido en la ficha PREVALECE sobre el pre-relleno.
// ===========================================================================

describe('LeerFichaOperativaUseCase — el valor propio prevalece (3.2 B)', () => {
  it('debe_conservar_el_contactoEventoNombre_propio_de_la_ficha_sobre_el_del_cliente', async () => {
    const { useCase } = montar(
      reservaConDatos({
        ficha: fichaVacia({ contactoEventoNombre: 'Coordinador de sala' }),
      }),
    );

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.contactoEventoNombre).toBe('Coordinador de sala');
    expect(ficha.contactoEventoNombre).not.toBe('Ana López');
  });

  it('debe_conservar_la_horaLlegada_propia_de_la_ficha_sobre_la_de_la_RESERVA', async () => {
    const { useCase } = montar(
      reservaConDatos({ ficha: fichaVacia({ horaLlegada: '17:30' }) }),
    );

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.horaLlegada).toBe('17:30');
  });
});

// ===========================================================================
// 3.2 B — Leer NO muta: sin efectos secundarios (no se invoca ningún puerto de
//          guardado/transición; el `pre_evento_status` no cambia).
// ===========================================================================

describe('LeerFichaOperativaUseCase — leer no muta (3.2 B)', () => {
  it('no_debe_invocar_ningun_puerto_de_guardado_solo_el_de_carga', async () => {
    const { useCase, cargarReservaConFicha } = montar(reservaConDatos());

    await useCase.ejecutar(comando());

    // El único puerto de las deps es el de carga; se invoca exactamente una vez.
    expect(cargarReservaConFicha).toHaveBeenCalledTimes(1);
  });

  it('no_debe_cambiar_el_pre_evento_status_al_leer', async () => {
    const { useCase } = montar(
      reservaConDatos({ ficha: fichaVacia({ preEventoStatus: 'en_curso' }) }),
    );

    const ficha = await useCase.ejecutar(comando());

    expect(ficha.preEventoStatus).toBe('en_curso');
  });
});
