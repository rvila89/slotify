/**
 * TESTS DE CONCURRENCIA REALES de la confirmación del pago de la señal (US-021 /
 * UC-17) — fase TDD RED. tasks.md Fase 3: 3.2. ZONA CRÍTICA (anti-doble-reserva
 * D4: serialización por `SELECT … FOR UPDATE` sobre la fila de FECHA_BLOQUEADA +
 * `UNIQUE(tenant_id, fecha)`).
 *
 * Trazabilidad: US-021, spec-delta `consultas` (Requirement "Concurrencia
 * anti-doble-reserva (D4) al confirmar la señal", escenarios "Doble clic sobre la
 * misma reserva confirma una sola vez" y "Confirmar sobre una fecha ya en firme de
 * otra reserva devuelve Fecha no disponible"); design.md §D-8. CLAUDE.md §Testing
 * (tests de concurrencia del bloqueo atómico antes que UI/CRUD) y §Regla crítica
 * (la exclusión mutua vive SOLO en PostgreSQL; nada de Redis/locks distribuidos).
 * skill `concurrency-locking`: `Promise.allSettled()`, 1 OK + 1 rechazo.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no
 * mocks). Mismo enfoque que `activar-prereserva-concurrencia.spec.ts` (US-014).
 * Requiere `docker compose up -d postgres` + migración + seed. BD aislada
 * `slotify_test` (`.env.test`), fechas futuras propias no compartidas con otras
 * suites para ser DETERMINISTA (memoria: US-004 deadlock flaky / BD aislada). NO se
 * reintroduce el patrón que provoca deadlock 40P01; se sigue el patrón vigente del
 * repo.
 *
 * RED: aún NO existe `confirmacion/application/confirmar-pago-senal.use-case.ts` ni
 * el cableado de `ConfirmacionModule`. El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres
 * está arriba). GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoPresupuesto,
  EstadoReserva,
  TipoBloqueo,
  TipoEvento,
} from '@prisma/client';
import { ConfirmacionModule } from '../confirmacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ConfirmarPagoSenalUseCase,
  type ConfirmarPagoSenalComando,
  type JustificanteSubido,
} from '../application/confirmar-pago-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us021-conc.test';
const MB = 1024 * 1024;

// Fechas estrictamente futuras y aisladas (no usadas por el seed ni otras suites).
const FECHA_DOBLE_CLIC = new Date('2028-04-12T00:00:00.000Z');
const FECHA_OTRA_FIRME = new Date('2028-04-13T00:00:00.000Z');
const FECHAS = [FECHA_DOBLE_CLIC, FECHA_OTRA_FIRME];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ConfirmarPagoSenalUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const justificanteValido = (over: Partial<JustificanteSubido> = {}): JustificanteSubido => ({
  nombreArchivo: 'justificante.pdf',
  mimeType: 'application/pdf',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('%PDF-1.4 fake'),
  ...over,
});

const comando = (reservaId: string): ConfirmarPagoSenalComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  justificante: justificanteValido(),
});

/**
 * Siembra una RESERVA en `pre_reserva` con FECHA_BLOQUEADA blanda + TTL vigente.
 * fix-importe-total-confirmar-senal: SIN `importe_total`; el total vive en un
 * PRESUPUESTO vigente `enviado` (version 1, total 3000). Devuelve reservaId e
 * idPresupuesto para verificar que solo UNA confirmación lo acepta.
 */
const sembrarPreReserva = async (params: {
  fecha: Date;
  conBloqueoBlando?: boolean;
}): Promise<{ reservaId: string; idPresupuesto: string }> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Conc',
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
      codigo: `TST-U021C-${sufijo()}`,
      estado: EstadoReserva.pre_reserva,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      // SIN importe_total: se congela al confirmar desde el presupuesto vigente.
      ttlExpiracion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  // PRESUPUESTO vigente (MAX(version)) en `estado='enviado'`, total 3000.
  const presupuesto = await prisma.presupuesto.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      version: 1,
      baseImponible: '2479.34',
      ivaPorcentaje: '21.00',
      ivaImporte: '520.66',
      total: '3000.00',
      estado: EstadoPresupuesto.enviado,
    },
  });
  if (params.conBloqueoBlando ?? true) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }
  return { reservaId: reserva.idReserva, idPresupuesto: presupuesto.idPresupuesto };
};

