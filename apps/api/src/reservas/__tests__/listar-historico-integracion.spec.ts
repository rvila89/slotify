/**
 * TESTS DE INTEGRACIÓN (BD REAL) del `ListarHistoricoPrismaAdapter` — histórico de
 * reservas cerradas (`GET /historico`, US-042 / UC-32) — fase TDD RED.
 *
 * POR QUÉ ES OBLIGATORIO INTEGRACIÓN Y NO MOCKEA PRISMA (lección US-049 y US-050 §5c):
 * la búsqueda `q` es FULL-TEXT SQL de PostgreSQL (`to_tsvector('spanish')` +
 * `plainto_tsquery`, índice GIN — design.md §D-2). Un adaptador con Prisma mockeado
 * inspeccionaría el objeto `where` pero NUNCA ejecutaría el SQL, así que la semántica
 * real del full-text (stemming, coincidencia por nombre/apellidos/email/código/notas) no
 * se ejercita. Este test ejecuta SQL REAL contra la BD de test aislada
 * (`.env.test` → `slotify_test`), pasando por `fijarTenant`/RLS como en producción.
 *
 * Cubre (design.md §D-6 + spec `historico`):
 *   - `q` encuentra por nombre, apellidos, email del cliente, código y notas de la reserva;
 *   - términos sin match → `data: []`;
 *   - AISLAMIENTO MULTI-TENANT: reservas de OTRO tenant NUNCA aparecen (con filtro
 *     `tenant_id` explícito en el WHERE, incluso si el superuser de test saltase RLS);
 *   - EXCLUSIÓN de estados NO cerrados aunque coincidan con `q`;
 *   - filtro por defecto (solo `reserva_completada`) y opt-in de `reserva_cancelada`;
 *   - filtros estructurados AND (rango fechaEvento, tipoEvento, rango importeTotal);
 *   - orden por `fechaEvento` DESC.
 *
 * RED HOY: `../infrastructure/listar-historico.prisma.adapter` y su puerto todavía NO
 * existen. Requiere `docker compose up -d postgres` + migración (incl. índice GIN) + seed
 * (tenants piloto `...0001` y `...00ff`), igual que el resto de tests de integración del
 * módulo. Se lanza desde la sesión principal (los subagentes QA corren sin BD real).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, EstadoReserva, SubEstadoConsulta, TipoEvento } from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ListarHistoricoPrismaAdapter } from '../infrastructure/listar-historico.prisma.adapter';
import type { HistoricoQueryFiltros } from '../application/listar-historico.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us042-historico-int.test';

// Fechas de evento en el pasado (histórico) y LIBRES respecto a otros tests. La reserva
// por sí sola no requiere FECHA_BLOQUEADA en este read-only.
const FECHA_ENE = new Date('2026-01-15T00:00:00.000Z');
const FECHA_FEB = new Date('2026-02-15T00:00:00.000Z');
const FECHA_MAR = new Date('2026-03-15T00:00:00.000Z');
const FECHA_JUN = new Date('2026-06-15T00:00:00.000Z');

let moduleRef: TestingModule;
let prisma: PrismaService;
let adapter: ListarHistoricoPrismaAdapter;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrarReserva = async (params: {
  codigo: string;
  estado: EstadoReserva;
  subEstado?: SubEstadoConsulta | null;
  fechaEvento: Date;
  tenantId?: string;
  cliente?: { nombre?: string; apellidos?: string | null; email?: string };
  tipoEvento?: TipoEvento | null;
  importeTotal?: number | null;
  notas?: string | null;
}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: params.cliente?.nombre ?? 'Cliente',
      apellidos: params.cliente?.apellidos ?? 'Histórico',
      email: params.cliente?.email ?? `cli-${sufijo()}${EMAIL_PATTERN}`,
      telefono: '600111222',
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `${params.codigo}-${sufijo()}`,
      estado: params.estado,
      subEstado: params.subEstado ?? null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fechaEvento,
      tipoEvento: params.tipoEvento ?? null,
      importeTotal: params.importeTotal ?? null,
      notas: params.notas ?? null,
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

const filtros = (over: Partial<HistoricoQueryFiltros> = {}): HistoricoQueryFiltros => ({
  tenantId: TENANT,
  estadoFinal: 'reserva_completada',
  page: 1,
  limit: 100,
  ...over,
});

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  adapter = new ListarHistoricoPrismaAdapter(prisma);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

describe('ListarHistoricoPrismaAdapter (integración BD real) — búsqueda full-text (US-042 §D-2)', () => {
  it('debe_encontrar_por_apellido_del_cliente_con_full_text', async () => {
    // Arrange
    const idMatch = await sembrarReserva({
      codigo: 'TST-042-APE',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { nombre: 'Ana', apellidos: 'García López', email: `ana-${sufijo()}${EMAIL_PATTERN}` },
    });
    await sembrarReserva({
      codigo: 'TST-042-OTRO',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_FEB,
      cliente: { nombre: 'Luis', apellidos: 'Martínez Ruiz', email: `luis-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act
    const pagina = await adapter.listarCerradas(filtros({ q: 'García' }));
    const ids = pagina.items.map((r) => r.idReserva);

    // Assert
    expect(ids).toContain(idMatch);
    expect(ids).toHaveLength(1);
  });

  it('debe_encontrar_por_nombre_del_cliente_con_full_text', async () => {
    // Arrange
    const idMatch = await sembrarReserva({
      codigo: 'TST-042-NOM',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { nombre: 'Bernardo', apellidos: 'Sanz', email: `ber-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act
    const pagina = await adapter.listarCerradas(filtros({ q: 'Bernardo' }));

    // Assert
    expect(pagina.items.map((r) => r.idReserva)).toContain(idMatch);
  });

  it('debe_encontrar_por_email_del_cliente_con_full_text', async () => {
    // Arrange: email con un token único buscable.
    const emailUnico = `contacto.zafiro-${sufijo()}${EMAIL_PATTERN}`;
    const idMatch = await sembrarReserva({
      codigo: 'TST-042-MAIL',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { nombre: 'Carla', apellidos: 'Vidal', email: emailUnico },
    });

    // Act: busca por un fragmento distintivo del email.
    const pagina = await adapter.listarCerradas(filtros({ q: 'zafiro' }));

    // Assert
    expect(pagina.items.map((r) => r.idReserva)).toContain(idMatch);
  });

  it('debe_encontrar_por_codigo_de_la_reserva_con_full_text', async () => {
    // Arrange: código con un token distintivo.
    const codigoDistintivo = `SLOZR${sufijo().toUpperCase()}`;
    const idMatch = await sembrarReserva({
      codigo: codigoDistintivo,
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { email: `cod-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act
    const pagina = await adapter.listarCerradas(filtros({ q: codigoDistintivo }));

    // Assert
    expect(pagina.items.map((r) => r.idReserva)).toContain(idMatch);
  });

  it('debe_encontrar_por_notas_de_la_reserva_con_full_text', async () => {
    // Arrange
    const idMatch = await sembrarReserva({
      codigo: 'TST-042-NOTAS',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { email: `not-${sufijo()}${EMAIL_PATTERN}` },
      notas: 'Montaje con carpa transparente y catering vegano',
    });

    // Act
    const pagina = await adapter.listarCerradas(filtros({ q: 'carpa' }));

    // Assert
    expect(pagina.items.map((r) => r.idReserva)).toContain(idMatch);
  });

  it('debe_devolver_vacio_cuando_el_termino_no_coincide_con_ningun_registro', async () => {
    // Arrange
    await sembrarReserva({
      codigo: 'TST-042-SINMATCH',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { nombre: 'Ana', apellidos: 'García', email: `sm-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act: término que no aparece en ningún campo indexado.
    const pagina = await adapter.listarCerradas(filtros({ q: 'xyzzyplughinexistente' }));

    // Assert
    expect(pagina.items).toEqual([]);
    expect(pagina.total).toBe(0);
  });
});

describe('ListarHistoricoPrismaAdapter (integración BD real) — aislamiento multi-tenant (US-042)', () => {
  it('debe_excluir_reservas_de_otro_tenant_aunque_coincidan_con_la_busqueda', async () => {
    // Arrange: mismo apellido buscable en AMBOS tenants; solo el del filtro debe verse.
    const idPropia = await sembrarReserva({
      codigo: 'TST-042-T1',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      tenantId: TENANT,
      cliente: { nombre: 'Ana', apellidos: 'Peñafiel', email: `t1-${sufijo()}${EMAIL_PATTERN}` },
    });
    const idAjena = await sembrarReserva({
      codigo: 'TST-042-T2',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      tenantId: OTRO_TENANT,
      cliente: { nombre: 'Otra', apellidos: 'Peñafiel', email: `t2-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act: se consulta como TENANT (el filtro tenant_id del WHERE es explícito).
    const pagina = await adapter.listarCerradas(filtros({ tenantId: TENANT, q: 'Peñafiel' }));
    const ids = pagina.items.map((r) => r.idReserva);

    // Assert: SOLO la propia; la del otro tenant NUNCA aparece.
    expect(ids).toContain(idPropia);
    expect(ids).not.toContain(idAjena);
  });

  it('debe_excluir_reservas_de_otro_tenant_en_el_listado_sin_busqueda', async () => {
    // Arrange
    const idPropia = await sembrarReserva({
      codigo: 'TST-042-T1B',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_FEB,
      tenantId: TENANT,
      cliente: { email: `t1b-${sufijo()}${EMAIL_PATTERN}` },
    });
    const idAjena = await sembrarReserva({
      codigo: 'TST-042-T2B',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_FEB,
      tenantId: OTRO_TENANT,
      cliente: { email: `t2b-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act
    const pagina = await adapter.listarCerradas(filtros({ tenantId: TENANT }));
    const ids = pagina.items.map((r) => r.idReserva);

    // Assert
    expect(ids).toContain(idPropia);
    expect(ids).not.toContain(idAjena);
  });
});

describe('ListarHistoricoPrismaAdapter (integración BD real) — exclusión de estados no cerrados (US-042)', () => {
  it('debe_excluir_estados_activos_y_terminales_de_consulta_aunque_coincidan_con_la_busqueda', async () => {
    // Arrange: mismo apellido buscable en una CERRADA, una ACTIVA (pre_reserva), una
    // consulta terminal 2x y una en curso. Solo la cerrada debe aparecer.
    const apellido = `Zúñiga${sufijo()}`;
    const idCerrada = await sembrarReserva({
      codigo: 'TST-042-CERR',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { apellidos: apellido, email: `cerr-${sufijo()}${EMAIL_PATTERN}` },
    });
    const idPre = await sembrarReserva({
      codigo: 'TST-042-PRE',
      estado: EstadoReserva.pre_reserva,
      fechaEvento: FECHA_FEB,
      cliente: { apellidos: apellido, email: `pre-${sufijo()}${EMAIL_PATTERN}` },
    });
    const id2x = await sembrarReserva({
      codigo: 'TST-042-2X',
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2x,
      fechaEvento: FECHA_MAR,
      cliente: { apellidos: apellido, email: `2x-${sufijo()}${EMAIL_PATTERN}` },
    });
    const idCurso = await sembrarReserva({
      codigo: 'TST-042-CUR',
      estado: EstadoReserva.evento_en_curso,
      fechaEvento: FECHA_JUN,
      cliente: { apellidos: apellido, email: `cur-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act
    const pagina = await adapter.listarCerradas(filtros({ q: apellido }));
    const ids = pagina.items.map((r) => r.idReserva);

    // Assert: SOLO la cerrada; ni activas ni terminales de consulta.
    expect(ids).toContain(idCerrada);
    expect(ids).not.toContain(idPre);
    expect(ids).not.toContain(id2x);
    expect(ids).not.toContain(idCurso);
  });

  it('debe_devolver_solo_completadas_por_defecto_y_solo_canceladas_con_opt_in', async () => {
    // Arrange
    const idComp = await sembrarReserva({
      codigo: 'TST-042-COMP',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { email: `comp-${sufijo()}${EMAIL_PATTERN}` },
    });
    const idCanc = await sembrarReserva({
      codigo: 'TST-042-CANC',
      estado: EstadoReserva.reserva_cancelada,
      fechaEvento: FECHA_FEB,
      cliente: { email: `canc-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act: por defecto (estadoFinal = reserva_completada).
    const soloCompletadas = await adapter.listarCerradas(filtros({ estadoFinal: 'reserva_completada' }));
    const idsComp = soloCompletadas.items.map((r) => r.idReserva);

    // Act: opt-in de canceladas.
    const soloCanceladas = await adapter.listarCerradas(filtros({ estadoFinal: 'reserva_cancelada' }));
    const idsCanc = soloCanceladas.items.map((r) => r.idReserva);

    // Assert
    expect(idsComp).toContain(idComp);
    expect(idsComp).not.toContain(idCanc);
    expect(idsCanc).toContain(idCanc);
    expect(idsCanc).not.toContain(idComp);
  });
});

describe('ListarHistoricoPrismaAdapter (integración BD real) — filtros estructurados y orden (US-042)', () => {
  it('debe_filtrar_por_rango_de_fechaEvento_inclusivo', async () => {
    // Arrange
    const idEnero = await sembrarReserva({
      codigo: 'TST-042-F-ENE',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { email: `fene-${sufijo()}${EMAIL_PATTERN}` },
    });
    const idJunio = await sembrarReserva({
      codigo: 'TST-042-F-JUN',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_JUN,
      cliente: { email: `fjun-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act: rango Q1 (ene-mar) inclusivo.
    const pagina = await adapter.listarCerradas(
      filtros({
        fechaDesde: new Date('2026-01-01T00:00:00.000Z'),
        fechaHasta: new Date('2026-03-31T00:00:00.000Z'),
      }),
    );
    const ids = pagina.items.map((r) => r.idReserva);

    // Assert
    expect(ids).toContain(idEnero);
    expect(ids).not.toContain(idJunio);
  });

  it('debe_filtrar_por_tipoEvento_e_importe_combinados_con_AND', async () => {
    // Arrange: la única que cumple TODO (boda AND importe en rango).
    const idMatch = await sembrarReserva({
      codigo: 'TST-042-AND-OK',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      tipoEvento: TipoEvento.boda,
      importeTotal: 12000,
      cliente: { email: `andok-${sufijo()}${EMAIL_PATTERN}` },
    });
    // Mismo tipo pero importe fuera de rango.
    const idImporte = await sembrarReserva({
      codigo: 'TST-042-AND-IMP',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_FEB,
      tipoEvento: TipoEvento.boda,
      importeTotal: 500,
      cliente: { email: `andimp-${sufijo()}${EMAIL_PATTERN}` },
    });
    // Importe en rango pero tipo distinto.
    const idTipo = await sembrarReserva({
      codigo: 'TST-042-AND-TIP',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_MAR,
      tipoEvento: TipoEvento.corporativo,
      importeTotal: 12000,
      cliente: { email: `andtip-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act
    const pagina = await adapter.listarCerradas(
      filtros({ tipoEvento: 'boda', importeMin: '1000.00', importeMax: '20000.00' }),
    );
    const ids = pagina.items.map((r) => r.idReserva);

    // Assert: AND estricto → solo la que cumple ambas condiciones.
    expect(ids).toContain(idMatch);
    expect(ids).not.toContain(idImporte);
    expect(ids).not.toContain(idTipo);
  });

  it('debe_ordenar_por_fechaEvento_descendente', async () => {
    // Arrange
    const idViejo = await sembrarReserva({
      codigo: 'TST-042-ORD-V',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_ENE,
      cliente: { email: `ordv-${sufijo()}${EMAIL_PATTERN}` },
    });
    const idMedio = await sembrarReserva({
      codigo: 'TST-042-ORD-M',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_MAR,
      cliente: { email: `ordm-${sufijo()}${EMAIL_PATTERN}` },
    });
    const idNuevo = await sembrarReserva({
      codigo: 'TST-042-ORD-N',
      estado: EstadoReserva.reserva_completada,
      fechaEvento: FECHA_JUN,
      cliente: { email: `ordn-${sufijo()}${EMAIL_PATTERN}` },
    });

    // Act
    const pagina = await adapter.listarCerradas(filtros());
    const idsSembrados = new Set([idViejo, idMedio, idNuevo]);
    const ordenVisto = pagina.items
      .map((r) => r.idReserva)
      .filter((id) => idsSembrados.has(id));

    // Assert: DESC por fechaEvento (JUN > MAR > ENE).
    expect(ordenVisto).toEqual([idNuevo, idMedio, idViejo]);
  });
});
