/**
 * TESTS del `ListarReservasPrismaAdapter` (US-049 / UC-37 / UC-38) — construcción del
 * `where` de Prisma del pipeline de reservas activas (`GET /reservas`).
 *
 * Hallazgo ALTA del code-review de US-049: la exclusión de estados terminales/cerrados
 * (`2x`/`2y`/`2z` y `reserva_completada`/`reserva_cancelada`) es un INVARIANTE del
 * pipeline y debe aplicarse SIEMPRE, con independencia de los filtros de query. La versión
 * defectuosa SUSTITUÍA el `notIn` de exclusión por una igualdad exacta cuando llegaba el
 * filtro `estado`/`subEstado`, de modo que `?estado=reserva_completada` o `?subEstado=2x`
 * habrían devuelto reservas terminales. El fix COMBINA `notIn` + `equals`: un filtro por un
 * valor terminal produce un `where` incompatible (equals X + notIn [..X..]) → lista vacía.
 *
 * Aquí se MOCKEA `PrismaService` (`$transaction`/`fijarTenant`/`reserva`) para capturar el
 * `where` que el adaptador pasa a `findMany`/`count`, SIN tocar la BD (hexagonal). Se
 * verifica también que `tenant_id` viaja SIEMPRE en el `where` (defensa en profundidad).
 */
import { EstadoReserva, Prisma, SubEstadoConsulta } from '@prisma/client';
import { ListarReservasPrismaAdapter } from '../infrastructure/listar-reservas.prisma.adapter';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { PipelineQueryFiltros } from '../application/listar-reservas.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';

const ESTADOS_CERRADOS = [
  EstadoReserva.reserva_completada,
  EstadoReserva.reserva_cancelada,
];
const SUB_ESTADOS_TERMINALES = [
  SubEstadoConsulta.s2x,
  SubEstadoConsulta.s2y,
  SubEstadoConsulta.s2z,
];

/**
 * `PrismaService` falso: `$transaction(cb)` invoca el callback con un `tx` cuyo
 * `reserva.findMany`/`reserva.count` son espías que capturan su argumento `where` y
 * devuelven, respectivamente, lista vacía y 0 (el mapeo del read-model no se ejercita).
 */
const crearPrismaFake = (): {
  prisma: PrismaService;
  findMany: jest.Mock;
  count: jest.Mock;
  fijarTenant: jest.Mock;
} => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const fijarTenant = jest.fn(async () => undefined);
  const tx = { reserva: { findMany, count } };
  const $transaction = jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx));
  const prisma = { $transaction, fijarTenant } as unknown as PrismaService;
  return { prisma, findMany, count, fijarTenant };
};

const filtros = (
  over: Partial<PipelineQueryFiltros> = {},
): PipelineQueryFiltros => ({ tenantId: TENANT, page: 1, limit: 20, ...over });

/** Extrae el `where` con que se invocó `findMany` (el mismo que recibe `count`). */
const whereDeFindMany = (findMany: jest.Mock): Prisma.ReservaWhereInput =>
  (findMany.mock.calls[0][0] as { where: Prisma.ReservaWhereInput }).where;

describe('ListarReservasPrismaAdapter — exclusión de terminales/cerrados (hallazgo ALTA)', () => {
  it('debe_excluir_siempre_terminales_y_cerrados_cuando_no_hay_filtro_de_estado', async () => {
    const { prisma, findMany } = crearPrismaFake();
    const adapter = new ListarReservasPrismaAdapter(prisma);

    await adapter.listarActivas(filtros());

    const where = whereDeFindMany(findMany);
    expect(where.estado).toEqual({ notIn: ESTADOS_CERRADOS });
    // SIN filtro de subEstado la exclusión de terminales se aplica ADMITIENDO NULL
    // (estados `pre_reserva`/`reserva_confirmada`/... tienen `sub_estado IS NULL`) y se
    // combina vía `AND` para no pisar el `OR` de `search`. `NULL NOT IN (...)` excluiría
    // esas filas, de ahí el `OR: [{ subEstado: null }, { subEstado: { notIn } }]`.
    expect(where.subEstado).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          { subEstado: null },
          { subEstado: { notIn: SUB_ESTADOS_TERMINALES } },
        ],
      },
    ]);
    expect(where.tenantId).toBe(TENANT);
  });

  it('debe_combinar_notIn_y_equals_cuando_llega_filtro_estado_reserva_completada_terminal', async () => {
    // ?estado=reserva_completada: la exclusión NO se sustituye por la igualdad; ambas
    // coexisten (equals reserva_completada + notIn [.., reserva_completada]) → 0 filas.
    const { prisma, findMany, count } = crearPrismaFake();
    const adapter = new ListarReservasPrismaAdapter(prisma);

    const pagina = await adapter.listarActivas(
      filtros({ estado: 'reserva_completada' }),
    );

    const where = whereDeFindMany(findMany);
    expect(where.estado).toEqual({
      equals: EstadoReserva.reserva_completada,
      notIn: ESTADOS_CERRADOS,
    });
    // El where pide un estado que la exclusión veta: la lista es vacía.
    expect(pagina.items).toEqual([]);
    expect(pagina.total).toBe(0);
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('debe_combinar_notIn_y_equals_cuando_llega_filtro_subEstado_2x_terminal', async () => {
    // ?subEstado=2x: análogo — equals s2x + notIn [.., s2x] → 0 filas.
    const { prisma, findMany } = crearPrismaFake();
    const adapter = new ListarReservasPrismaAdapter(prisma);

    const pagina = await adapter.listarActivas(filtros({ subEstado: '2x' }));

    const where = whereDeFindMany(findMany);
    expect(where.subEstado).toEqual({
      equals: SubEstadoConsulta.s2x,
      notIn: SUB_ESTADOS_TERMINALES,
    });
    expect(pagina.items).toEqual([]);
    expect(pagina.total).toBe(0);
  });

  it('debe_conservar_el_filtro_por_un_estado_ACTIVO_combinado_con_la_exclusion', async () => {
    // ?estado=pre_reserva (activo): equals pre_reserva + notIn [cerrados] → filtra normal.
    const { prisma, findMany } = crearPrismaFake();
    const adapter = new ListarReservasPrismaAdapter(prisma);

    await adapter.listarActivas(filtros({ estado: 'pre_reserva' }));

    const where = whereDeFindMany(findMany);
    expect(where.estado).toEqual({
      equals: EstadoReserva.pre_reserva,
      notIn: ESTADOS_CERRADOS,
    });
    expect(where.tenantId).toBe(TENANT);
  });

  it('debe_conservar_el_filtro_por_un_subEstado_ACTIVO_combinado_con_la_exclusion', async () => {
    const { prisma, findMany } = crearPrismaFake();
    const adapter = new ListarReservasPrismaAdapter(prisma);

    await adapter.listarActivas(filtros({ subEstado: '2b' }));

    const where = whereDeFindMany(findMany);
    expect(where.subEstado).toEqual({
      equals: SubEstadoConsulta.s2b,
      notIn: SUB_ESTADOS_TERMINALES,
    });
  });

  it('debe_fijar_el_tenant_RLS_dentro_de_la_transaccion_de_lectura', async () => {
    const { prisma, fijarTenant } = crearPrismaFake();
    const adapter = new ListarReservasPrismaAdapter(prisma);

    await adapter.listarActivas(filtros());

    expect(fijarTenant).toHaveBeenCalledTimes(1);
    expect(fijarTenant.mock.calls[0][1]).toBe(TENANT);
  });
});
