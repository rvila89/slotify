/**
 * TESTS DE APLICACIÓN del caso de uso ORQUESTADOR `DescartarReservaOrquestadorUseCase`
 * (workstream B / D-2 del change `presupuesto-prereserva-cta-descarte-y-e2`) — fase TDD RED.
 *
 * D-2 (CERRADA = REUTILIZAR `POST /reservas/{id}/descartar`): el MISMO endpoint de US-013
 * despacha por el ESTADO ACTUAL de la RESERVA. El despacho por fase vive en un use-case
 * ORQUESTADOR (NO en `if/else` de negocio en el controller): dado `reserva.estado`, enruta al
 * caso de uso correcto:
 *   - `consulta` (+sub-estados) → `DescartarConsultaPorClienteUseCase` (US-013, → 2z), intacto.
 *   - `pre_reserva` → `DescartarPreReservaUseCase` (nuevo, → reserva_cancelada).
 *   - otro estado (`reserva_confirmada` y posteriores, terminales) → error de origen inválido.
 *
 * Trazabilidad: design.md §"Workstream B" / §D-2 ("Dónde vive el despacho por fase (branch)":
 * "Branch elegido: en un use-case ORQUESTADOR, no en el controller"; "el controller solo elige
 * el use-case por estado y mapea errores a HTTP"); spec-delta `consultas` (Requirement "Descarte
 * manual de una pre-reserva…": "El despacho por fase vive en un use-case orquestador").
 * CLAUDE.md §Máquina de estados.
 *
 * DOMINIO/APLICACIÓN AISLADOS (hexagonal, skill `tdd-core`): se ejercita el ORQUESTADOR contra
 * DOBLES de ambos casos de uso hijos y de la lectura del estado de la RESERVA (puerto). Se
 * verifica EL ENRUTADO (qué caso de uso se invoca según el estado), no la lógica interna de cada
 * hijo (cubierta en `descartar-consulta-por-cliente.use-case.spec.ts` y
 * `descartar-prereserva.use-case.spec.ts`).
 *
 * RED: aún NO existe `application/descartar-reserva-orquestador.use-case.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN.
 * GREEN es de `backend-developer`.
 */
import {
  DescartarReservaOrquestadorUseCase,
  type DescartarReservaComando,
  type EstadoReservaLectorPort,
} from '../application/descartar-reserva-orquestador.use-case';
import type {
  DescartarConsultaPorClienteUseCase,
  ResultadoDescarteConsulta,
} from '../application/descartar-consulta-por-cliente.use-case';
import { DescarteEstadoTerminalError } from '../application/descartar-consulta-por-cliente.use-case';
import type {
  DescartarPreReservaUseCase,
  ResultadoDescartePreReserva,
} from '../application/descartar-prereserva.use-case';
import {
  DescartePreReservaOrigenInvalidoError,
} from '../application/descartar-prereserva.use-case';
import type { EstadoReserva, SubEstadoConsulta } from '../domain/maquina-estados';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-orq';
const MOTIVO = 'motivo cualquiera';

const comando = (
  over: Partial<DescartarReservaComando> = {},
): DescartarReservaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

// ---------------------------------------------------------------------------
// Dobles: lector de estado + los dos casos de uso hijos.
// ---------------------------------------------------------------------------

const resultadoConsulta = (): ResultadoDescarteConsulta => ({
  reservaId: RESERVA_ID,
  subEstadoAnterior: '2b',
  subEstadoNuevo: '2z',
  fechaLiberada: true,
  promocionDisparada: false,
  reordenadas: 0,
  notasActualizadas: false,
});

const resultadoPreReserva = (): ResultadoDescartePreReserva => ({
  reservaId: RESERVA_ID,
  estadoAnterior: 'pre_reserva',
  estadoNuevo: 'reserva_cancelada',
  fechaLiberada: true,
  promocionDisparada: false,
  motivoAuditado: false,
});

type LectorFake = EstadoReservaLectorPort & { leerEstado: jest.Mock };
type ConsultaUcFake = Pick<DescartarConsultaPorClienteUseCase, 'ejecutar'> & {
  ejecutar: jest.Mock;
};
type PreReservaUcFake = Pick<DescartarPreReservaUseCase, 'ejecutar'> & {
  ejecutar: jest.Mock;
};

/**
 * Lector del estado actual de la RESERVA (puerto): devuelve `{ estado, subEstado }` bajo RLS.
 * `null` = RESERVA invisible bajo RLS (inexistente o de otro tenant).
 */
const crearLectorFake = (
  estado: EstadoReserva | null,
  subEstado: SubEstadoConsulta | null = null,
): LectorFake => ({
  leerEstado: jest.fn(async () =>
    estado === null ? null : { estado, subEstado },
  ),
});

