/**
 * TESTS DE INTEGRACIÓN REAL de la DEVOLUCIÓN COMPLETA de la fianza + email E10
 * (fix-liquidacion-fianza-independientes / UC-27). Verifican el caso de uso
 * `DevolverFianzaUseCase` cableado en `FacturacionModule` contra el Postgres del
 * docker-compose (BD aislada `slotify_test`, `.env.test`): NO se doblan los puertos,
 * se ejercitan los ADAPTADORES Prisma REALES —en particular
 * `DevolverFianzaUoWPrismaAdapter` con su `SELECT ... FOR UPDATE` sobre la RESERVA
 * (relectura con bloqueo de fila; nunca locks distribuidos) y `DispararE10Adapter`
 * (motor de email US-045)— y se comprueba el ESTADO DE LA BD tras la operación. El
 * transporte de email va en modo FAKE en `test` (`FakeEmailAdapter`, cero red).
 *
 * REGRESIÓN QUE BLINDA (lección "adaptador nunca probado contra BD real"): la relectura
 * `SELECT ... FOR UPDATE` comparaba la columna TEXT `id_reserva` contra un parámetro
 * casteado `::uuid`, lo que hacía saltar el error de Postgres 42883 (operador `= (text, uuid)`
 * inexistente) EN CUANTO se ejecutaba contra la BD real. Los unit tests con dobles de puertos
 * (`devolver-fianza.use-case.spec.ts`) NO lo detectaban porque mockeaban `releerConBloqueo`.
 * El fix removió el cast; este happy path ejecuta el raw real y HABRÍA FALLADO con 42883
 * antes del arreglo. Si alguien reintroduce el `::uuid`, este spec se pone en rojo.
 *
 * ESPEJO del harness de `enviar-factura-senal-integracion.spec.ts` /
 * `reenviar-e3-integracion.spec.ts`: mismo bootstrap con `moduleRef`, mismo sembrado/limpieza
 * con Prisma real, misma gestión de tenant/RLS (tenant piloto `...001`, gestor `...002`).
 *
 * Cobertura:
 *   - Happy path: RESERVA `post_evento` + `fianza_status='cobrada'` + `fianza_eur>0` →
 *     UPDATE real `fianza_status='devuelta'` + `fianza_devuelta_fecha` (releído de BD),
 *     AUDIT_LOG `actualizar`, y una COMUNICACION E10 `enviado` (motor + fake).
 *   - Precondición: RESERVA NO en `post_evento` o `fianza_status != 'cobrada'` → rechaza
 *     sin mutar estado (`PrecondicionNoCumplidaError`).
 *   - Doble registro: segundo `devolver` sobre una reserva YA `devuelta` → rechaza
 *     (`DevolucionYaRegistradaError`), sin duplicar AUDIT_LOG ni COMUNICACION.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  CodigoEmail,
  DuracionHoras,
  EstadoComunicacion,
  EstadoReserva,
  FianzaStatus,
  TipoEvento,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  DevolverFianzaUseCase,
  PrecondicionNoCumplidaError,
  DevolucionYaRegistradaError,
  type DevolverFianzaComando,
} from '../application/devolver-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@devfianza-int.test';
const CODIGO_PREFIX = 'TST-DEVFI-';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: DevolverFianzaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string, tenantId = TENANT): DevolverFianzaComando => ({
  tenantId,
  usuarioId: GESTOR,
  reservaId,
});

/**
 * Siembra una RESERVA con su CLIENTE (con email, para que E10 tenga destinatario) en el
 * estado/fianza indicados. Por defecto: `post_evento` + `fianza_status='cobrada'` +
 * `fianza_eur='500.00'` (reserva devolvible). Fechas propias no compartidas con otras suites.
 */
const sembrarReserva = async (params: {
  estado?: EstadoReserva;
  fianzaStatus?: FianzaStatus;
  fianzaEur?: string | null;
  fianzaDevueltaFecha?: Date | null;
  tenantId?: string;
} = {}): Promise<{ reservaId: string; clienteId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Devuelta',
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
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `${CODIGO_PREFIX}${sufijo()}`,
      estado: params.estado ?? EstadoReserva.post_evento,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2029-09-12T00:00:00.000Z'),
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '6000.00',
      importeSenal: '2400.00',
      importeLiquidacion: '3600.00',
      fianzaStatus: params.fianzaStatus ?? FianzaStatus.cobrada,
      fianzaEur: 'fianzaEur' in params ? params.fianzaEur : '500.00',
      fianzaDevueltaFecha: params.fianzaDevueltaFecha ?? null,
      ttlExpiracion: null,
    },
  });
  return { reservaId: reserva.idReserva, clienteId: cliente.idCliente };
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
// Happy path (BLINDA la regresión 42883): FOR UPDATE real + UPDATE + AUDIT_LOG + E10.
// ===========================================================================

