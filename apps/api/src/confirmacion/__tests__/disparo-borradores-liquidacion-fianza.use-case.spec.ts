/**
 * TESTS del DISPARO POST-COMMIT de los borradores de liquidación y fianza desde la
 * confirmación (US-027 / UC-21, UC-22) — fase TDD RED. tasks.md Fase 3: 3.9.
 *
 * Trazabilidad: US-027; spec-delta `confirmacion` (Requirement MODIFICADO "Inicialización de
 * los tres sub-procesos paralelos al confirmar", escenarios "La activación de los sub-procesos
 * dispara los borradores de liquidación y fianza tras el commit" y "El fallo al generar los
 * borradores no revierte la confirmación"); spec-delta `facturacion`. design.md §D-1
 * (efecto POSTERIOR al commit, atómico entre los dos documentos, NO dentro de la tx crítica
 * del FOR UPDATE; su fallo NO revierte la confirmación y es reintentable por idempotencia).
 *
 * Ejercita la APLICACIÓN `ConfirmarPagoSenalUseCase` contra DOBLES DE LOS PUERTOS (in-memory),
 * sin tocar Prisma (hexagonal, hook `no-infra-in-domain`). Fija que, TRAS el commit de la
 * confirmación (espejo del disparo de la factura de señal de US-022), se invoca el NUEVO
 * puerto post-commit `generarBorradoresLiquidacionFianza` y que su fallo NO revierte la
 * confirmación ya comprometida (la RESERVA permanece en `reserva_confirmada`).
 *
 * RED: `ConfirmarPagoSenalDeps` aún NO declara el puerto
 * `generarBorradoresLiquidacionFianza` ni el use-case lo invoca post-commit. La batería está
 * en ROJO por AUSENCIA DE IMPLEMENTACIÓN (el tipo del puerto no existe). GREEN es de
 * `backend-developer`.
 */
import {
  ConfirmarPagoSenalUseCase,
  type ConfirmarPagoSenalDeps,
  type ConfirmarPagoSenalComando,
  type GenerarBorradoresLiquidacionFianzaPort,
  type JustificanteSubido,
  type ReservaConfirmacion,
  type RepositoriosConfirmacion,
  type TenantSettingsConfirmacion,
  type UnidadDeTrabajoConfirmacionPort,
  type ClockPort,
} from '../application/confirmar-pago-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-pre';
const MB = 1024 * 1024;

const AHORA = new Date('2026-07-04T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-15T00:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

const reservaEnPreReserva = (
  over: Partial<ReservaConfirmacion> = {},
): ReservaConfirmacion => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'pre_reserva',
  subEstado: null,
  fechaEvento: FECHA_EVENTO,
  importeTotal: '3000.00',
  comentarios: null,
  ...over,
});

const settings: TenantSettingsConfirmacion = { pctSenal: 40 };

const justificanteValido = (over: Partial<JustificanteSubido> = {}): JustificanteSubido => ({
  nombreArchivo: 'justificante.pdf',
  mimeType: 'application/pdf',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('%PDF-1.4 fake'),
  ...over,
});

