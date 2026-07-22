/**
 * TESTS del adaptador Prisma `ListarReservasPrismaAdapter` (`GET /reservas` →
 * pipeline, US-049) — refinamiento US-047 Step 3, fase TDD RED.
 *
 * Objetivo del change: cada fila proyectada al read-model del pipeline
 * (`PipelineReservaLectura`) DEBE incluir el flag booleano
 * `tieneBorradorE1Pendiente`, `true` sólo cuando existe una `COMUNICACION` con
 * `codigo_email = 'E1'` y `estado = 'borrador'` asociada a esa RESERVA (bajo el
 * contexto RLS del tenant), `false` en el resto de casos. El flag se calcula en el
 * MISMO query del pipeline (design.md D-1/D-5), sin endpoint adicional ni N+1.
 *
 * Trazabilidad: US-047, spec-delta `consultas` Requirement "El ítem del pipeline
 * expone si la reserva tiene un borrador E1 pendiente" (scenarios true/false/otro
 * tenant). design.md D-1 (cálculo en el query del pipeline) y D-5 (recalculado en
 * cada fetch, sin persistencia dedicada).
 *
 * Estrategia: se DOBLA `PrismaService` (mock de `$transaction` + `fijarTenant`) y se
 * controla lo que devuelve `tx.reserva.findMany`, incluyendo la relación
 * `comunicaciones` filtrada a E1/borrador. Se ejercita la PROYECCIÓN del adaptador
 * (`aLectura`) sin tocar Postgres; la existencia real de la subconsulta/relación se
 * verifica en QA/integración con BD real (memoria: "US-049 backend nunca probado
 * contra BD real").
 *
 * RED: hoy `aLectura` no proyecta `tieneBorradorE1Pendiente` y el tipo
 * `PipelineReservaLectura` no lo declara; los tests fallan por comportamiento
 * ausente. GREEN es de `backend-developer` (Step 5).
 */
import { ListarReservasPrismaAdapter } from './listar-reservas.prisma.adapter';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  PipelinePaginaLectura,
  PipelineQueryFiltros,
} from '../application/listar-reservas.use-case';

/**
 * Lee el flag `tieneBorradorE1Pendiente` del primer ítem con widening del tipo: el
 * campo aún NO existe en `PipelineReservaLectura` (lo añade `backend-developer` en
 * Step 5). El cast permite compilar el spec para que la aserción falle por
 * COMPORTAMIENTO (flag ausente → `undefined`), no por el tipo.
 */
const flagE1 = (pagina: PipelinePaginaLectura): boolean | undefined =>
  (pagina.items[0] as { tieneBorradorE1Pendiente?: boolean })
    .tieneBorradorE1Pendiente;

const TENANT = '00000000-0000-0000-0000-000000000001';

const FILTROS: PipelineQueryFiltros = {
  tenantId: TENANT,
  page: 1,
  limit: 20,
};

// ---------------------------------------------------------------------------
// Fixture de una fila RESERVA + CLIENTE tal como la devuelve Prisma. Los importes
// `Decimal` se dejan en `null` (el adaptador serializa null → null sin tocar Decimal).
// `comunicaciones` es la relación cargada por el query del pipeline, filtrada a
// E1/borrador por el `include`/subconsulta de la implementación (Step 5).
// ---------------------------------------------------------------------------

interface ComunicacionFila {
  idComunicacion: string;
  codigoEmail: string;
  estado: string;
}

const filaReserva = (over: { comunicaciones?: ComunicacionFila[] } = {}) => ({
  idReserva: 'res-1',
  codigo: 'R-0001',
  clienteId: 'cli-1',
  estado: 'consulta',
  subEstado: null,
  canalEntrada: 'email',
  fechaEvento: null,
  duracionHoras: null,
  tipoEvento: null,
  numAdultosNinosMayores4: null,
  numNinosMenores4: null,
  numInvitadosFinal: null,
  importeTotal: null,
  importeSenal: null,
  importeLiquidacion: null,
  ttlExpiracion: null,
  visitaProgramadaFecha: null,
  visitaProgramadaHora: null,
  visitaRealizada: null,
  fianzaEur: null,
  fianzaCobradaFecha: null,
  fianzaDevueltaFecha: null,
  fianzaDevueltaEur: null,
  condPartFirmadas: null,
  condPartEnviadasFecha: null,
  condPartFirmadasFecha: null,
  preEventoStatus: 'pendiente',
  liquidacionStatus: 'pendiente',
  fianzaStatus: 'pendiente',
  posicionCola: null,
  consultaBloqueanteId: null,
  notas: null,
  fechaCreacion: new Date('2026-07-17T10:00:00.000Z'),
  comunicaciones: over.comunicaciones ?? [],
  cliente: {
    idCliente: 'cli-1',
    nombre: 'Marta',
    apellidos: 'Soler',
    email: 'marta.soler@example.com',
    telefono: '600000000',
    dniNif: null,
    direccion: null,
    codigoPostal: null,
    poblacion: null,
    provincia: null,
    ibanDevolucion: null,
  },
});

// ---------------------------------------------------------------------------
// Doble de PrismaService: `$transaction` invoca el trabajo con un `tx` cuyo
// `reserva.findMany` devuelve las filas fixture y `reserva.count` su total.
// ---------------------------------------------------------------------------

const construirAdapter = (
  filas: ReturnType<typeof filaReserva>[],
): { adapter: ListarReservasPrismaAdapter } => {
  const tx = {
    reserva: {
      findMany: jest.fn(async () => filas),
      count: jest.fn(async () => filas.length),
    },
    $executeRaw: jest.fn(async () => 1),
  };

  const prisma = {
    fijarTenant: jest.fn(async () => undefined),
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  return { adapter: new ListarReservasPrismaAdapter(prisma) };
};

describe('ListarReservasPrismaAdapter — tieneBorradorE1Pendiente (US-047 Step 3)', () => {
  it('tieneBorradorE1Pendiente_es_true_cuando_existe_Comunicacion_E1_en_borrador', async () => {
    // Arrange: la reserva tiene una COMUNICACION E1 en borrador.
    const { adapter } = construirAdapter([
      filaReserva({
        comunicaciones: [
          { idComunicacion: 'com-1', codigoEmail: 'E1', estado: 'borrador' },
        ],
      }),
    ]);

    // Act.
    const pagina = await adapter.listarActivas(FILTROS);

    // Assert.
    expect(flagE1(pagina)).toBe(true);
  });

  it('tieneBorradorE1Pendiente_es_false_cuando_no_existe_Comunicacion_E1_en_borrador', async () => {
    // Arrange: la reserva no tiene ninguna COMUNICACION E1 en borrador.
    const { adapter } = construirAdapter([filaReserva({ comunicaciones: [] })]);

    // Act.
    const pagina = await adapter.listarActivas(FILTROS);

    // Assert.
    expect(flagE1(pagina)).toBe(false);
  });

  it('tieneBorradorE1Pendiente_es_false_cuando_existe_Comunicacion_E1_pero_esta_en_enviado', async () => {
    // Arrange: la E1 existe pero ya está enviada (no pendiente).
    const { adapter } = construirAdapter([
      filaReserva({
        comunicaciones: [
          { idComunicacion: 'com-1', codigoEmail: 'E1', estado: 'enviado' },
        ],
      }),
    ]);

    // Act.
    const pagina = await adapter.listarActivas(FILTROS);

    // Assert: E1 enviada no cuenta como borrador pendiente.
    expect(flagE1(pagina)).toBe(false);
  });
});