const montar = (opts: {
  estado: EstadoReserva | null;
  subEstado?: SubEstadoConsulta | null;
}) => {
  const lector = crearLectorFake(opts.estado, opts.subEstado ?? null);
  const descartarConsulta: ConsultaUcFake = {
    ejecutar: jest.fn(async () => resultadoConsulta()),
  };
  const descartarPreReserva: PreReservaUcFake = {
    ejecutar: jest.fn(async () => resultadoPreReserva()),
  };
  const useCase = new DescartarReservaOrquestadorUseCase({
    lector,
    descartarConsulta: descartarConsulta as unknown as DescartarConsultaPorClienteUseCase,
    descartarPreReserva: descartarPreReserva as unknown as DescartarPreReservaUseCase,
  });
  return { useCase, lector, descartarConsulta, descartarPreReserva };
};

// ===========================================================================
// 1. Estado `consulta` (+sub-estados válidos) → enruta al caso de uso de US-013 (→ 2z).
// ===========================================================================

describe('DescartarReservaOrquestadorUseCase — consulta enruta a descarte de consulta (US-013)', () => {
  const subEstados: ReadonlyArray<SubEstadoConsulta> = ['2a', '2b', '2c', '2d', '2v'];

  it.each(subEstados)(
    'debe_delegar_en_descartarConsulta_cuando_la_reserva_esta_en_consulta_%s',
    async (subEstado) => {
      const { useCase, descartarConsulta, descartarPreReserva } = montar({
        estado: 'consulta',
        subEstado,
      });

      await useCase.ejecutar(comando({ motivo: MOTIVO }));

      expect(descartarConsulta.ejecutar).toHaveBeenCalledTimes(1);
      expect(descartarConsulta.ejecutar).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          usuarioId: GESTOR,
          reservaId: RESERVA_ID,
          motivo: MOTIVO,
        }),
      );
      // NO debe tocar el caso de uso de pre-reserva.
      expect(descartarPreReserva.ejecutar).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 2. Estado `pre_reserva` → enruta al caso de uso NUEVO (→ reserva_cancelada).
// ===========================================================================

describe('DescartarReservaOrquestadorUseCase — pre_reserva enruta a descarte de pre-reserva', () => {
  it('debe_delegar_en_descartarPreReserva_cuando_la_reserva_esta_en_pre_reserva', async () => {
    const { useCase, descartarConsulta, descartarPreReserva } = montar({
      estado: 'pre_reserva',
    });

    const resultado = await useCase.ejecutar(comando({ motivo: MOTIVO }));

    expect(descartarPreReserva.ejecutar).toHaveBeenCalledTimes(1);
    expect(descartarPreReserva.ejecutar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        usuarioId: GESTOR,
        reservaId: RESERVA_ID,
        motivo: MOTIVO,
      }),
    );
    // NO debe tocar el caso de uso de consulta.
    expect(descartarConsulta.ejecutar).not.toHaveBeenCalled();
    // El desenlace es el terminal de pre-reserva.
    expect((resultado as ResultadoDescartePreReserva).estadoNuevo).toBe(
      'reserva_cancelada',
    );
  });
});

// ===========================================================================
// 3. Otros estados (reserva_confirmada y posteriores, terminales) → error de ORIGEN INVÁLIDO,
//    sin invocar ningún caso de uso hijo.
// ===========================================================================

describe('DescartarReservaOrquestadorUseCase — estados no descartables → origen inválido', () => {
  const estadosNoDescartables: ReadonlyArray<EstadoReserva> = [
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estadosNoDescartables)(
    'debe_rechazar_con_origen_invalido_cuando_la_reserva_esta_en_%s',
    async (estado) => {
      const { useCase, descartarConsulta, descartarPreReserva } = montar({ estado });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
        DescartePreReservaOrigenInvalidoError,
      );
      // No enruta a ninguno de los dos casos de uso hijos.
      expect(descartarConsulta.ejecutar).not.toHaveBeenCalled();
      expect(descartarPreReserva.ejecutar).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 4. Propagación de errores de dominio de los hijos — el orquestador NO los atrapa (el
//    controller los mapea a HTTP). Ejemplo: un descarte de consulta terminal → 409.
// ===========================================================================

describe('DescartarReservaOrquestadorUseCase — propaga los errores del caso de uso hijo', () => {
  it('debe_propagar_DescarteEstadoTerminalError_del_descarte_de_consulta', async () => {
    const { useCase, descartarConsulta } = montar({ estado: 'consulta', subEstado: '2z' });
    descartarConsulta.ejecutar.mockRejectedValueOnce(new DescarteEstadoTerminalError());

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      DescarteEstadoTerminalError,
    );
  });
});