const limpiar = async (): Promise<void> => {
  const clientesPattern = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientesPattern.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fichaOperativa.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.documento.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.presupuesto.deleteMany({ where: { reservaId: { in: ids } } });
    // US-022: el disparo post-commit crea una FACTURA de señal por la reserva confirmada.
    await prisma.pago.deleteMany({ where: { factura: { reservaId: { in: ids } } } });
    await prisma.factura.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: { in: FECHAS } } });
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ConfirmacionModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ConfirmarPagoSenalUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.2 — Doble clic sobre la MISMA reserva: dos confirmaciones simultáneas →
//        exactamente UNA gana (upgrade a firme + transición); la otra, tras el
//        lock, observa la RESERVA ya en reserva_confirmada y devuelve
//        RESERVA_YA_CONFIRMADA. Estado final coherente: una sola fila firme, un
//        solo DOCUMENTO, una sola FICHA_OPERATIVA, una sola transición en AUDIT_LOG.
// ===========================================================================

describe('Confirmar señal — doble clic sobre la misma reserva (3.2)', () => {
  it('debe_confirmar_una_sola_vez_y_rechazar_la_segunda_como_reserva_ya_confirmada', async () => {
    const { reservaId, idPresupuesto } = await sembrarPreReserva({ fecha: FECHA_DOBLE_CLIC });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // Exactamente 1 gana; 1 se rechaza.
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);

    // La rechazada es RESERVA_YA_CONFIRMADA (no P2002 ni otro error).
    const rechazo = rechazadas[0] as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ codigo: 'RESERVA_YA_CONFIRMADA' });

    // Estado final coherente:
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.reserva_confirmada);

    // fix-importe-total-confirmar-senal: SOLO una confirmación congela el
    // importe_total (desde el presupuesto vigente) y marca el presupuesto como
    // `aceptado`. La segunda observa `reserva_confirmada` y no re-congela ni re-acepta.
    expect(Number(reserva?.importeTotal)).toBe(3000);
    expect(Number(reserva?.importeSenal)).toBe(1200);
    expect(Number(reserva?.importeLiquidacion)).toBe(1800);
    const presupuesto = await prisma.presupuesto.findUnique({
      where: { idPresupuesto },
    });
    expect(presupuesto?.estado).toBe(EstadoPresupuesto.aceptado);
    // Sigue habiendo UNA sola versión de presupuesto (no se duplicó/re-aceptó otra).
    expect(await prisma.presupuesto.count({ where: { reservaId } })).toBe(1);

    // UNA sola fila de FECHA_BLOQUEADA para (tenant, fecha), firme, ttl NULL.
    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DOBLE_CLIC },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].tipoBloqueo).toBe(TipoBloqueo.firme);

    // UN solo DOCUMENTO justificante, UNA sola FICHA_OPERATIVA.
    expect(await prisma.documento.count({ where: { reservaId } })).toBe(1);
    expect(await prisma.fichaOperativa.count({ where: { reservaId } })).toBe(1);

    // UNA sola entrada de transición en AUDIT_LOG (sin doble transición).
    const transiciones = await prisma.auditLog.count({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'transicion' },
    });
    expect(transiciones).toBe(1);
  });
});

// ===========================================================================
// 3.2 — Confirmar sobre una fecha ya en FIRME de OTRA reserva: choca con
//        UNIQUE(tenant,fecha) (P2002) → FECHA_NO_DISPONIBLE, sin mutar la segunda
//        reserva ni tocar la fila firme de la primera.
// ===========================================================================

describe('Confirmar señal — fecha ya en firme de otra reserva (3.2)', () => {
  it('debe_rechazar_con_fecha_no_disponible_y_no_mutar_la_segunda_reserva', async () => {
    // Reserva OCUPANTE ya confirmada con bloqueo FIRME de la fecha.
    const { reservaId: ocupante } = await sembrarPreReserva({
      fecha: FECHA_OTRA_FIRME,
      conBloqueoBlando: false,
    });
    await prisma.reserva.update({
      where: { idReserva: ocupante },
      data: { estado: EstadoReserva.reserva_confirmada, ttlExpiracion: null },
    });
    await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: FECHA_OTRA_FIRME,
        reservaId: ocupante,
        tipoBloqueo: TipoBloqueo.firme,
        ttlExpiracion: null,
      },
    });
    // Segunda reserva en pre_reserva sobre la MISMA fecha (sin fila propia): al
    // intentar fijar (tenant, fecha) chocará con el UNIQUE (P2002).
    const { reservaId: segunda } = await sembrarPreReserva({
      fecha: FECHA_OTRA_FIRME,
      conBloqueoBlando: false,
    });

    await expect(useCase.ejecutar(comando(segunda))).rejects.toMatchObject({
      codigo: 'FECHA_NO_DISPONIBLE',
    });

    // La segunda reserva NO se muta (sigue en pre_reserva, sin importes ni ficha).
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: segunda } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    expect(await prisma.documento.count({ where: { reservaId: segunda } })).toBe(0);
    expect(await prisma.fichaOperativa.count({ where: { reservaId: segunda } })).toBe(0);

    // La fila FIRME del ocupante sigue siendo la única para (tenant, fecha).
    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_OTRA_FIRME },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].reservaId).toBe(ocupante);
  });
});
