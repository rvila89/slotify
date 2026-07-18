/**
 * TESTS DE INTEGRACIÓN de la operación atómica «cambiar fecha ya bloqueada» (US-051
 * §Punto 2 / UC-05/UC-12/UC-18) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-051, spec-delta `consultas` (Requirement "Cambio atómico de una fecha
 * ya bloqueada", escenarios "Cambiar a una fecha libre libera la antigua y bloquea la
 * nueva atómicamente" y "La fecha nueva ocupada aborta el cambio sin efectos"); design.md
 * §D-2.1 (`SELECT … FOR UPDATE` sobre RESERVA y FECHA_BLOQUEADA(fecha_nueva), rollback
 * total si la nueva está ocupada), §D-2.2 (aislamiento de fallos: si falla el bloqueo de
 * la nueva, la antigua permanece intacta).
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose / `slotify_test` (no mocks): el
 * caso de uso se resuelve por DI (`ReservasModule`) y se verifica el ESTADO DE LA BD tras
 * la operación. Mismo enfoque que `transicion-fecha-integracion.spec.ts`. Requiere
 * `docker compose up -d postgres` + migración + seed (tenant piloto).
 *
 * RED: aún NO existe `application/cambiar-fecha.use-case.ts` ni su binding en el módulo.
 * El import falla en compilación y la batería entera está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba). GREEN es de
 * `backend-developer`.
 *
 * NOTA sesión principal: este spec REQUIERE Postgres real; NO corre en subagentes sin BD.
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
import {
  CambiarFechaUseCase,
  CambiarFechaConflictoError,
  CambiarFechaValidacionError,
  ReservaNoEncontradaError,
  type CambiarFechaComando,
} from '../application/cambiar-fecha.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us051-int.test';

const F1_FELIZ = new Date('2028-05-01T00:00:00.000Z'); // antigua (camino feliz)
const F2_FELIZ = new Date('2028-05-02T00:00:00.000Z'); // nueva libre (camino feliz)
const F1_OCUPADA = new Date('2028-05-03T00:00:00.000Z'); // antigua (rollback)
const F2_OCUPADA = new Date('2028-05-04T00:00:00.000Z'); // nueva ocupada por otra (rollback)
const F1_GUARDA = new Date('2028-05-05T00:00:00.000Z'); // antigua para guardas
const F2_GUARDA = new Date('2028-05-06T00:00:00.000Z'); // nueva para guardas
const F1_TENANT = new Date('2028-05-07T00:00:00.000Z'); // antigua cross-tenant
const F2_TENANT = new Date('2028-05-08T00:00:00.000Z'); // nueva cross-tenant
const hoyUtc = (): Date => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};
const FECHAS = [
  F1_FELIZ,
  F2_FELIZ,
  F1_OCUPADA,
  F2_OCUPADA,
  F1_GUARDA,
  F2_GUARDA,
  F1_TENANT,
  F2_TENANT,
  hoyUtc(),
];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: CambiarFechaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<CambiarFechaComando> = {},
): CambiarFechaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  fechaEvento: F2_FELIZ,
  ...over,
});

/** Siembra RESERVA con su CLIENTE (+ opcionalmente su FECHA_BLOQUEADA sobre `fechaEvento`). */
const sembrarReserva = async (params: {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fecha?: Date;
  conBloqueo?: boolean;
  tenantId?: string;
}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: { tenantId, nombre: 'Origen', email: `o-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U051-${sufijo()}`,
      estado: params.estado,
      subEstado: params.subEstado,
      canalEntrada: CanalEntrada.web,
      ...(params.fecha !== undefined ? { fechaEvento: params.fecha } : {}),
      ...(params.conBloqueo ? { ttlExpiracion: new Date('2028-12-31') } : {}),
    },
  });
  if (params.conBloqueo && params.fecha !== undefined) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: new Date('2028-12-31'),
      },
    });
  }
  return reserva.idReserva;
};

const contarBloqueos = (fecha: Date): Promise<number> =>
  prisma.fechaBloqueada.count({ where: { tenantId: TENANT, fecha } });

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const allClientes = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { fecha: { in: FECHAS } } });
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
  useCase = moduleRef.get(CambiarFechaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Escenario 1 — Cambiar a fecha LIBRE: en UNA transacción bloquea F2, actualiza
//   RESERVA.fecha=F2 y libera F1; estado/subEstado se conservan; audita F1→F2.
// ===========================================================================

describe('CambiarFecha — camino feliz: mover a F2 libre atómicamente (escenario 1)', () => {
  it('debe_bloquear_F2_actualizar_la_fecha_liberar_F1_conservar_estado_y_auditar', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: F1_FELIZ,
      conBloqueo: true,
    });

    await useCase.ejecutar(comando(reservaId, { fechaEvento: F2_FELIZ }));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    // La RESERVA apunta a F2 y conserva estado/subEstado 2.b.
    expect(reserva?.fechaEvento).toEqual(F2_FELIZ);
    expect(reserva?.estado).toBe(EstadoReserva.consulta);
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);

    // F2 queda bloqueada por esta RESERVA; F1 queda LIBRE (liberada).
    expect(await contarBloqueos(F2_FELIZ)).toBe(1);
    expect(await contarBloqueos(F1_FELIZ)).toBe(0);
    const bloqueoNuevo = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: F2_FELIZ },
    });
    expect(bloqueoNuevo?.reservaId).toBe(reservaId);

    // AUDIT_LOG accion='actualizar', entidad='RESERVA', con F1 (anterior) y F2 (nueva).
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'actualizar' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entidad).toBe('RESERVA');
  });
});