describe('DevolverFianza — happy path (integración real; blinda el fix del ::uuid)', () => {
  it('debe_registrar_la_devolucion_en_BD_con_fianza_status_devuelta_y_fecha_leyendo_de_la_BD', async () => {
    const { reservaId } = await sembrarReserva({
      estado: EstadoReserva.post_evento,
      fianzaStatus: FianzaStatus.cobrada,
      fianzaEur: '500.00',
    });

    // Ejecuta el use-case real: la relectura SELECT ... FOR UPDATE se ejecuta contra
    // Postgres. Antes del fix esto lanzaba 42883 (id_reserva TEXT vs ::uuid).
    const resultado = await useCase.ejecutar(comando(reservaId));

    // Resultado del use-case.
    expect(resultado.fianzaStatus).toBe('devuelta');
    expect(resultado.fianzaDevueltaFecha).toBeInstanceOf(Date);
    expect(resultado.fianzaEur).toBe('500.00');

    // Estado de BD REAL (releído): la fianza queda devuelta con su fecha.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fianzaStatus).toBe(FianzaStatus.devuelta);
    expect(reserva?.fianzaDevueltaFecha).not.toBeNull();
    // El estado del agregado NO se transiciona (solo el sub-proceso de fianza).
    expect(reserva?.estado).toBe(EstadoReserva.post_evento);
  });

  it('debe_crear_un_AUDIT_LOG_actualizar_de_la_RESERVA_con_la_transicion_cobrada_a_devuelta', async () => {
    const { reservaId } = await sembrarReserva();

    await useCase.ejecutar(comando(reservaId));

    const audit = await prisma.auditLog.findFirst({
      where: { entidadId: reservaId, entidad: 'RESERVA', accion: 'actualizar' },
      orderBy: { fechaCreacion: 'desc' },
    });
    expect(audit).not.toBeNull();
    // La traza refleja la transición del sub-proceso de fianza.
    const traza = JSON.stringify([audit?.datosAnteriores, audit?.datosNuevos]);
    expect(traza).toContain('cobrada');
    expect(traza).toContain('devuelta');
  });

  it('debe_crear_una_COMUNICACION_E10_enviada_como_efecto_post_commit', async () => {
    const { reservaId } = await sembrarReserva();

    const resultado = await useCase.ejecutar(comando(reservaId));

    // E10 se envía best-effort: el fake lo promueve a `enviado`, sin avisoEmail.
    expect(resultado.avisoEmail).toBeNull();

    const com = await prisma.comunicacion.findFirst({
      where: {
        reservaId,
        codigoEmail: CodigoEmail.E10,
        estado: EstadoComunicacion.enviado,
      },
    });
    expect(com).not.toBeNull();
  });
});

// ===========================================================================
// Precondición: estado != post_evento o fianza_status != cobrada → rechaza sin mutar.
// ===========================================================================

describe('DevolverFianza — precondición no cumplida (integración real)', () => {
  it('debe_rechazar_cuando_la_reserva_no_esta_en_post_evento', async () => {
    const { reservaId } = await sembrarReserva({
      estado: EstadoReserva.reserva_confirmada,
      fianzaStatus: FianzaStatus.cobrada,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      PrecondicionNoCumplidaError,
    );

    // Nada muta: la fianza sigue cobrada, sin fecha y sin E10.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fianzaStatus).toBe(FianzaStatus.cobrada);
    expect(reserva?.fianzaDevueltaFecha).toBeNull();
    const comunicaciones = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E10 },
    });
    expect(comunicaciones).toBe(0);
  });

  it('debe_rechazar_cuando_la_fianza_aun_no_esta_cobrada', async () => {
    const { reservaId } = await sembrarReserva({
      estado: EstadoReserva.post_evento,
      fianzaStatus: FianzaStatus.pendiente,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      PrecondicionNoCumplidaError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fianzaStatus).toBe(FianzaStatus.pendiente);
    expect(reserva?.fianzaDevueltaFecha).toBeNull();
  });
});

// ===========================================================================
// Doble registro: segundo devolver sobre reserva YA devuelta → rechaza, sin duplicar.
// ===========================================================================

describe('DevolverFianza — guarda contra el doble registro (integración real)', () => {
  it('debe_rechazar_el_segundo_devolver_sobre_una_reserva_ya_devuelta_sin_duplicar_audit_ni_E10', async () => {
    const { reservaId } = await sembrarReserva();

    // Primer registro OK (crea AUDIT_LOG + 1 E10 enviado).
    await useCase.ejecutar(comando(reservaId));

    const auditAntes = await prisma.auditLog.count({
      where: { entidadId: reservaId, entidad: 'RESERVA', accion: 'actualizar' },
    });
    const e10Antes = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E10 },
    });

    // Segundo registro sobre la misma reserva (ya `devuelta`) → rechazado.
    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      DevolucionYaRegistradaError,
    );

    // Estado final: sigue `devuelta`, sin AUDIT_LOG ni E10 adicionales.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.fianzaStatus).toBe(FianzaStatus.devuelta);

    const auditDespues = await prisma.auditLog.count({
      where: { entidadId: reservaId, entidad: 'RESERVA', accion: 'actualizar' },
    });
    const e10Despues = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E10 },
    });
    expect(auditDespues).toBe(auditAntes);
    expect(e10Despues).toBe(e10Antes);
  });
});
