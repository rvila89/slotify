/**
 * TESTS DE ATOMICIDAD all-or-nothing de la PROMOCIÓN de cola (US-018 / UC-12, A15) —
 * fase TDD RED. tasks.md Fase 3: 3.2/3.4 (invariante de atomicidad del spec).
 *
 * Trazabilidad: US-018, spec-delta `consultas` (Requirement "Promoción atómica
 * all-or-nothing sin estado intermedio observable": transición + re-bloqueo +
 * reordenación + auditoría en UNA transacción; si algún paso falla, rollback
 * completo; en ningún instante `FECHA_BLOQUEADA` queda sin apuntar a una bloqueante
 * viva ni la cola con un hueco); design.md §D-4 (atomicidad solo PostgreSQL),
 * §Riesgos (fallo del re-bloqueo tras mutar la promovida → rollback completo).
 *
 * INTEGRACIÓN contra el Postgres AISLADO de tests (`slotify_test`, `.env.test`). Se
 * FUERZA el fallo del re-bloqueo interponiendo un bloqueo PRE-EXISTENTE de OTRA
 * reserva sobre la misma `(tenant, fecha)`: el `UNIQUE(tenant_id, fecha)` (US-040)
 * hace fallar `bloquearFecha()` A MITAD de la promoción; la transacción DEBE revertir
 * por completo (la promovida sigue en 2d, la cola conserva su orden, no hay fila de
 * FECHA_BLOQUEADA a medio crear apuntando a la promovida). NO usa Redis ni locks
 * distribuidos.
 *
 * RED: aún NO existen `PromoverPrimeroEnColaService` ni el adaptador Prisma real (el
 * binding sigue en el stub no-op, que ni promueve ni falla). Las aserciones de
 * rollback FALLAN por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  EstadoReserva,
  SubEstadoConsulta,
  TipoBloqueo,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { PromoverPrimeroEnColaService } from '../application/promover-primero-en-cola.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us018-atom.test';

const F_CONFLICTO = new Date('2029-08-01T00:00:00.000Z');
const TODAS = [F_CONFLICTO];

let moduleRef: TestingModule;
let prisma: PrismaService;
let promocion: PromoverPrimeroEnColaService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const crearReserva = async (
  subEstado: SubEstadoConsulta,
  over: Record<string, unknown> = {},
): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Atom', email: `a-${sufijo()}${EMAIL_PATTERN}` },
  });
  const r = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U018A-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: F_CONFLICTO,
      ...over,
    },
  });
  return r.idReserva;
};

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: TODAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const allClientes = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.updateMany({
      where: { idReserva: { in: ids } },
      data: { consultaBloqueanteId: null, posicionCola: null },
    });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: { in: TODAS } } });
  if (allClientes.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: allClientes } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  promocion = moduleRef.get(PromoverPrimeroEnColaService);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Fallo del re-bloqueo a mitad → rollback TOTAL: la promovida sigue en 2d, la cola
// conserva su orden, no hay fila de FECHA_BLOQUEADA apuntando a la promovida.
// ===========================================================================

describe('Promoción US-018 — atomicidad all-or-nothing (rollback en fallo del re-bloqueo)', () => {
  it('debe_revertir_todo_si_el_re_bloqueo_choca_con_un_bloqueo_pre_existente_de_la_fecha', async () => {
    // Bloqueante liberada (2x) + cola R2 (pos 1) y R3 (pos 2) apuntando a ella.
    const bloqueanteId = await crearReserva(SubEstadoConsulta.s2x);
    const r2 = await crearReserva(SubEstadoConsulta.s2d, {
      consultaBloqueanteId: bloqueanteId,
      posicionCola: 1,
    });
    const r3 = await crearReserva(SubEstadoConsulta.s2d, {
      consultaBloqueanteId: bloqueanteId,
      posicionCola: 2,
    });

    // INTERPONE un bloqueo PRE-EXISTENTE de OTRA reserva (intruso) sobre (T, F): el
    // UNIQUE(tenant, fecha) hará fallar el re-bloqueo de la promoción a mitad.
    const intrusoId = await crearReserva(SubEstadoConsulta.s2b);
    await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: F_CONFLICTO,
        reservaId: intrusoId,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // La promoción intenta re-bloquear y choca con el UNIQUE → debe abortar sin dejar
    // estado a medias (no exigimos que lance o no; exigimos el INVARIANTE de rollback).
    await promocion
      .promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_CONFLICTO })
      .catch(() => undefined);

    // ROLLBACK TOTAL: R2 sigue en 2d con su posición y bloqueante originales.
    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(pr2?.posicionCola).toBe(1);
    expect(pr2?.consultaBloqueanteId).toBe(bloqueanteId);

    // R3 conserva su orden (sin decremento a medias).
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    expect(pr3?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(pr3?.posicionCola).toBe(2);
    expect(pr3?.consultaBloqueanteId).toBe(bloqueanteId);

    // La única fila de FECHA_BLOQUEADA de (T, F) sigue siendo la del intruso; no se
    // creó una a medio apuntar a la promovida.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_CONFLICTO },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].reservaId).toBe(intrusoId);
  });
});