// ===========================================================================
// Escenario 4 — Fecha nueva OCUPADA por otra RESERVA: rechazo con conflicto (409),
//   rollback total (RESERVA conserva F1, F1 sigue bloqueada, F2 sigue de la otra).
// ===========================================================================

describe('CambiarFecha — fecha nueva ocupada aborta sin efectos (escenario 4, rollback)', () => {
  it('debe_rechazar_con_conflicto_y_no_tocar_la_reserva_ni_las_fechas', async () => {
    // Otra RESERVA ya bloquea F2_OCUPADA.
    await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: F2_OCUPADA,
      conBloqueo: true,
    });
    // La RESERVA que intenta moverse desde F1_OCUPADA a la ya ocupada F2_OCUPADA.
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: F1_OCUPADA,
      conBloqueo: true,
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaEvento: F2_OCUPADA })),
    ).rejects.toBeInstanceOf(CambiarFechaConflictoError);

    // Rollback total: la RESERVA conserva F1_OCUPADA y su bloqueo; F2 sigue de la otra.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fechaEvento).toEqual(F1_OCUPADA);
    expect(await contarBloqueos(F1_OCUPADA)).toBe(1);
    const bloqueoAntiguo = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: F1_OCUPADA },
    });
    expect(bloqueoAntiguo?.reservaId).toBe(reservaId);
    // La fecha ocupada sigue con UN solo bloqueo (el de la otra RESERVA, sin duplicar).
    expect(await contarBloqueos(F2_OCUPADA)).toBe(1);

    // No se registró AUDIT_LOG de actualización para la RESERVA que falló.
    const audit = await prisma.auditLog.count({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'actualizar' },
    });
    expect(audit).toBe(0);
  });
});

// ===========================================================================
// Guarda de ORIGEN — solo 2b/2c/2v; 2a/2d/terminales/pre_reserva → 422 sin efectos.
// ===========================================================================

describe('CambiarFecha — guarda de origen (solo consulta 2b/2c/2v)', () => {
  it('debe_rechazar_422_desde_2a_sin_fecha_bloqueada_y_no_bloquear_F2', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaEvento: F2_GUARDA })),
    ).rejects.toBeInstanceOf(CambiarFechaValidacionError);

    expect(await contarBloqueos(F2_GUARDA)).toBe(0);
  });

  it('debe_rechazar_422_desde_pre_reserva_sin_tocar_la_reserva', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.pre_reserva,
      subEstado: null,
      fecha: F1_GUARDA,
      conBloqueo: true,
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaEvento: F2_GUARDA })),
    ).rejects.toBeInstanceOf(CambiarFechaValidacionError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fechaEvento).toEqual(F1_GUARDA);
    expect(await contarBloqueos(F2_GUARDA)).toBe(0);
  });
});

// ===========================================================================
// Validación de FECHA nueva — hoy → 422 sin efectos.
// ===========================================================================

describe('CambiarFecha — fecha nueva estrictamente futura (> hoy)', () => {
  it('debe_rechazar_fecha_igual_a_hoy_sin_mutar_la_reserva_ni_crear_bloqueo', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: F1_GUARDA,
      conBloqueo: true,
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaEvento: hoyUtc() })),
    ).rejects.toBeInstanceOf(CambiarFechaValidacionError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fechaEvento).toEqual(F1_GUARDA);
    expect(await contarBloqueos(hoyUtc())).toBe(0);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede cambiar la fecha de la RESERVA de otro (404).
// ===========================================================================

describe('CambiarFecha — aislamiento multi-tenant / RLS', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: F1_TENANT,
      conBloqueo: true,
    });

    await expect(
      useCase.ejecutar({
        tenantId: OTRO_TENANT,
        usuarioId: GESTOR,
        reservaId,
        fechaEvento: F2_TENANT,
      }),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    // La RESERVA del tenant legítimo no se ha tocado.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fechaEvento).toEqual(F1_TENANT);
    expect(await contarBloqueos(F2_TENANT)).toBe(0);
  });
});
