/**
 * TESTS DE INTEGRACIÓN del ARCHIVADO MANUAL del gestor (US-038 / UC-28 flujo alternativo
 * manual) — fase TDD RED. tasks.md Fase 4: 4.2 (happy path + AUDIT_LOG origen Gestor en BD),
 * 4.3 (sin filtro T+7d), 4.4 (FA-01/FA-02 fianza no resuelta bloquea), 4.5 (origen inválido /
 * idempotencia / 2.ª ejecución), 4.6 (RLS multi-tenant → 404).
 *
 * ⚠️ REQUIERE POSTGRES REAL — NO EJECUTAR EN SUBAGENTES (memoria "Subagentes sin
 * Docker/Postgres"). Se lanza desde la SESIÓN PRINCIPAL con el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`; memoria "Tests con BD aislada slotify_test").
 *
 * Trazabilidad: US-038; spec-delta `consultas` (Requirements: "Archivado manual …", "La
 * condición de fianza resuelta … idéntica a la del automático (US-037)", "Bloqueo del
 * archivado manual con fianza no resuelta …", "La auditoría del archivado manual registra el
 * origen Gestor con usuario_id", "Idempotencia y concurrencia …"); design.md §D-1=1.A
 * (`fijarTenant` + `SELECT … FOR UPDATE` sobre UNA RESERVA del tenant del JWT), §D-3=3.B
 * (fianza no resuelta → `FianzaNoResueltaError`/422), §D-5 (auditoría origen GESTOR con
 * `usuario_id` NO nulo — a diferencia de US-037, que audita Sistema con `usuario_id` nulo y
 * `causa:'T+7d'`).
 *
 * INTEGRACIÓN REAL contra el Postgres AISLADO (NO mocks — memoria "US-049 backend nunca
 * probado contra BD real"): la transición y el AUDIT_LOG se verifican por el ESTADO DE LA BD.
 * Ejercita el caso de uso REAL `ArchivarReservaManualUseCase` contra su adaptador Prisma
 * (`$transaction` + `SET LOCAL app.tenant_id` + `SELECT … FOR UPDATE` + re-evaluación de
 * `resolverArchivadoAutomatico` y `fianzaResuelta` bajo el lock). SIN Redis ni locks
 * distribuidos. Emails/reservas propios; se limpia el sembrado; NO depende del deadlock 40P01
 * flaky de US-004 (US-038 no toca FECHA_BLOQUEADA).
 *
 * RED: aún NO existen `application/archivar-reserva-manual.use-case.ts`, su adaptador de UoW
 * ni su registro en `ReservasModule`; los imports/símbolos fallan y la batería está en ROJO
 * por AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba: no es fallo de infra). GREEN es de
 * `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AccionAudit, CanalEntrada, EstadoReserva, FianzaStatus } from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ArchivarReservaManualUseCase,
  ReservaNoEncontradaError,
  TransicionNoPermitidaError,
  FianzaNoResueltaError,
  type ArchivarReservaManualComando,
} from '../application/archivar-reserva-manual.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us038-int.test';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ArchivarReservaManualUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/** Siembra una RESERVA con estado/fianza indicados y un CLIENTE con email propio. */
const sembrar = async (params: {
  estado?: EstadoReserva;
  fianzaStatus?: FianzaStatus;
  fianzaEur?: string | null;
  fianzaDevueltaEur?: string | null;
  fechaPostEvento?: Date | null;
  tenantId?: string;
} = {}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: { tenantId, nombre: 'Int38', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U038I-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.post_evento,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2026-06-20T00:00:00.000Z'),
      // El manual NO exige antigüedad: por defecto la RESERVA entró en post_evento HOY.
      fechaPostEvento:
        params.fechaPostEvento === undefined ? new Date() : params.fechaPostEvento,
      fianzaStatus: params.fianzaStatus ?? FianzaStatus.devuelta,
      fianzaEur: params.fianzaEur === undefined ? '300.00' : params.fianzaEur,
      fianzaDevueltaEur: params.fianzaDevueltaEur ?? null,
    },
  });
  return reserva.idReserva;
};

const comando = (
  reservaId: string,
  over: Partial<ArchivarReservaManualComando> = {},
): ArchivarReservaManualComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  ...over,
});

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });
const transicionesDe = (reservaId: string) =>
  prisma.auditLog.findMany({
    where: { entidadId: reservaId, accion: AccionAudit.transicion },
  });
