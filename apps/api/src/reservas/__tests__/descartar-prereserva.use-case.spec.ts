/**
 * TESTS DE APLICACIÓN del caso de uso `DescartarPreReservaUseCase` (workstream B del change
 * `presupuesto-prereserva-cta-descarte-y-e2`) — fase TDD RED.
 *
 * Es el ESPEJO, en la fase `pre_reserva`, del descarte de consulta de US-013: transiciona
 * `{pre_reserva, null} → {reserva_cancelada, null}` (terminal, `ttl_expiracion = NULL`),
 * libera la FECHA_BLOQUEADA por la ÚNICA función canónica `liberarFecha()`, promueve/reordena
 * la cola de esa fecha (misma mecánica de US-018) y audita `AUDIT_LOG`
 * (`accion='transicion'`, `entidad='RESERVA'`, `pre_reserva → reserva_cancelada`) con `motivo`
 * OPCIONAL — todo en UNA transacción atómica bajo el contexto RLS del tenant.
 *
 * Trazabilidad: design.md §"Workstream B" (guarda de origen mono-origen; liberar fecha +
 * promover/reordenar cola en la MISMA tx atómica; `DescartarPreReservaUseCase` recibe
 * `{ tenantId, usuarioId, reservaId, motivo? }` y delega en `DescartePreReservaUoWPort`;
 * errores DISJUNTOS `DescartePreReservaOrigenInvalidoError` (422),
 * `DescartePreReservaEstadoTerminalError`/carrera (409), `ReservaNoEncontradaError` (404));
 * spec-delta `consultas` (Requirements: "Descarte manual de una pre-reserva a estado
 * terminal", "El descarte de la pre-reserva libera la fecha y promueve la cola en la misma
 * transacción", "Confirmación con motivo opcional auditado"). CLAUDE.md §Regla crítica.
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal): se ejercita el caso de uso contra
 * un DOBLE del puerto `DescartePreReservaUoWPort` (in-memory), SIN tocar Prisma ni la BD. El
 * puerto encapsula la TRANSACCIÓN atómica bajo `SELECT … FOR UPDATE` (re-lee la RESERVA bajo el
 * lock, re-evalúa la guarda de origen con `esOrigenValidoParaDescartarPreReserva`, transiciona a
 * `reserva_cancelada`, dispara `liberarFecha()`, promueve/reordena la cola UNA vez y audita). El
 * caso de uso ORQUESTA: recibe el comando, delega en la UoW y traduce su desenlace/error de
 * dominio. Los efectos REALES en BD y la concurrencia se verifican en
 * `…-concurrencia.spec.ts` (Postgres real).
 *
 * Contrato del endpoint REUTILIZADO (D-2: POST /reservas/{id}/descartar; body `{ motivo? }`;
 * el orquestador despacha por fase):
 *   - 200 → RESERVA (reserva_cancelada).
 *   - 422 → `DescartePreReservaOrigenInvalidoError` (origen no es `pre_reserva`).
 *   - 409 → `DescartePreReservaEstadoTerminalError` (ya terminal / carrera perdida bajo el lock).
 *   - 404 → `ReservaNoEncontradaError` (invisible bajo RLS).
 *
 * RED: aún NO existe `application/descartar-prereserva.use-case.ts` ni sus puertos/tipos/errores.
 * Los imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  DescartarPreReservaUseCase,
  DescartePreReservaOrigenInvalidoError,
  DescartePreReservaEstadoTerminalError,
  ReservaNoEncontradaError,
  type DescartarPreReservaComando,
  type DescartePreReservaUoWPort,
  type ResultadoDescartePreReserva,
} from '../application/descartar-prereserva.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000b2';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-prereserva';
const MOTIVO = 'El cliente ha decidido no seguir adelante con la pre-reserva.';

// ---------------------------------------------------------------------------
// Comando + desenlace por defecto y helpers de doble de la UoW.
// ---------------------------------------------------------------------------

const comando = (
  over: Partial<DescartarPreReservaComando> = {},
): DescartarPreReservaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

/**
 * Desenlace por defecto de la UoW: descarte de una pre_reserva SIN cola — transiciona a
 * `reserva_cancelada`, libera la fecha, sin promoción, sin auditar motivo. Cada test lo
 * sobreescribe para la rama que ejercita.
 */
const resultadoOk = (
  over: Partial<ResultadoDescartePreReserva> = {},
): ResultadoDescartePreReserva => ({
  reservaId: RESERVA_ID,
  estadoAnterior: 'pre_reserva',
  estadoNuevo: 'reserva_cancelada',
  fechaLiberada: true,
  promocionDisparada: false,
  motivoAuditado: false,
  ...over,
});

type UoWFake = DescartePreReservaUoWPort & { descartar: jest.Mock };

