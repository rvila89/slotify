/**
 * TESTS DE APLICACIÓN del caso de uso `DescartarConsultaPorClienteUseCase`
 * (US-013 / UC-10 / A17, actor Gestor "en nombre del cliente") — fase TDD RED.
 * tasks.md §"TDD primero (RED)": tests por origen (tabla design.md §D-1), guarda de
 * origen (FA terminal), motivo opcional en notas, promoción A15 exactamente una vez,
 * atomicidad/rollback, auditoría.
 *
 * Trazabilidad: US-013, spec-delta `consultas` (Requirements: transición a 2.z;
 * guarda de origen no terminal; liberación de fecha 2b/2c/2v; promoción FIFO A15 en
 * 2b/2v con cola; salida de cola con reordenación en 2d; motivo opcional en notas;
 * auditoría sin duplicar liberación; atomicidad y serialización); design.md §D-1
 * (tabla origen→efectos), §D-2 (promoción vs. salida de cola son ramas opuestas), §D-3
 * (una única transacción, sin locks distribuidos). CLAUDE.md §Regla crítica.
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal): se ejercita el caso de uso
 * contra un DOBLE del puerto `DescarteConsultaUoWPort` (in-memory), SIN tocar Prisma ni
 * la BD. El puerto encapsula la TRANSACCIÓN atómica bajo `SELECT … FOR UPDATE` (re-lee
 * la RESERVA bajo el lock, re-evalúa la guarda de origen con `resolverDescarteCliente`,
 * transiciona a 2.z, y SEGÚN EL ORIGEN dispara `liberarFecha()` [2b/2c/2v], la
 * promoción A15 `promoverPrimeroEnCola` UNA vez [2b/2v con cola] o el decremento de la
 * cola [2d], anexa el motivo a `RESERVA.notas` y audita). El caso de uso ORQUESTA:
 * recibe `{ tenantId, usuarioId, reservaId, motivo? }`, delega en la UoW y traduce su
 * desenlace a resultado/errores de dominio. Los efectos REALES en BD y la concurrencia
 * se verifican en `…-concurrencia.spec.ts` (Postgres real).
 *
 * Contrato del endpoint CONGELADO (POST /reservas/{id}/descartar; body `{ motivo? }`;
 * operationId `descartarConsultaPorCliente`):
 *   - 200 → RESERVA (consulta / 2z).
 *   - 409 → `DescarteEstadoTerminalError` ("Esta consulta ya está en un estado terminal
 *     y no puede modificarse") para origen terminal / RC-1 / RC-3.
 *   - 404 → `ReservaNoEncontradaDescarteError` (RESERVA inexistente para el tenant, RLS).
 *
 * RED: aún NO existe `application/descartar-consulta-por-cliente.use-case.ts` ni sus
 * puertos/tipos/errores. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  DescartarConsultaPorClienteUseCase,
  DescarteEstadoTerminalError,
  ReservaNoEncontradaDescarteError,
  type DescartarConsultaComando,
  type DescarteConsultaUoWPort,
  type ResultadoDescarteConsulta,
} from '../application/descartar-consulta-por-cliente.use-case';
import type { SubEstadoConsulta } from '../domain/maquina-estados';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000b2';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-013';
const MOTIVO = 'El cliente ha decidido celebrar el evento en otra ubicación.';

// ---------------------------------------------------------------------------
// Comando + desenlace por defecto y helpers de doble de la UoW.
// ---------------------------------------------------------------------------

const comando = (
  over: Partial<DescartarConsultaComando> = {},
): DescartarConsultaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

/**
 * Desenlace por defecto de la UoW: descarte desde `2a` (rama mínima) — marca 2z, sin
 * liberar fecha, sin promoción, sin reordenar cola, sin motivo. Cada test lo sobreescribe
 * para la rama que ejercita (tabla design.md §D-1).
 */
const resultadoOk = (
  over: Partial<ResultadoDescarteConsulta> = {},
): ResultadoDescarteConsulta => ({
  reservaId: RESERVA_ID,
  subEstadoAnterior: '2a',
  subEstadoNuevo: '2z',
  fechaLiberada: false,
  promocionDisparada: false,
  reordenadas: 0,
  notasActualizadas: false,
  ...over,
});

type UoWFake = DescarteConsultaUoWPort & { descartar: jest.Mock };

/**
 * Doble de la UoW de descarte. Por defecto descarta con éxito según `resultadoOk()`.
 * `desenlace` permite mapear el resultado por rama (2a/2b/2c/2d/2v) o forzar el abort de
 * la guarda de origen mediante el error de dominio correspondiente (terminal / no
 * encontrada).
 */
