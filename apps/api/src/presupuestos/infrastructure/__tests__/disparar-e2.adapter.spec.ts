/**
 * TESTS del `DispararE2Adapter` — fase TDD RED del change
 * `condiciones-particulares-senal-y-recordatorio-liquidacion`.
 *
 * REVIERTE la parte E2 de la "Mejora B": el email de presupuesto (E2) vuelve a adjuntar
 * ÚNICAMENTE el PDF del presupuesto y DEJA de invocar `GenerarPdfCondicionesPort` / adjuntar
 * las condicions particulars (que pasan a la factura de la señal, E3). Por tanto el adapter
 * pierde su tercera dependencia (`generarCondiciones`): el constructor vuelve a 2 argumentos.
 *
 * Comportamiento esperado tras la reversión:
 *   (a) presupuesto presente → el motor recibe UN ÚNICO adjunto (`presupuesto`).
 *   (b) presupuesto `null`   → `adjuntos: []`, sin fallar.
 *   (c) comportamiento actual intacto: la reserva se resuelve bajo RLS y el motor de email
 *       (idempotente por `(reserva, E2)`) recibe el comando E2 con `codigoEmail='E2'`.
 *   (d) sin numeroPresupuesto → fallback `Presupuesto {nombre} {apellidos}.pdf`.
 *   (e) propaga el idioma de la RESERVA al motor.
 *
 * ESTRATEGIA: UNIT con dobles (no toca la BD real). Se dobla `PrismaService`
 * (`$transaction`/`fijarTenant`) y `DespacharEmailService.despachar` (espía el comando).
 *
 * RED: el `DispararE2Adapter` vivo SIGUE recibiendo `GenerarPdfCondicionesPort` (constructor de
 * 3 args) y AÑADE el adjunto de condiciones. Construirlo con 2 argumentos no compila y los
 * asserts de "un solo adjunto" fallan → batería en ROJO. GREEN es de `backend-developer`.
 */
import { DispararE2Adapter } from '../disparar-e2.adapter';
import type {
  DespacharEmailComando,
  DespacharEmailService,
} from '../../../comunicaciones/application/despachar-email.service';
import type { PrismaService } from '../../../shared/prisma/prisma.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-2b';

/** Fila RESERVA (con cliente) que resuelve la tx del adapter. */
const reservaConCliente = (idioma = 'es') => ({
  idReserva: RESERVA_ID,
  codigo: 'R-0001',
  idioma,
  cliente: {
    idCliente: 'cli-1',
    nombre: 'Anna',
    apellidos: 'Puig Soler',
    email: 'anna@example.com',
    telefono: '600000000',
  },
});

/**
 * Doble de `PrismaService`: `$transaction(cb)` corre el callback con un `tx` cuyo
 * `reserva.findFirst` devuelve la fila dada; `fijarTenant` es un no-op espiado.
 */
const prismaFalso = (reserva: ReturnType<typeof reservaConCliente> | null): PrismaService => {
  const tx = { reserva: { findFirst: jest.fn(async () => reserva) } };
  return {
    fijarTenant: jest.fn(async () => undefined),
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
};

const motorFalso = (): jest.Mocked<Pick<DespacharEmailService, 'despachar'>> => ({
  despachar: jest.fn(async (_comando: DespacharEmailComando) => ({}) as never),
});

/**
 * Construye el adapter con SOLO 2 argumentos (post-reversión). Se usa un cast del constructor
 * a `any` porque en RED la firma viva aún exige el 3.er argumento; el cambio de firma lo aplica
 * el backend-developer. Al invocarlo con 2 args el test verifica que el adapter YA NO depende
 * del puerto de condiciones.
 */
const construirAdapter = (
  motor: ReturnType<typeof motorFalso>,
  prisma: PrismaService,
): DispararE2Adapter =>
  new (DispararE2Adapter as unknown as new (
    m: DespacharEmailService,
    p: PrismaService,
  ) => DispararE2Adapter)(motor as unknown as DespacharEmailService, prisma);

// ===========================================================================
// (a) — presupuesto presente → UN ÚNICO adjunto (sin condiciones).
// ===========================================================================

describe('DispararE2Adapter — un único adjunto de presupuesto (reversión Mejora B)', () => {
  it('debe_adjuntar_SOLO_el_presupuesto_sin_condiciones', async () => {
    const motor = motorFalso();
    const adaptador = construirAdapter(motor, prismaFalso(reservaConCliente()));

    await adaptador.disparar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
      numeroPresupuesto: '2026001',
    });

    expect(motor.despachar).toHaveBeenCalledTimes(1);
    const comando = motor.despachar.mock.calls[0][0];
    // UN solo adjunto: el presupuesto. Ninguna entrada de condiciones.
    expect(comando.adjuntos).toEqual([
      {
        clave: 'presupuesto',
        nombre: 'P2026001 Anna Puig Soler.pdf',
        pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
      },
    ]);
    expect(comando.adjuntos).toHaveLength(1);
    expect(
      (comando.adjuntos as ReadonlyArray<{ clave: string }>).some(
        (a) => a.clave === 'condiciones',
      ),
    ).toBe(false);
  });
});

