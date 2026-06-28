/**
 * TESTS del `UnidadDeTrabajoPrismaAdapter` (US-003 / UC-03) — retry-on-conflict
 * del `codigo` correlativo de RESERVA.
 *
 * Hallazgo MAYOR #2 del code-review: `generarCodigo` calcula el correlativo con un
 * `count(*)+1` no atómico; dos altas concurrentes pueden generar el mismo `codigo`.
 * La unicidad la garantiza el UNIQUE `reserva_codigo_key` (estilo del proyecto:
 * índice UNIQUE en PostgreSQL, SIN locks distribuidos). El adaptador resuelve la
 * carrera REABRIENDO la `$transaction` y reintentando ante `P2002` del `codigo`
 * (en PostgreSQL la P2002 aborta la transacción en curso, por eso se reabre).
 *
 * Aquí se mockea `PrismaService.$transaction` para simular la colisión de forma
 * determinista. La atomicidad real (UNIQUE + concurrencia) se valida en QA contra
 * la BD. Hexagonal: no se toca la BD.
 */
import { Prisma } from '@prisma/client';
import { UnidadDeTrabajoPrismaAdapter } from '../infrastructure/unidad-de-trabajo.prisma.adapter';
import type { PrismaService } from '../../shared/prisma/prisma.service';

const TENANT = '00000000-0000-0000-0000-000000000001';

const p2002Codigo = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`codigo`)',
    { code: 'P2002', clientVersion: '6.2.0', meta: { target: ['codigo'] } },
  );

const p2002Otro = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`email`)',
    { code: 'P2002', clientVersion: '6.2.0', meta: { target: ['email'] } },
  );

/**
 * `PrismaService` falso: `$transaction(cb)` invoca el callback con un `tx` ficticio
 * (el `trabajo` de los tests no usa los repos), salvo que `secuencia` indique que
 * un intento debe rechazar antes de ejecutar el callback.
 */
const crearPrismaFake = (
  secuencia: Array<'ok' | Error>,
): PrismaService & { $transaction: jest.Mock; fijarTenant: jest.Mock } => {
  let i = 0;
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const paso = secuencia[i] ?? 'ok';
    i += 1;
    if (paso !== 'ok') {
      throw paso;
    }
    return cb({} as unknown);
  });
  const fijarTenant = jest.fn(async () => undefined);
  return { $transaction, fijarTenant } as unknown as PrismaService & {
    $transaction: jest.Mock;
    fijarTenant: jest.Mock;
  };
};

describe('UnidadDeTrabajoPrismaAdapter — retry-on-conflict del codigo (MAYOR #2)', () => {
  it('debe_reintentar_la_transaccion_cuando_el_primer_intento_choca_con_P2002_del_codigo', async () => {
    // Primer intento: P2002 sobre `codigo`. Segundo intento: éxito.
    const prisma = crearPrismaFake([p2002Codigo(), 'ok']);
    const adapter = new UnidadDeTrabajoPrismaAdapter(prisma);

    const out = await adapter.ejecutar(TENANT, async () => 'alta-ok');

    expect(out).toBe('alta-ok');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2); // se reabrió la tx
  });

  it('debe_devolver_el_resultado_al_primer_intento_sin_reintentar_si_no_hay_colision', async () => {
    const prisma = crearPrismaFake(['ok']);
    const adapter = new UnidadDeTrabajoPrismaAdapter(prisma);

    const out = await adapter.ejecutar(TENANT, async () => 'alta-ok');

    expect(out).toBe('alta-ok');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('debe_propagar_el_P2002_del_codigo_tras_agotar_los_reintentos_red_de_seguridad', async () => {
    // Todos los intentos colisionan: el UNIQUE actúa de red de seguridad y el
    // P2002 final se propaga (el filtro global lo mapeará a 409). El presupuesto de
    // reintentos se amplió en US-004 (`MAX_INTENTOS_TRANSACCION`) para cubrir también
    // las colisiones de la fecha bloqueada y de la posición de cola.
    const MAX_INTENTOS_TRANSACCION = 12;
    const prisma = crearPrismaFake(
      Array.from({ length: MAX_INTENTOS_TRANSACCION }, () => p2002Codigo()),
    );
    const adapter = new UnidadDeTrabajoPrismaAdapter(prisma);

    const error = await adapter
      .ejecutar(TENANT, async () => 'nunca')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    expect(prisma.$transaction).toHaveBeenCalledTimes(MAX_INTENTOS_TRANSACCION);
  });

  it('NO_debe_reintentar_ante_un_P2002_ajeno_al_codigo_se_propaga_de_inmediato', async () => {
    const ajeno = p2002Otro();
    const prisma = crearPrismaFake([ajeno, 'ok']);
    const adapter = new UnidadDeTrabajoPrismaAdapter(prisma);

    // P2002 sobre otro índice (no `codigo`) NO se reintenta: se propaga tal cual.
    await expect(adapter.ejecutar(TENANT, async () => 'x')).rejects.toBe(ajeno);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('NO_debe_reintentar_ante_un_error_no_Prisma_se_propaga_de_inmediato', async () => {
    const inesperado = new Error('fallo de red');
    const prisma = crearPrismaFake([inesperado, 'ok']);
    const adapter = new UnidadDeTrabajoPrismaAdapter(prisma);

    await expect(adapter.ejecutar(TENANT, async () => 'x')).rejects.toBe(inesperado);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('debe_fijar_el_tenant_RLS_como_primera_operacion_en_cada_intento', async () => {
    const prisma = crearPrismaFake([p2002Codigo(), 'ok']);
    const adapter = new UnidadDeTrabajoPrismaAdapter(prisma);

    await adapter.ejecutar(TENANT, async () => 'ok');

    // Solo se ejecutó el callback en el intento exitoso → un fijarTenant con el
    // tenant del JWT (el intento fallido rechazó antes de entrar al callback).
    expect(prisma.fijarTenant).toHaveBeenCalledTimes(1);
    expect(prisma.fijarTenant.mock.calls[0][1]).toBe(TENANT);
  });
});
