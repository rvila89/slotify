/**
 * TESTS DE CONCURRENCIA REAL de la DEVOLUCIÓN COMPLETA de la fianza
 * (fix-liquidacion-fianza-independientes / UC-27). ZONA CRÍTICA: la relectura
 * `SELECT ... FOR UPDATE` sobre la RESERVA (`DevolverFianzaUoWPrismaAdapter`) SERIALIZA el
 * doble registro concurrente por LOCK DE FILA de PostgreSQL — nunca locks distribuidos
 * (CLAUDE.md §Regla crítica, hook `no-distributed-lock`). Dos `devolver` simultáneos sobre la
 * MISMA reserva: exactamente UNO gana; el otro, al releer bajo el lock una fila ya `devuelta`,
 * es rechazado como doble registro (`DevolucionYaRegistradaError`). Estado final: `devuelta`
 * con un ÚNICO AUDIT_LOG y una ÚNICA COMUNICACION E10 (la del ganador).
 *
 * skill `concurrency-locking`: `Promise.allSettled()`, exactamente 1 fulfilled + 1 rejected,
 * resultado sin duplicados. INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del
 * docker-compose (no mocks): se ejercitan los adaptadores Prisma reales, incluido el raw del
 * FOR UPDATE (que antes del fix del `::uuid` lanzaba 42883 contra la BD real). BD aislada
 * `slotify_test` (`.env.test`); códigos/emails propios no compartidos con otras suites para ser
 * DETERMINISTA (memoria: US-004 deadlock flaky / BD aislada). El transporte de email va en modo
 * FAKE en `test` (`FakeEmailAdapter`, cero red).
 *
 * ESPEJO del harness de `generar-factura-senal-concurrencia.spec.ts` (bootstrap `moduleRef`,
 * sembrado/limpieza Prisma real, tenant piloto `...001`, gestor `...002`).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  CodigoEmail,
  DuracionHoras,
  EstadoReserva,
  FianzaStatus,
  TipoEvento,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  DevolverFianzaUseCase,
  DevolucionYaRegistradaError,
  type DevolverFianzaComando,
} from '../application/devolver-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@devfianza-conc.test';
const CODIGO_PREFIX = 'TST-DEVFC-';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: DevolverFianzaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string): DevolverFianzaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
});

/** Siembra una RESERVA `post_evento` con `fianza_status='cobrada'` y `fianza_eur>0`, lista
 *  para devolver (CLIENTE con email para que E10 tenga destinatario). Fechas propias. */
const sembrarReservaDevolvible = async (params: { fecha: Date }): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Conc',
      apellidos: 'Fianza',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
      dniNif: '12345678Z',
      direccion: 'C/ Mayor 1',
      codigoPostal: '08001',
      poblacion: 'Barcelona',
      provincia: 'Barcelona',
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `${CODIGO_PREFIX}${sufijo()}`,
      estado: EstadoReserva.post_evento,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '6000.00',
      importeSenal: '2400.00',
      importeLiquidacion: '3600.00',
      fianzaStatus: FianzaStatus.cobrada,
      fianzaEur: '500.00',
      fianzaDevueltaFecha: null,
      ttlExpiracion: null,
    },
  });
  return reserva.idReserva;
};

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: {
      OR: [{ clienteId: { in: clienteIds } }, { codigo: { startsWith: CODIGO_PREFIX } }],
    },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.documento.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.pago.deleteMany({ where: { factura: { reservaId: { in: ids } } } });
    await prisma.factura.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), FacturacionModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(DevolverFianzaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Doble devolver concurrente de la MISMA reserva: FOR UPDATE serializa →
// exactamente 1 OK + 1 rechazo (doble registro); estado final `devuelta`,
// un único AUDIT_LOG y un único E10 (del ganador).
// ===========================================================================

describe('DevolverFianza — doble registro concurrente de la misma reserva (FOR UPDATE)', () => {
  it('debe_permitir_un_devolver_y_rechazar_el_segundo_cuando_son_concurrentes', async () => {
    const reservaId = await sembrarReservaDevolvible({
      fecha: new Date(Date.UTC(2029, 8, 12)),
    });

    // Dos devoluciones SIMULTÁNEAS sobre la misma reserva.
    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // Exactamente uno cumple, exactamente uno se rechaza (serialización FOR UPDATE).
    const cumplidos = resultados.filter((r) => r.status === 'fulfilled');
    const rechazados = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidos).toHaveLength(1);
    expect(rechazados).toHaveLength(1);

    // El rechazo es el doble registro (nunca un 42883 ni un error de infra).
    const [rechazo] = rechazados as PromiseRejectedResult[];
    expect(rechazo.reason).toBeInstanceOf(DevolucionYaRegistradaError);
  });

  it('debe_dejar_la_reserva_devuelta_con_un_unico_audit_y_un_unico_E10', async () => {
    const reservaId = await sembrarReservaDevolvible({
      fecha: new Date(Date.UTC(2029, 8, 13)),
    });

    await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // Estado final consolidado: devuelta con fecha.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fianzaStatus).toBe(FianzaStatus.devuelta);
    expect(reserva?.fianzaDevueltaFecha).not.toBeNull();

    // Un ÚNICO AUDIT_LOG de la devolución (el del ganador; el perdedor abortó su tx).
    const audits = await prisma.auditLog.count({
      where: { entidadId: reservaId, entidad: 'RESERVA', accion: 'actualizar' },
    });
    expect(audits).toBe(1);

    // Una ÚNICA COMUNICACION E10 (el post-commit best-effort solo lo dispara el ganador).
    const e10 = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E10 },
    });
    expect(e10).toBe(1);
  });
});