// ===========================================================================
// (b) — presupuesto null → adjuntos vacíos, sin fallar.
// ===========================================================================

describe('DispararE2Adapter — sin presupuesto → adjuntos vacíos', () => {
  it('debe_despachar_con_adjuntos_vacios_sin_lanzar', async () => {
    const motor = motorFalso();
    const adaptador = construirAdapter(motor, prismaFalso(reservaConCliente()));

    await expect(
      adaptador.disparar({ tenantId: TENANT, reservaId: RESERVA_ID, pdfUrl: null }),
    ).resolves.toBeUndefined();

    const comando = motor.despachar.mock.calls[0][0];
    expect(comando.adjuntos).toEqual([]);
  });
});

// ===========================================================================
// (c) — comportamiento actual intacto: RLS + comando E2 al motor idempotente.
// ===========================================================================

describe('DispararE2Adapter — comportamiento E2 actual intacto', () => {
  it('debe_resolver_la_reserva_bajo_RLS_y_despachar_el_codigo_E2_con_los_datos_de_reserva_cliente', async () => {
    const motor = motorFalso();
    const prisma = prismaFalso(reservaConCliente());
    const adaptador = construirAdapter(motor, prisma);

    await adaptador.disparar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
    });

    expect(prisma.fijarTenant).toHaveBeenCalledWith(expect.anything(), TENANT);
    const comando = motor.despachar.mock.calls[0][0];
    expect(comando.tenantId).toBe(TENANT);
    expect(comando.codigoEmail).toBe('E2');
    expect(comando.reserva).toEqual({ idReserva: RESERVA_ID, codigo: 'R-0001' });
    expect(comando.cliente.email).toBe('anna@example.com');
  });

  it('no_debe_despachar_cuando_la_reserva_no_existe_o_no_tiene_cliente', async () => {
    const motor = motorFalso();
    const adaptador = construirAdapter(motor, prismaFalso(null));

    await adaptador.disparar({ tenantId: TENANT, reservaId: RESERVA_ID, pdfUrl: null });

    expect(motor.despachar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// (d) — sin numeroPresupuesto → fallback 'Presupuesto {nombre} {apellidos}.pdf'.
// ===========================================================================

describe('DispararE2Adapter — fallback de nombre cuando no hay número de presupuesto', () => {
  it('debe_usar_prefijo_Presupuesto_cuando_numeroPresupuesto_es_null', async () => {
    const motor = motorFalso();
    const adaptador = construirAdapter(motor, prismaFalso(reservaConCliente()));

    await adaptador.disparar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
      numeroPresupuesto: null,
    });

    const comando = motor.despachar.mock.calls[0][0];
    expect(comando.adjuntos).toEqual([
      {
        clave: 'presupuesto',
        nombre: 'Presupuesto Anna Puig Soler.pdf',
        pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
      },
    ]);
  });
});

// ===========================================================================
// (e) — El disparo de E2 PROPAGA el idioma de la RESERVA al motor.
// ===========================================================================

describe('DispararE2Adapter — propaga el idioma de la RESERVA al motor', () => {
  it('debe_pasar_idioma_ca_al_motor_cuando_la_reserva_esta_en_catalan', async () => {
    const motor = motorFalso();
    const adaptador = construirAdapter(motor, prismaFalso(reservaConCliente('ca')));

    await adaptador.disparar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
    });

    expect(motor.despachar).toHaveBeenCalledWith(
      expect.objectContaining({ idioma: 'ca' }),
    );
  });
});
