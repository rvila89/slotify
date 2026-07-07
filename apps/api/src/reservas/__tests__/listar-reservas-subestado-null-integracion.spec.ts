/**
 * TEST DE INTEGRACIÓN (BD REAL) del `ListarReservasPrismaAdapter` — Bloque 5c de US-050.
 *
 * BUG VERIFICADO (Bug 2 del QA de US-050). `construirWhere()` aplica, cuando NO llega
 * filtro de sub-estado, `subEstado: { notIn: [...SUB_ESTADOS_TERMINALES] }`. En SQL eso
 * es `sub_estado NOT IN ('s2x','s2y','s2z')`, y por la LÓGICA TERNARIA de SQL
 * `NULL NOT IN (...)` evalúa a NULL (no TRUE): TODAS las filas con `sub_estado IS NULL`
 * quedan EXCLUIDAS. Consecuencia: los estados principales `pre_reserva`,
 * `reserva_confirmada`, `evento_en_curso`, `post_evento` (que tienen `subEstado = null`)
 * NUNCA aparecen en el pipeline; solo se ve la columna "Consulta".
 *
 * POR QUÉ ESTE TEST ES DE INTEGRACIÓN Y NO MOCKEA PRISMA: el bug se ocultó porque los
 * tests del adaptador (`listar-reservas.prisma.adapter.spec.ts`) MOCKEAN `PrismaService`
 * y solo inspeccionan el objeto `where` — el SQL nunca se ejecuta, así que la semántica
 * ternaria de `NULL NOT IN (...)` jamás se ejercita. Este test ejecuta SQL REAL contra la
 * BD de test aislada (`.env.test` → `slotify_test`), pasando por `fijarTenant`/RLS como en
 * producción, para que el fallo sea el real (filas con `subEstado = null` ausentes del
 * resultado del SQL), no un artefacto de mock.
 *
 * Requiere `docker compose up -d postgres` + migración + seed (tenant piloto), igual que
 * el resto de tests de integración del módulo (`obtener-reserva-integracion.spec.ts`).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, EstadoReserva, SubEstadoConsulta } from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ListarReservasPrismaAdapter } from '../infrastructure/listar-reservas.prisma.adapter';
import type { PipelineQueryFiltros } from '../application/listar-reservas.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us050-5c-subestado-null.test';

// Fechas de evento LIBRES (futuro lejano, no compartidas con otros tests) para NO violar
// el bloqueo atómico de fecha: sembramos filas de RESERVA coherentes sin tocar
// FECHA_BLOQUEADA (la reserva por sí sola no requiere bloqueo en este read-only).
const FECHA_CONFIRMADA = new Date('2030-03-01T00:00:00.000Z');
const FECHA_PRERESERVA = new Date('2030-03-02T00:00:00.000Z');
const FECHA_CONSULTA_2B = new Date('2030-03-03T00:00:00.000Z');
const FECHA_TERMINAL_2X = new Date('2030-03-04T00:00:00.000Z');
const FECHA_CERRADA = new Date('2030-03-05T00:00:00.000Z');

let moduleRef: TestingModule;
let prisma: PrismaService;
let adapter: ListarReservasPrismaAdapter;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrarReserva = async (params: {
  codigo: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento: Date;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Pipeline5c',
      apellidos: 'SubEstadoNull',
      email: `pipeline-${sufijo()}${EMAIL_PATTERN}`,
      telefono: '600333444',
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `${params.codigo}-${sufijo()}`,
      estado: params.estado,
      subEstado: params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fechaEvento,
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
  if (clienteIds.length > 0) {
    const reservas = await prisma.reserva.findMany({
      where: { clienteId: { in: clienteIds } },
      select: { idReserva: true },
    });
    const ids = reservas.map((r) => r.idReserva);
    if (ids.length > 0) {
      await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
    }
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

const filtros = (
  over: Partial<PipelineQueryFiltros> = {},
): PipelineQueryFiltros => ({ tenantId: TENANT, page: 1, limit: 100, ...over });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  // El adaptador se ejerce igual que en producción (SQL real + fijarTenant/RLS).
  adapter = new ListarReservasPrismaAdapter(prisma);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

describe('ListarReservasPrismaAdapter (integración BD real) — filtro subEstado NULL (Bloque 5c)', () => {
  it('debe_incluir_reservas_activas_con_subEstado_null_reserva_confirmada_y_pre_reserva', async () => {
    // Arrange: dos reservas ACTIVAS con subEstado = null (los estados de la fase avanzada
    // del pipeline). Son las que HOY desaparecen por la semántica de `NULL NOT IN (...)`.
    const idConfirmada = await sembrarReserva({
      codigo: 'TST-5C-CONF',
      estado: EstadoReserva.reserva_confirmada,
      subEstado: null,
      fechaEvento: FECHA_CONFIRMADA,
    });
    const idPreReserva = await sembrarReserva({
      codigo: 'TST-5C-PRE',
      estado: EstadoReserva.pre_reserva,
      subEstado: null,
      fechaEvento: FECHA_PRERESERVA,
    });

    // Act: SIN filtro de subEstado, tal como llega desde el pipeline por defecto.
    const pagina = await adapter.listarActivas(filtros());
    const ids = pagina.items.map((r) => r.idReserva);

    // Assert (RED HOY): las reservas con subEstado = null DEBEN estar presentes.
    expect(ids).toContain(idConfirmada);
    expect(ids).toContain(idPreReserva);
  });

  it('debe_incluir_la_consulta_2b_activa_y_excluir_la_terminal_2x_y_la_cerrada', async () => {
    // Arrange: una consulta con subEstado NO terminal (2b) debe verse; una terminal (2x)
    // y una cerrada (reserva_completada) NO. La exclusión debe seguir funcionando tras el fix.
    const idConsulta2b = await sembrarReserva({
      codigo: 'TST-5C-2B',
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fechaEvento: FECHA_CONSULTA_2B,
    });
    const idTerminal2x = await sembrarReserva({
      codigo: 'TST-5C-2X',
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2x,
      fechaEvento: FECHA_TERMINAL_2X,
    });
    const idCerrada = await sembrarReserva({
      codigo: 'TST-5C-CERR',
      estado: EstadoReserva.reserva_completada,
      subEstado: null,
      fechaEvento: FECHA_CERRADA,
    });

    // Act
    const pagina = await adapter.listarActivas(filtros());
    const ids = pagina.items.map((r) => r.idReserva);

    // Assert
    expect(ids).toContain(idConsulta2b);
    expect(ids).not.toContain(idTerminal2x);
    expect(ids).not.toContain(idCerrada);
  });

  it('debe_contar_todas_las_activas_sembradas_incluidas_las_de_subEstado_null', async () => {
    // Arrange: 3 activas (2 con subEstado null + 1 consulta 2b) + 2 que NO cuentan
    // (terminal 2x y cerrada). El `total` de la página (sobre `count`) también sufre el bug.
    const activas = [
      await sembrarReserva({
        codigo: 'TST-5C-CONF',
        estado: EstadoReserva.reserva_confirmada,
        subEstado: null,
        fechaEvento: FECHA_CONFIRMADA,
      }),
      await sembrarReserva({
        codigo: 'TST-5C-PRE',
        estado: EstadoReserva.pre_reserva,
        subEstado: null,
        fechaEvento: FECHA_PRERESERVA,
      }),
      await sembrarReserva({
        codigo: 'TST-5C-2B',
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2b,
        fechaEvento: FECHA_CONSULTA_2B,
      }),
    ];
    await sembrarReserva({
      codigo: 'TST-5C-2X',
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2x,
      fechaEvento: FECHA_TERMINAL_2X,
    });
    await sembrarReserva({
      codigo: 'TST-5C-CERR',
      estado: EstadoReserva.reserva_completada,
      subEstado: null,
      fechaEvento: FECHA_CERRADA,
    });

    // Act
    const pagina = await adapter.listarActivas(filtros());
    const idsSembradosActivos = new Set(activas);
    const idsVistosActivos = pagina.items
      .map((r) => r.idReserva)
      .filter((id) => idsSembradosActivos.has(id));

    // Assert (RED HOY): las 3 activas deben verse (las 2 de subEstado null se pierden hoy).
    expect(idsVistosActivos.length).toBe(3);
  });
});
