/**
 * TESTS DE CONCURRENCIA REALES de la numeración de la factura de señal (US-022 /
 * UC-18) — fase TDD RED. tasks.md Fase 3: 3.3. ZONA CRÍTICA de la numeración
 * (serialización por `UNIQUE(tenant_id, numero_factura)` + reintento aplicativo
 * ante `P2002`, NUNCA locks distribuidos — design.md §D-8, CLAUDE.md §Regla crítica).
 *
 * Trazabilidad: US-022, spec-delta `facturacion` (Requirement "Concurrencia de la
 * numeración — colisión resuelta por UNIQUE + reintento", escenario "Dos reservas del
 * mismo tenant confirmadas a la vez no duplican el número"); design.md §D-8. CLAUDE.md
 * §Testing (tests de concurrencia antes que UI/CRUD) y §Regla crítica (exclusión mutua
 * SOLO en PostgreSQL; nada de Redis/locks distribuidos). skill `concurrency-locking`:
 * `Promise.allSettled()`, resultado sin duplicados ni huecos no controlados.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no mocks).
 * Mismo enfoque que `confirmar-pago-senal-concurrencia.spec.ts` (US-021). Requiere
 * `docker compose up -d postgres` + migración + seed (tenant piloto con `pct_senal=40`).
 * BD aislada `slotify_test` (`.env.test`); códigos/emails propios no compartidos con
 * otras suites para ser DETERMINISTA (memoria: US-004 deadlock flaky / BD aislada). NO
 * se reintroduce el patrón que provoca deadlock 40P01.
 *
 * RED: aún NO existe `facturacion/application/generar-factura-senal.use-case.ts` ni el
 * cableado de `FacturacionModule` (hoy esqueleto vacío). El import falla en compilación y
 * la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el
 * Postgres está arriba). GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoReserva,
  TipoEvento,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  GenerarFacturaSenalUseCase,
  type GenerarFacturaSenalComando,
} from '../application/generar-factura-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us022-conc.test';
const CODIGO_PREFIX = 'TST-U022C-';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: GenerarFacturaSenalUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string): GenerarFacturaSenalComando => ({
  tenantId: TENANT,
  reservaId,
});

/** Siembra una RESERVA en `reserva_confirmada` con importe_senal congelado, lista
 *  para facturar (fechas propias no compartidas con otras suites). */
const sembrarReservaConfirmada = async (params: {
  fecha: Date;
  importeSenal?: string;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Conc',
      apellidos: 'Factura',
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
      estado: EstadoReserva.reserva_confirmada,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '3000.00',
      importeSenal: params.importeSenal ?? '1200.00',
      importeLiquidacion: '1800.00',
      ttlExpiracion: null,
    },
  });
  return reserva.idReserva;
};

const limpiar = async (): Promise<void> => {
  const clientesPattern = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientesPattern.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: {
      OR: [{ clienteId: { in: clienteIds } }, { codigo: { startsWith: CODIGO_PREFIX } }],
    },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.pago.deleteMany({ where: { factura: { reservaId: { in: ids } } } });
    await prisma.factura.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.documento.deleteMany({ where: { reservaId: { in: ids } } });
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
  useCase = moduleRef.get(GenerarFacturaSenalUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.3 — N facturas de señal concurrentes de reservas DISTINTAS del MISMO tenant:
//        la colisión de numero_factura (dos calculan el mismo MAX+1) la resuelve
//        UNIQUE(tenant_id, numero_factura) (P2002) + reintento; todas terminan con
//        un número ÚNICO y CONSECUTIVO, ninguna sin número, sin duplicados.
// ===========================================================================

describe('Generar factura de señal — numeración concurrente de reservas distintas (3.3)', () => {
  const anio = new Date().getUTCFullYear();

  it('debe_asignar_numeros_unicos_y_consecutivos_a_10_facturas_concurrentes_del_mismo_tenant', async () => {
    // 10 reservas confirmadas distintas del mismo tenant, con fechas propias.
    const reservaIds = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        sembrarReservaConfirmada({
          fecha: new Date(Date.UTC(2029, 0, 1 + i)),
        }),
      ),
    );

    // Disparo SIMULTÁNEO de la generación (Promise.allSettled).
    const resultados = await Promise.allSettled(
      reservaIds.map((id) => useCase.ejecutar(comando(id))),
    );

    // Todas deben cumplir (el reintento ante P2002 evita que ninguna se pierda).
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    expect(cumplidas).toHaveLength(10);

    // Estado de BD: 10 facturas, todas con numero_factura NO nulo y ÚNICO.
    const facturas = await prisma.factura.findMany({
      where: { reservaId: { in: reservaIds } },
      select: { numeroFactura: true, reservaId: true },
    });
    expect(facturas).toHaveLength(10);
    facturas.forEach((f) => expect(f.numeroFactura).toBeTruthy());

    const numeros = facturas.map((f) => f.numeroFactura ?? '');
    const unicos = new Set(numeros);
    // Sin duplicados: tantos números distintos como facturas.
    expect(unicos.size).toBe(10);

    // Todos con el formato F-YYYY-NNNN del año en curso.
    numeros.forEach((n) => expect(n).toMatch(new RegExp(`^F-${anio}-\\d{4,}$`)));

    // Consecutivos (sin huecos): las secuencias forman un rango contiguo.
    const secuencias = numeros
      .map((n) => Number(n.split('-')[2]))
      .sort((a, b) => a - b);
    for (let i = 1; i < secuencias.length; i += 1) {
      expect(secuencias[i]).toBe(secuencias[i - 1] + 1);
    }
  });

  it('no_debe_crear_ninguna_factura_sin_numero_ni_dos_con_el_mismo_numero', async () => {
    const reservaIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        sembrarReservaConfirmada({ fecha: new Date(Date.UTC(2029, 1, 1 + i)) }),
      ),
    );

    await Promise.allSettled(reservaIds.map((id) => useCase.ejecutar(comando(id))));

    const facturas = await prisma.factura.findMany({
      where: { reservaId: { in: reservaIds } },
      select: { numeroFactura: true },
    });
    // Ninguna sin número.
    expect(facturas.every((f) => !!f.numeroFactura)).toBe(true);
    // Ninguna con número repetido para el tenant.
    const numeros = facturas.map((f) => f.numeroFactura ?? '');
    expect(new Set(numeros).size).toBe(numeros.length);
  });
});