const crearUoWFake = (
  desenlace?: ResultadoDescarteConsulta | Error,
): UoWFake => ({
  descartar: jest.fn(
    async (_c: DescartarConsultaComando): Promise<ResultadoDescarteConsulta> => {
      if (desenlace instanceof Error) {
        throw desenlace;
      }
      return desenlace ?? resultadoOk();
    },
  ),
});

const montar = (desenlace?: ResultadoDescarteConsulta | Error) => {
  const uow = crearUoWFake(desenlace);
  const useCase = new DescartarConsultaPorClienteUseCase({ uow });
  return { useCase, uow };
};

// ===========================================================================
// HAPPY PATH — 2.a → 2.z: solo marca 2z. NO libera fecha, NO promoción, NO reordena
// cola. Con motivo → notas anexadas.
//   spec-delta: "Descarte desde 2.a solo marca 2.z sin tocar fecha ni cola".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — 2.a solo marca 2z', () => {
  it('debe_delegar_en_la_uow_con_tenant_usuario_reserva_y_motivo', async () => {
    const { useCase, uow } = montar(resultadoOk({ notasActualizadas: true }));

    await useCase.ejecutar(comando({ motivo: MOTIVO }));

    expect(uow.descartar).toHaveBeenCalledTimes(1);
    expect(uow.descartar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        usuarioId: GESTOR,
        reservaId: RESERVA_ID,
        motivo: MOTIVO,
      }),
    );
  });

  it('debe_transicionar_a_2z_sin_liberar_fecha_ni_promocion_ni_reordenar', async () => {
    const { useCase } = montar(resultadoOk({ subEstadoAnterior: '2a' }));

    const resultado = await useCase.ejecutar(comando({ motivo: MOTIVO }));

    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.fechaLiberada).toBe(false);
    expect(resultado.promocionDisparada).toBe(false);
    expect(resultado.reordenadas).toBe(0);
  });
});

// ===========================================================================
// HAPPY PATH — 2.b SIN cola → 2.z + liberarFecha(); promoción NO se dispara (cola
// vacía → no-op).
//   spec-delta: "Descarte desde 2.b sin cola libera la fecha sin acción de cola" +
//   "Descarte desde 2.b sin cola no dispara promoción".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — 2.b sin cola libera fecha sin promoción', () => {
  it('debe_marcar_2z_liberar_fecha_y_no_disparar_promocion', async () => {
    const { useCase } = montar(
      resultadoOk({
        subEstadoAnterior: '2b',
        fechaLiberada: true,
        promocionDisparada: false,
        reordenadas: 0,
      }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.fechaLiberada).toBe(true);
    expect(resultado.promocionDisparada).toBe(false);
  });
});

// ===========================================================================
// HAPPY PATH — 2.b CON cola → 2.z + liberarFecha() + promoverPrimeroEnCola EXACTAMENTE
// una vez (anti doble promoción, D-2).
//   spec-delta: "Descarte desde 2.b con cola dispara la promoción A15 una vez".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — 2.b con cola dispara promoción una vez', () => {
  it('debe_marcar_2z_liberar_fecha_y_disparar_la_promocion_exactamente_una_vez', async () => {
    const { useCase } = montar(
      resultadoOk({
        subEstadoAnterior: '2b',
        fechaLiberada: true,
        promocionDisparada: true,
      }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.fechaLiberada).toBe(true);
    // D-2: la promoción se dispara UNA vez (el flag booleano es el conteo de la UoW; el
    // "exactamente una" a nivel de seam se verifica en `…-concurrencia.spec.ts`).
    expect(resultado.promocionDisparada).toBe(true);
    // 2b con cola NO reordena manualmente: la promoción A15 reordena internamente (D-1).
    expect(resultado.reordenadas).toBe(0);
  });
});

// ===========================================================================
// HAPPY PATH — 2.c → 2.z + liberarFecha(); NO promoción (cola imposible en 2c).
//   spec-delta: "Descarte desde 2.c libera la fecha sin cola posible".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — 2.c libera fecha sin cola posible', () => {
  it('debe_marcar_2z_liberar_fecha_y_no_promover_ni_reordenar', async () => {
    const { useCase } = montar(
      resultadoOk({
        subEstadoAnterior: '2c',
        fechaLiberada: true,
        promocionDisparada: false,
        reordenadas: 0,
      }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.fechaLiberada).toBe(true);
    expect(resultado.promocionDisparada).toBe(false);
    expect(resultado.reordenadas).toBe(0);
  });
});