interface ReposFake extends RepositoriosConfirmacion {
  documentos: { crearJustificante: jest.Mock };
  reservas: { confirmarSenal: jest.Mock };
  fechaBloqueada: { upgradeAFirme: jest.Mock };
  fichaOperativa: { buscarPorReserva: jest.Mock; crearVacia: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (): ReposFake => ({
  documentos: {
    crearJustificante: jest.fn(async (d: Record<string, unknown>) => ({
      idDocumento: 'doc-1',
      tipo: 'justificante_pago',
      ...d,
    })),
  },
  reservas: { confirmarSenal: jest.fn(async () => undefined) },
  fechaBloqueada: { upgradeAFirme: jest.fn(async () => undefined) },
  fichaOperativa: {
    buscarPorReserva: jest.fn(async () => null),
    crearVacia: jest.fn(async () => ({ idFicha: 'ficha-1' })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoConfirmacionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosConfirmacion) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const montar = (opciones: {
  generarBorradoresImpl?: GenerarBorradoresLiquidacionFianzaPort;
} = {}) => {
  const repos = crearReposFake();
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reservaEnPreReserva());
  const almacenarJustificante = jest.fn(async () => 'https://docs/justificante-1.pdf');
  const presentarFacturaSenalBorrador = jest.fn(async () => undefined);
  const generarBorradoresLiquidacionFianza: GenerarBorradoresLiquidacionFianzaPort & jest.Mock =
    jest.fn(opciones.generarBorradoresImpl ?? (async () => undefined));
  const deps: ConfirmarPagoSenalDeps = {
    unidadDeTrabajo: uow,
    tenantSettings: { obtener: jest.fn(async () => settings) },
    cargarReserva,
    almacenarJustificante,
    presentarFacturaSenalBorrador,
    generarBorradoresLiquidacionFianza,
    clock: relojFijo,
  };
  return {
    useCase: new ConfirmarPagoSenalUseCase(deps),
    repos,
    presentarFacturaSenalBorrador,
    generarBorradoresLiquidacionFianza,
    deps,
  };
};

const comando = (
  over: Partial<ConfirmarPagoSenalComando> = {},
): ConfirmarPagoSenalComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  justificante: justificanteValido(),
  ...over,
});

// ===========================================================================
// 3.9 — La activación de los sub-procesos dispara los borradores TRAS el commit.
// ===========================================================================

describe('ConfirmarPagoSenal — dispara los borradores de liquidación/fianza post-commit (3.9)', () => {
  it('debe_invocar_la_generacion_de_borradores_de_liquidacion_y_fianza_tras_confirmar', async () => {
    const { useCase, generarBorradoresLiquidacionFianza } = montar();

    await useCase.ejecutar(comando());

    expect(generarBorradoresLiquidacionFianza).toHaveBeenCalledTimes(1);
    expect(generarBorradoresLiquidacionFianza).toHaveBeenCalledWith({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
    });
  });

  it('debe_generar_los_borradores_DESPUES_del_commit_de_la_confirmacion', async () => {
    const orden: string[] = [];
    const { useCase, repos, generarBorradoresLiquidacionFianza } = montar();
    repos.reservas.confirmarSenal.mockImplementation(async () => {
      orden.push('commit');
    });
    generarBorradoresLiquidacionFianza.mockImplementation(async () => {
      orden.push('borradores');
    });

    await useCase.ejecutar(comando());

    // La generación de borradores es POSTERIOR a la mutación transaccional (§D-1).
    expect(orden.indexOf('borradores')).toBeGreaterThan(orden.indexOf('commit'));
  });
});

// ===========================================================================
// 3.9 — El fallo de la generación de borradores NO revierte la confirmación
//        (post-commit): la RESERVA permanece confirmada y la operación resuelve.
// ===========================================================================

describe('ConfirmarPagoSenal — el fallo de los borradores no revierte la confirmación (3.9)', () => {
  it('no_debe_revertir_la_confirmacion_si_la_generacion_de_borradores_falla', async () => {
    const { useCase, repos } = montar({
      generarBorradoresImpl: async () => {
        throw new Error('US-027 generación transitoriamente caída');
      },
    });

    // El fallo post-commit NO propaga: la confirmación ya está comprometida.
    const resultado = await useCase.ejecutar(comando());

    expect(resultado.estado).toBe('reserva_confirmada');
    // La transición de la RESERVA se commiteó igualmente (no se revierte).
    expect(repos.reservas.confirmarSenal).toHaveBeenCalledTimes(1);
  });

  it('debe_disparar_los_borradores_de_forma_independiente_de_la_factura_de_senal', async () => {
    // El disparo de US-027 no depende del de US-022: ambos son efectos post-commit.
    const { useCase, presentarFacturaSenalBorrador, generarBorradoresLiquidacionFianza } =
      montar();

    await useCase.ejecutar(comando());

    expect(presentarFacturaSenalBorrador).toHaveBeenCalledTimes(1);
    expect(generarBorradoresLiquidacionFianza).toHaveBeenCalledTimes(1);
  });
});
