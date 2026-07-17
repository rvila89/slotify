/**
 * TESTS DE INTEGRACIÓN del FORZADO MANUAL del inicio de evento (US-032 / UC-23 FA-01,
 * actor Gestor) — fase QA. Cubre la brecha que el `backend-developer` señaló: ni el
 * controller-http.spec (dobla el use-case, no toca Prisma) ni el concurrencia.spec (solo
 * CUENTA transiciones) asertan la FORMA del `AUDIT_LOG` en la fila real ni la
 * inmutabilidad de los sub-procesos (D-5).
 *
 * Trazabilidad: US-032, spec-delta `consultas` (Requirements "La transición forzada se
 * registra en AUDIT_LOG con origen Usuario y forzado_por_gestor = true", "El forzado no
 * resuelve ni modifica los sub-procesos incumplidos", "El forzado solo está disponible el
 * día del evento", "Cron llegó primero — idempotencia"); design.md §D-1/§D-2/§D-4/§D-5.
 *
 * Es un test de INTEGRACIÓN: ejercita el caso de uso REAL `ForzarInicioEventoUseCase`
 * contra los adaptadores Prisma (carga bajo RLS + UoW con `$transaction` + `SET LOCAL
 * app.tenant_id` + `SELECT … FOR UPDATE` + UPDATE condicional + AUDIT_LOG tx-bound) sobre
 * el Postgres AISLADO de tests (`slotify_test`, `.env.test`). SIN Redis ni locks
 * distribuidos. Requiere Postgres arriba + seed del tenant piloto.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  EstadoReserva,
  FianzaStatus,
  LiquidacionStatus,
  PreEventoStatus,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ForzarInicioEventoUseCase,
  type ForzarInicioEventoComando,
} from '../application/forzar-inicio-evento.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
// Gestor sembrado por prisma/seed.ts (FK audit_log_usuario_id_fkey).
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const EMAIL_PATTERN = '@us032-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Fecha de calendario a mediodía UTC relativa a hoy (evita off-by-one de TZ). */
const aMediodiaUTC = (offsetDias: number): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return new Date(base.getTime() + offsetDias * DIA_MS);
};
const HOY = aMediodiaUTC(0);
const MANANA = aMediodiaUTC(1);

let moduleRef: TestingModule;
let prisma: PrismaService;
let forzar: ForzarInicioEventoUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

interface SembrarOpts {
  estado?: EstadoReserva;
  fechaEvento?: Date;
  liquidacionStatus?: LiquidacionStatus;
}

/**
 * Siembra una RESERVA. Por defecto: `reserva_confirmada`, fecha hoy, con `liquidacion_status
 * = facturada` (una precondición incumplida) — el caso canónico del forzado que US-031 no
 * iniciaría.
 */
const sembrar = async (opts: SembrarOpts = {}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Int', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U032I-${sufijo()}`,
      estado: opts.estado ?? EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: opts.fechaEvento ?? HOY,
      preEventoStatus: PreEventoStatus.cerrado,
      liquidacionStatus: opts.liquidacionStatus ?? LiquidacionStatus.facturada,
      fianzaStatus: FianzaStatus.cobrada,
      condPartFirmadas: true,
    },
  });
  return reserva.idReserva;
};

const comando = (reservaId: string): ForzarInicioEventoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
});

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });
const transiciones = (reservaId: string) =>
  prisma.auditLog.findMany({ where: { entidadId: reservaId, accion: 'transicion' } });

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
  forzar = moduleRef.get(ForzarInicioEventoUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

describe('Forzar inicio US-032 — integración: AUDIT_LOG y D-5 contra Postgres real', () => {
  it('fuerza la transición y persiste el AUDIT_LOG con la evidencia del override (D-4)', async () => {
    const reservaId = await sembrar();

    const resultado = await forzar.ejecutar(comando(reservaId));

    expect(resultado).toMatchObject({
      estado: 'evento_en_curso',
      forzadoPorGestor: true,
      precondicionesIncumplidas: ['liquidacion_status'],
    });
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);

    const filas = await transiciones(reservaId);
    expect(filas).toHaveLength(1);
    const auditoria = filas[0];
    expect(auditoria.accion).toBe('transicion');
    expect(auditoria.entidad).toBe('RESERVA');
    // Origen USUARIO: el usuario_id del gestor poblado (a diferencia de US-031, Sistema).
    expect(auditoria.usuarioId).toBe(GESTOR);
    expect(auditoria.tenantId).toBe(TENANT);
    expect(auditoria.datosAnteriores).toEqual({ estado: 'reserva_confirmada' });
    expect(auditoria.datosNuevos).toEqual({
      estado: 'evento_en_curso',
      forzado_por_gestor: true,
      precondiciones_incumplidas: ['liquidacion_status'],
    });
  });

  it('no resuelve los sub-procesos incumplidos: los tres *_status quedan intactos (D-5)', async () => {
    const reservaId = await sembrar();

    await forzar.ejecutar(comando(reservaId));

    const reserva = await leerReserva(reservaId);
    expect(reserva?.estado).toBe(EstadoReserva.evento_en_curso);
    // Solo muta `estado`: los sub-procesos conservan su valor previo al forzado.
    expect(reserva?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect(reserva?.liquidacionStatus).toBe(LiquidacionStatus.facturada);
    expect(reserva?.fianzaStatus).toBe(FianzaStatus.cobrada);
  });

  it('rechaza con fecha_evento_no_es_hoy sin efectos cuando la fecha no es hoy (422)', async () => {
    const reservaId = await sembrar({ fechaEvento: MANANA });

    await expect(forzar.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'fecha_evento_no_es_hoy',
    });

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_confirmada);
    expect(await transiciones(reservaId)).toHaveLength(0);
  });

  it('es idempotente: forzar una reserva ya en evento_en_curso da conflicto sin doble auditoría (409)', async () => {
    const reservaId = await sembrar({ estado: EstadoReserva.evento_en_curso });

    await expect(forzar.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'conflicto_estado',
    });

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);
    expect(await transiciones(reservaId)).toHaveLength(0);
  });
});