// ===========================================================================
// HAPPY PATH — 2.d → 2.z + salir de cola + decremento del resto (posicion_cola > P);
// la bloqueante NO se modifica; NO libera fecha; NO promoción.
//   spec-delta: "Salida de cola con reordenación al descartar desde 2.d".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — 2.d sale de cola y decrementa el resto', () => {
  it('debe_marcar_2z_reordenar_la_cola_sin_liberar_fecha_ni_promover', async () => {
    // R3 (posición 2) descartada: R4 (posición 3) decrementa a 2 → 1 reordenada.
    const { useCase } = montar(
      resultadoOk({
        subEstadoAnterior: '2d',
        fechaLiberada: false,
        promocionDisparada: false,
        reordenadas: 1,
      }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.fechaLiberada).toBe(false);
    expect(resultado.promocionDisparada).toBe(false);
    expect(resultado.reordenadas).toBe(1);
  });

  it('debe_marcar_2z_sin_reordenar_cuando_descarta_el_ultimo_en_cola', async () => {
    // Descartar la última posición: nadie detrás → 0 reordenadas.
    const { useCase } = montar(
      resultadoOk({ subEstadoAnterior: '2d', reordenadas: 0 }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.reordenadas).toBe(0);
    expect(resultado.fechaLiberada).toBe(false);
  });
});

// ===========================================================================
// HAPPY PATH — 2.v SIN cola → 2.z + liberarFecha(); sin promoción.
//   spec-delta: "Descarte desde 2.v … + FECHA_BLOQUEADA eliminada".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — 2.v sin cola libera fecha sin promoción', () => {
  it('debe_marcar_2z_liberar_fecha_y_no_promover', async () => {
    const { useCase } = montar(
      resultadoOk({
        subEstadoAnterior: '2v',
        fechaLiberada: true,
        promocionDisparada: false,
      }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.fechaLiberada).toBe(true);
    expect(resultado.promocionDisparada).toBe(false);
  });
});

// ===========================================================================
// HAPPY PATH — 2.v CON cola heredada → 2.z + liberarFecha() + promoción una vez (idéntico
// a 2b con cola, D-1/D-2).
//   spec-delta: "Descarte desde 2.v con cola heredada dispara la promoción igual que 2.b".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — 2.v con cola heredada dispara promoción una vez', () => {
  it('debe_marcar_2z_liberar_fecha_y_disparar_la_promocion_una_vez', async () => {
    const { useCase } = montar(
      resultadoOk({
        subEstadoAnterior: '2v',
        fechaLiberada: true,
        promocionDisparada: true,
      }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.fechaLiberada).toBe(true);
    expect(resultado.promocionDisparada).toBe(true);
  });
});

// ===========================================================================
// GUARDA DE ORIGEN (FA terminal) — origen 2x/2y/2z / reserva_cancelada /
// reserva_completada → 409 `DescarteEstadoTerminalError` sin mutación. La UoW re-evalúa
// la guarda bajo el lock (`resolverDescarteCliente` → null) y aborta; el caso de uso
// propaga el error.
//   spec-delta: "Descarte sobre una RESERVA en estado terminal se rechaza sin efectos".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — guarda de origen: terminal → 409 sin efectos', () => {
  it('debe_propagar_DescarteEstadoTerminalError_con_el_mensaje_del_contrato', async () => {
    const { useCase } = montar(
      new DescarteEstadoTerminalError(
        'Esta consulta ya está en un estado terminal y no puede modificarse',
      ),
    );

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      DescarteEstadoTerminalError,
    );
    await expect(useCase.ejecutar(comando())).rejects.toThrow(
      'Esta consulta ya está en un estado terminal y no puede modificarse',
    );
  });

  it('debe_distinguir_el_error_terminal_de_reserva_no_encontrada', async () => {
    // El error de estado terminal (409) NO debe ser instancia del de "no encontrada"
    // (404): el controller los mapea a códigos HTTP distintos.
    const { useCase } = montar(
      new DescarteEstadoTerminalError(
        'Esta consulta ya está en un estado terminal y no puede modificarse',
      ),
    );

    await expect(useCase.ejecutar(comando())).rejects.not.toBeInstanceOf(
      ReservaNoEncontradaDescarteError,
    );
  });
});