const contarTransiciones = (reservaId: string): Promise<number> =>
  prisma.auditLog.count({ where: { entidadId: reservaId, accion: AccionAudit.transicion } });

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { clienteId: { in: clienteIds } },
    select: { idReserva: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (clienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ArchivarReservaManualUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 4.2 (BD) — Happy path: post_evento + fianza devuelta → estado = reserva_completada +
//        AUDIT_LOG transición ORIGEN GESTOR (usuario_id = <gestor>, NO nulo),
//        datos_anteriores={estado:post_evento}, datos_nuevos={estado:reserva_completada}.
// ===========================================================================

describe('Archivado manual US-038 — happy path: archiva y audita origen Gestor (4.2 BD)', () => {
  it('debe_transicionar_a_reserva_completada_y_auditar_transicion_origen_Gestor', async () => {
    const reservaId = await sembrar({
      fianzaStatus: FianzaStatus.devuelta,
      fianzaEur: '300.00',
    });

    const resultado = await useCase.ejecutar(comando(reservaId));
    expect(resultado.estado).toBe('reserva_completada');

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);

    const transiciones = await transicionesDe(reservaId);
    expect(transiciones.length).toBe(1);
    const t = transiciones[0];
    expect(t.entidad).toBe('RESERVA');
    // Diferencia clave con US-037: usuario_id POBLADO (origen Gestor), no nulo.
    expect(t.usuarioId).toBe(GESTOR);
    expect(JSON.stringify(t.datosAnteriores)).toContain('post_evento');
    expect(JSON.stringify(t.datosNuevos)).toContain('reserva_completada');
    // NO lleva la causa 'T+7d' del archivado automático (US-037).
    expect(JSON.stringify(t.datosNuevos)).not.toContain('T+7d');
  });
});

// ===========================================================================
// 4.2/4.3 (BD) — Sin fianza (eur=0/null), retención total y SIN filtro T+7d archivan por la
//        guarda de fianza satisfecha, aunque la RESERVA entró en post_evento HOY.
// ===========================================================================

describe('Archivado manual US-038 — sin fianza / retención total / sin T+7d archivan (4.2/4.3 BD)', () => {
  it('debe_archivar_sin_fianza_eur_0_aunque_el_status_sea_cobrada', async () => {
    const reservaId = await sembrar({
      fianzaStatus: FianzaStatus.cobrada,
      fianzaEur: '0.00',
    });

    await useCase.ejecutar(comando(reservaId));

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);
  });

  it('debe_archivar_retenida_parcial_con_devuelta_eur_0_retencion_100', async () => {
    const reservaId = await sembrar({
      fianzaStatus: FianzaStatus.retenida_parcial,
      fianzaEur: '500.00',
      fianzaDevueltaEur: '0.00',
    });

    await useCase.ejecutar(comando(reservaId));

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);
  });

  it('debe_archivar_una_post_evento_recien_finalizada_sin_exigir_7_dias', async () => {
    // fechaPostEvento = HOY (por defecto): el manual NO aplica el filtro T+7d de US-037.
    const reservaId = await sembrar({ fechaPostEvento: new Date() });

    await useCase.ejecutar(comando(reservaId));

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);
  });
});

// ===========================================================================
// 4.4 (BD) — FA-01/FA-02: fianza NO resuelta (cobrada/recibo_enviado con eur>0) → NO
//        transiciona (permanece post_evento), 0 auditorías de transición,
//        FianzaNoResueltaError. La RESERVA queda intacta.
// ===========================================================================

describe('Archivado manual US-038 — fianza no resuelta bloquea sin efectos (4.4 BD)', () => {
  it('no_debe_transicionar_ni_auditar_cuando_la_fianza_esta_cobrada_sin_resolver', async () => {
    const reservaId = await sembrar({
      fianzaStatus: FianzaStatus.cobrada,
      fianzaEur: '300.00',
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      FianzaNoResueltaError,
    );

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(await contarTransiciones(reservaId)).toBe(0);
  });

  it('no_debe_transicionar_cuando_la_fianza_esta_en_recibo_enviado', async () => {
    const reservaId = await sembrar({
      fianzaStatus: FianzaStatus.recibo_enviado,
      fianzaEur: '300.00',
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      FianzaNoResueltaError,
    );

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(await contarTransiciones(reservaId)).toBe(0);
  });
});

// ===========================================================================
// 4.5 (BD) — Origen inválido / idempotencia: (a) RESERVA en estado ≠ post_evento (incl. ya
//        reserva_completada) → TransicionNoPermitidaError, sin mutar ni auditar; (b) 2.ª
//        ejecución tras archivar → 409 sin duplicar AUDIT_LOG.
// ===========================================================================

describe('Archivado manual US-038 — origen inválido / idempotencia (4.5 BD)', () => {
  const noPostEvento: ReadonlyArray<EstadoReserva> = [
    EstadoReserva.consulta,
    EstadoReserva.pre_reserva,
    EstadoReserva.reserva_confirmada,
    EstadoReserva.evento_en_curso,
    EstadoReserva.reserva_cancelada,
    EstadoReserva.reserva_completada,
  ];

  it.each(noPostEvento)(
    'no_debe_archivar_una_reserva_en_%s_ni_auditar',
    async (estado) => {
      const reservaId = await sembrar({ estado });

      await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
        TransicionNoPermitidaError,
      );

      expect((await leerReserva(reservaId))?.estado).toBe(estado);
      expect(await contarTransiciones(reservaId)).toBe(0);
    },
  );

  it('no_debe_re_archivar_ni_duplicar_auditoria_en_una_segunda_ejecucion', async () => {
    const reservaId = await sembrar({
      fianzaStatus: FianzaStatus.devuelta,
      fianzaEur: '300.00',
    });

    await useCase.ejecutar(comando(reservaId));
    // 2.ª ejecución: ya en reserva_completada → guarda de origen null → 409.
    await expect(useCase.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'transicion_no_permitida',
    });

    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});

// ===========================================================================
// 4.6 (BD) — RLS multi-tenant: una RESERVA de OTRO tenant es invisible bajo el RLS del
//        tenant del JWT → ReservaNoEncontradaError (404), sin mutar ni auditar.
// ===========================================================================

describe('Archivado manual US-038 — RLS: reserva de otro tenant → 404 (4.6 BD)', () => {
  it('no_debe_resolver_ni_tocar_una_reserva_de_otro_tenant', async () => {
    const reservaId = await sembrar({ tenantId: OTRO_TENANT });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    // Intacta bajo su propio tenant.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(await contarTransiciones(reservaId)).toBe(0);
  });
});