/**
 * Doble de la UoW de descarte de pre-reserva. Por defecto descarta con éxito según
 * `resultadoOk()`. `desenlace` permite mapear el resultado por rama o forzar el abort de la
 * guarda bajo el lock mediante el error de dominio correspondiente
 * (origen inválido / terminal-carrera / no encontrada).
 */
const crearUoWFake = (
  desenlace?: ResultadoDescartePreReserva | Error,
): UoWFake => ({
  descartar: jest.fn(
    async (_c: DescartarPreReservaComando): Promise<ResultadoDescartePreReserva> => {
      if (desenlace instanceof Error) {
        throw desenlace;
      }
      return desenlace ?? resultadoOk();
    },
  ),
});

const montar = (desenlace?: ResultadoDescartePreReserva | Error) => {
  const uow = crearUoWFake(desenlace);
  const useCase = new DescartarPreReservaUseCase({ uow });
  return { useCase, uow };
};

// ===========================================================================
// HAPPY PATH — pre_reserva → reserva_cancelada: transición terminal + liberarFecha().
//   spec-delta: "El Gestor descarta una pre-reserva y la deja en reserva_cancelada".
// ===========================================================================

describe('DescartarPreReservaUseCase — transiciona pre_reserva a reserva_cancelada', () => {
  it('debe_delegar_en_la_uow_con_tenant_usuario_reserva_y_motivo', async () => {
    const { useCase, uow } = montar(resultadoOk({ motivoAuditado: true }));

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

  it('debe_transicionar_a_reserva_cancelada_y_liberar_la_fecha', async () => {
    const { useCase } = montar(resultadoOk());

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.estadoAnterior).toBe('pre_reserva');
    expect(resultado.estadoNuevo).toBe('reserva_cancelada');
    expect(resultado.fechaLiberada).toBe(true);
  });
});

// ===========================================================================
// HAPPY PATH — pre_reserva SIN cola → libera fecha, NO promoción.
//   spec-delta: "Descartar una pre-reserva sin cola libera la fecha sin promover".
// ===========================================================================

describe('DescartarPreReservaUseCase — sin cola libera fecha sin promover', () => {
  it('debe_marcar_reserva_cancelada_liberar_fecha_y_no_promover', async () => {
    const { useCase } = montar(
      resultadoOk({ fechaLiberada: true, promocionDisparada: false }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.estadoNuevo).toBe('reserva_cancelada');
    expect(resultado.fechaLiberada).toBe(true);
    expect(resultado.promocionDisparada).toBe(false);
  });
});

// ===========================================================================
// HAPPY PATH — pre_reserva CON cola → libera fecha + promoción EXACTAMENTE una vez.
//   spec-delta: "Descartar una pre-reserva con cola libera la fecha y promueve al primero"
//   (promoción exactamente una vez — idempotencia real en `…-concurrencia.spec.ts`).
// ===========================================================================

describe('DescartarPreReservaUseCase — con cola libera fecha y promueve una vez', () => {
  it('debe_marcar_reserva_cancelada_liberar_fecha_y_disparar_la_promocion_una_vez', async () => {
    const { useCase } = montar(
      resultadoOk({ fechaLiberada: true, promocionDisparada: true }),
    );

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.estadoNuevo).toBe('reserva_cancelada');
    expect(resultado.fechaLiberada).toBe(true);
    expect(resultado.promocionDisparada).toBe(true);
  });
});

// ===========================================================================
// GUARDA DE ORIGEN — origen distinto de `pre_reserva` (reserva_confirmada y posteriores) →
// 422 `DescartePreReservaOrigenInvalidoError` sin efectos. La UoW re-evalúa la guarda bajo el
// lock (`esOrigenValidoParaDescartarPreReserva` → false) y aborta; el caso de uso propaga.
//   spec-delta: "Descartar desde un estado que no es pre_reserva se rechaza sin efectos (422)".
// ===========================================================================

describe('DescartarPreReservaUseCase — guarda de origen: origen inválido → 422 sin efectos', () => {
  it('debe_propagar_DescartePreReservaOrigenInvalidoError', async () => {
    const { useCase } = montar(new DescartePreReservaOrigenInvalidoError());

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      DescartePreReservaOrigenInvalidoError,
    );
  });

  it('el_origen_invalido_no_debe_ser_instancia_del_error_de_estado_terminal_ni_no_encontrada', async () => {
    // Los tres errores son DISJUNTOS: el controller los mapea a 422/409/404 distintos.
    const { useCase } = montar(new DescartePreReservaOrigenInvalidoError());

    await expect(useCase.ejecutar(comando())).rejects.not.toBeInstanceOf(
      DescartePreReservaEstadoTerminalError,
    );
    await expect(useCase.ejecutar(comando())).rejects.not.toBeInstanceOf(
      ReservaNoEncontradaError,
    );
  });
});