// ===========================================================================
// RLS / multi-tenancy — RESERVA inexistente o de otro tenant → 404
// `ReservaNoEncontradaDescarteError`. Es un error PROPIO y distinto del terminal.
//   contrato op `descartarConsultaPorCliente`: 404 "RESERVA inexistente o de otro tenant".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — reserva no encontrada bajo RLS → 404', () => {
  it('debe_propagar_ReservaNoEncontradaDescarteError_cuando_no_es_resoluble_bajo_rls', async () => {
    const { useCase } = montar(
      new ReservaNoEncontradaDescarteError('La reserva indicada no existe'),
    );

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaDescarteError,
    );
  });

  it('reserva_no_encontrada_no_debe_ser_instancia_del_error_de_estado_terminal', async () => {
    const { useCase } = montar(
      new ReservaNoEncontradaDescarteError('La reserva indicada no existe'),
    );

    await expect(useCase.ejecutar(comando())).rejects.not.toBeInstanceOf(
      DescarteEstadoTerminalError,
    );
  });
});

// ===========================================================================
// MOTIVO OPCIONAL — con motivo la UoW anexa a `RESERVA.notas`; sin motivo la transición
// completa igual y `notas` queda sin cambios. El caso de uso PROPAGA el motivo tal cual
// (incluido `undefined`), sin inventarlo ni bloquear por su ausencia.
//   spec-delta: "Motivo de descarte opcional en RESERVA.notas".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — motivo opcional en notas', () => {
  it('debe_propagar_el_motivo_a_la_uow_cuando_se_proporciona', async () => {
    const { useCase, uow } = montar(resultadoOk({ notasActualizadas: true }));

    const resultado = await useCase.ejecutar(comando({ motivo: MOTIVO }));

    expect(uow.descartar).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: MOTIVO }),
    );
    expect(resultado.notasActualizadas).toBe(true);
  });

  it('debe_completar_sin_tocar_notas_cuando_no_se_proporciona_motivo', async () => {
    const { useCase, uow } = montar(resultadoOk({ notasActualizadas: false }));

    const resultado = await useCase.ejecutar(comando());

    // La ausencia de motivo NO bloquea la transición y NO actualiza notas.
    expect(resultado.subEstadoNuevo).toBe('2z');
    expect(resultado.notasActualizadas).toBe(false);
    const args = uow.descartar.mock.calls[0][0];
    expect(args.motivo).toBeUndefined();
  });
});

// ===========================================================================
// ATOMICIDAD / ROLLBACK — si un paso de la UoW falla (liberarFecha, promoción,
// reordenación, notas o auditoría), el error se PROPAGA para que la transacción haga
// rollback total (el caso de uso NO lo atrapa ni deja estado intermedio).
//   spec-delta: "Fallo en cualquier paso hace rollback completo".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — atomicidad / rollback', () => {
  it('debe_propagar_el_error_cuando_un_paso_de_la_uow_falla', async () => {
    const { useCase } = montar(new Error('FALLO_SIMULADO_PROMOCION'));

    await expect(useCase.ejecutar(comando())).rejects.toThrow(
      'FALLO_SIMULADO_PROMOCION',
    );
  });
});

// ===========================================================================
// AUDITORÍA — el caso de uso reporta el sub-estado de origen y el destino 2z para que la
// traza (`accion='transicion'`, `entidad='RESERVA'`, datos_anteriores/nuevos) sea
// coherente con el criterio de US-014/US-018. La escritura del AUDIT_LOG y la NO
// duplicación de la auditoría de `liberarFecha()`/promoción viven en la UoW/integración;
// aquí se fija que el desenlace expone el par (origen → 2z) por rama.
//   spec-delta: "Auditoría de la transición a 2.z sin duplicar la liberación de fecha".
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — desenlace expone origen y destino para auditar', () => {
  it.each(['2a', '2b', '2c', '2d', '2v'] as const)(
    'debe_reportar_sub_estado_anterior_%s_y_nuevo_2z',
    async (origen: SubEstadoConsulta) => {
      const { useCase } = montar(resultadoOk({ subEstadoAnterior: origen }));

      const resultado = await useCase.ejecutar(comando());

      expect(resultado.subEstadoAnterior).toBe(origen);
      expect(resultado.subEstadoNuevo).toBe('2z');
    },
  );
});

// ===========================================================================
// MULTI-TENANCY — el caso de uso propaga SIEMPRE el tenant y el usuario del comando
// (derivados del JWT), nunca de otro sitio.
// ===========================================================================

describe('DescartarConsultaPorClienteUseCase — RLS por tenant + usuario del JWT', () => {
  it('debe_pasar_a_la_uow_el_tenant_y_usuario_recibidos_en_el_comando', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando({ tenantId: OTRO_TENANT, usuarioId: 'otro-gestor' }));

    expect(uow.descartar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT, usuarioId: 'otro-gestor' }),
    );
  });
});