// ===========================================================================
// CONFLICTO — RESERVA ya terminal (reserva_cancelada/reserva_completada) o carrera perdida bajo
// el lock → 409 `DescartePreReservaEstadoTerminalError` sin efectos adicionales.
//   spec-delta: "Descartar una reserva ya terminal se rechaza como conflicto (409)".
// ===========================================================================

describe('DescartarPreReservaUseCase — reserva ya terminal / carrera → 409', () => {
  it('debe_propagar_DescartePreReservaEstadoTerminalError', async () => {
    const { useCase } = montar(new DescartePreReservaEstadoTerminalError());

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      DescartePreReservaEstadoTerminalError,
    );
  });

  it('el_error_terminal_no_debe_ser_instancia_del_de_origen_invalido', async () => {
    const { useCase } = montar(new DescartePreReservaEstadoTerminalError());

    await expect(useCase.ejecutar(comando())).rejects.not.toBeInstanceOf(
      DescartePreReservaOrigenInvalidoError,
    );
  });
});

// ===========================================================================
// RLS / multi-tenancy — RESERVA inexistente o de otro tenant → 404 `ReservaNoEncontradaError`.
//   spec-delta: "El tenant_id y el usuario_id derivan SIEMPRE del JWT".
// ===========================================================================

describe('DescartarPreReservaUseCase — reserva no encontrada bajo RLS → 404', () => {
  it('debe_propagar_ReservaNoEncontradaError_cuando_no_es_resoluble_bajo_rls', async () => {
    const { useCase } = montar(new ReservaNoEncontradaError());

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );
  });

  it('no_encontrada_no_debe_ser_instancia_del_error_terminal_ni_del_de_origen_invalido', async () => {
    const { useCase } = montar(new ReservaNoEncontradaError());

    await expect(useCase.ejecutar(comando())).rejects.not.toBeInstanceOf(
      DescartePreReservaEstadoTerminalError,
    );
    await expect(useCase.ejecutar(comando())).rejects.not.toBeInstanceOf(
      DescartePreReservaOrigenInvalidoError,
    );
  });
});

// ===========================================================================
// MOTIVO OPCIONAL — con motivo la UoW lo audita en AUDIT_LOG (datos_nuevos); sin motivo la
// transición completa igual y NO se audita motivo. El caso de uso PROPAGA el motivo tal cual
// (incluido `undefined`), sin inventarlo ni bloquear por su ausencia.
//   spec-delta: "Descartar con motivo lo audita en AUDIT_LOG" / "Descartar sin motivo
//   transiciona igualmente".
// ===========================================================================

describe('DescartarPreReservaUseCase — motivo opcional auditado', () => {
  it('debe_propagar_el_motivo_a_la_uow_cuando_se_proporciona', async () => {
    const { useCase, uow } = montar(resultadoOk({ motivoAuditado: true }));

    const resultado = await useCase.ejecutar(comando({ motivo: MOTIVO }));

    expect(uow.descartar).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: MOTIVO }),
    );
    expect(resultado.motivoAuditado).toBe(true);
  });

  it('debe_completar_sin_auditar_motivo_cuando_no_se_proporciona', async () => {
    const { useCase, uow } = montar(resultadoOk({ motivoAuditado: false }));

    const resultado = await useCase.ejecutar(comando());

    // La ausencia de motivo NO bloquea la transición.
    expect(resultado.estadoNuevo).toBe('reserva_cancelada');
    expect(resultado.motivoAuditado).toBe(false);
    const args = uow.descartar.mock.calls[0][0];
    expect(args.motivo).toBeUndefined();
  });
});

// ===========================================================================
// ATOMICIDAD / ROLLBACK — si un paso de la UoW falla (liberarFecha, promoción o auditoría), el
// error se PROPAGA para que la transacción haga rollback total (el caso de uso NO lo atrapa).
//   spec-delta: "Un fallo durante el descarte revierte todo".
// ===========================================================================

describe('DescartarPreReservaUseCase — atomicidad / rollback', () => {
  it('debe_propagar_el_error_cuando_un_paso_de_la_uow_falla', async () => {
    const { useCase } = montar(new Error('FALLO_SIMULADO_PROMOCION'));

    await expect(useCase.ejecutar(comando())).rejects.toThrow(
      'FALLO_SIMULADO_PROMOCION',
    );
  });
});

// ===========================================================================
// MULTI-TENANCY — el caso de uso propaga SIEMPRE el tenant y el usuario del comando (del JWT),
// nunca de otro sitio.
// ===========================================================================

describe('DescartarPreReservaUseCase — RLS por tenant + usuario del JWT', () => {
  it('debe_pasar_a_la_uow_el_tenant_y_usuario_recibidos_en_el_comando', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando({ tenantId: OTRO_TENANT, usuarioId: 'otro-gestor' }));

    expect(uow.descartar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT, usuarioId: 'otro-gestor' }),
    );
  });
});
