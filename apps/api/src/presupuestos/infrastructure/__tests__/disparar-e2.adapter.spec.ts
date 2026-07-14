/**
 * TESTS del `DispararE2Adapter` con el ADJUNTO de "Condicions particulars"
 * (épico #6, rebanada 6.4a `documentos-condiciones-particulares-pdf`) — fase TDD RED.
 * tasks.md Fase 2: 2.7.
 *
 * Trazabilidad: design.md §"Bloque B — Adjuntar condiciones al E2". El adapter gana
 * la dependencia inyectada `GenerarPdfCondicionesPort` (token
 * `GENERAR_PDF_CONDICIONES_PORT`). Tras resolver el presupuesto, resuelve la URL de
 * condiciones y AÑADE `{ clave: 'condiciones', nombre: 'condicions-particulars.pdf',
 * pdfUrl }` al array de adjuntos; si condiciones devuelve `null` se omite SIN romper
 * el E2 (post-commit fire-and-forget). El presupuesto se adjunta igual que hoy.
 *
 * Comportamiento:
 *   (a) presupuesto + condiciones presentes → el motor recibe DOS adjuntos
 *       (`presupuesto` + `condiciones`).
 *   (b) condiciones `null`                  → SOLO el adjunto `presupuesto`.
 *   (c) `pdfUrl` presupuesto `null` y condiciones `null` → `adjuntos: []`, sin fallar.
 *   (d) idempotencia/comportamiento actual intactos: la reserva se resuelve bajo RLS
 *       y el motor de email (idempotente por `(reserva, E2)`) sigue recibiendo el
 *       comando E2 con `codigoEmail='E2'` y los datos de reserva/cliente.
 *
 * ESTRATEGIA: UNIT con dobles (no toca la BD real). Se dobla `PrismaService`
 * (`$transaction`/`fijarTenant`), `DespacharEmailService.despachar` (espía el comando)
 * y `GenerarPdfCondicionesPort.generar`.
 *
 * RED: el `DispararE2Adapter` aún NO recibe `GenerarPdfCondicionesPort` (constructor
 * de 2 args) ni añade el adjunto de condiciones. Construirlo con el tercer argumento
 * no compila y las aserciones del segundo adjunto fallan → batería en ROJO. GREEN es
 * de `backend-developer`.
 */
import { DispararE2Adapter } from '../disparar-e2.adapter';
import type {
  DespacharEmailComando,
  DespacharEmailService,
} from '../../../comunicaciones/application/despachar-email.service';
import type { PrismaService } from '../../../shared/prisma/prisma.service';
import type { GenerarPdfCondicionesPort } from '../../../documentos/domain/generar-pdf-condiciones.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-2b';

/** Fila RESERVA (con cliente) que resuelve la tx del adapter. */
const reservaConCliente = () => ({
  idReserva: RESERVA_ID,
  codigo: 'R-0001',
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

const condicionesQueDevuelve = (valor: string | null): GenerarPdfCondicionesPort => ({
  generar: jest.fn(async () => valor),
});

/** Doble que LANZA al generar condiciones (p. ej. fallo de render react-pdf/subida). */
const condicionesQueLanza = (): GenerarPdfCondicionesPort => ({
  generar: jest.fn(async () => {
    throw new Error('fallo de render react-pdf');
  }),
});

// ===========================================================================
// 2.7 (a) — presupuesto + condiciones → DOS adjuntos.
// ===========================================================================

describe('DispararE2Adapter — dos adjuntos con presupuesto y condiciones (2.7a)', () => {
  it('debe_adjuntar_presupuesto_y_condicions_particulars', async () => {
    // Arrange
    const motor = motorFalso();
    const condiciones = condicionesQueDevuelve('https://storage.local/condiciones/T.pdf');
    const adaptador = new DispararE2Adapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(reservaConCliente()),
      condiciones,
    );

    // Act
    await adaptador.disparar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
    });

    // Assert — el motor recibe DOS adjuntos, con las claves y nombres esperados.
    expect(motor.despachar).toHaveBeenCalledTimes(1);
    const comando = motor.despachar.mock.calls[0][0];
    expect(comando.adjuntos).toEqual([
      {
        clave: 'presupuesto',
        nombre: 'presupuesto.pdf',
        pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
      },
      {
        clave: 'condiciones',
        nombre: 'condicions-particulars.pdf',
        pdfUrl: 'https://storage.local/condiciones/T.pdf',
      },
    ]);
    // Se pidió el PDF de condiciones para el tenant del disparo.
    expect(condiciones.generar).toHaveBeenCalledWith({ tenantId: TENANT });
  });
});

// ===========================================================================
// 2.7 (b) — condiciones null → solo el adjunto presupuesto, sin fallar.
// ===========================================================================

describe('DispararE2Adapter — condiciones null omite el segundo adjunto (2.7b)', () => {
  it('debe_adjuntar_solo_el_presupuesto_cuando_condiciones_es_null', async () => {
    // Arrange
    const motor = motorFalso();
    const adaptador = new DispararE2Adapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(reservaConCliente()),
      condicionesQueDevuelve(null),
    );

    // Act
    await adaptador.disparar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
    });

    // Assert — un solo adjunto; el E2 no se rompe por la ausencia de condiciones.
    const comando = motor.despachar.mock.calls[0][0];
    expect(comando.adjuntos).toEqual([
      {
        clave: 'presupuesto',
        nombre: 'presupuesto.pdf',
        pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
      },
    ]);
  });
});

// ===========================================================================
// 2.7 (c) — presupuesto null y condiciones null → adjuntos vacíos, sin fallar.
// ===========================================================================

describe('DispararE2Adapter — sin presupuesto ni condiciones → adjuntos vacíos (2.7c)', () => {
  it('debe_despachar_con_adjuntos_vacios_sin_lanzar', async () => {
    // Arrange
    const motor = motorFalso();
    const adaptador = new DispararE2Adapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(reservaConCliente()),
      condicionesQueDevuelve(null),
    );

    // Act / Assert — no lanza.
    await expect(
      adaptador.disparar({ tenantId: TENANT, reservaId: RESERVA_ID, pdfUrl: null }),
    ).resolves.toBeUndefined();

    const comando = motor.despachar.mock.calls[0][0];
    expect(comando.adjuntos).toEqual([]);
  });
});

// ===========================================================================
// 2.7 (d) — comportamiento actual intacto: RLS + comando E2 al motor idempotente.
// ===========================================================================

describe('DispararE2Adapter — comportamiento E2 actual intacto (2.7d)', () => {
  it('debe_resolver_la_reserva_bajo_RLS_y_despachar_el_codigo_E2_con_los_datos_de_reserva_cliente', async () => {
    // Arrange
    const motor = motorFalso();
    const prisma = prismaFalso(reservaConCliente());
    const adaptador = new DispararE2Adapter(
      motor as unknown as DespacharEmailService,
      prisma,
      condicionesQueDevuelve('https://storage.local/condiciones/T.pdf'),
    );

    // Act
    await adaptador.disparar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
    });

    // Assert — RLS fijado y comando E2 con reserva/cliente (idempotencia la garantiza
    // el motor por (reserva, E2); aquí verificamos que el comando llega intacto).
    expect(prisma.fijarTenant).toHaveBeenCalledWith(expect.anything(), TENANT);
    const comando = motor.despachar.mock.calls[0][0];
    expect(comando.tenantId).toBe(TENANT);
    expect(comando.codigoEmail).toBe('E2');
    expect(comando.reserva).toEqual({ idReserva: RESERVA_ID, codigo: 'R-0001' });
    expect(comando.cliente.email).toBe('anna@example.com');
  });

  it('no_debe_despachar_cuando_la_reserva_no_existe_o_no_tiene_cliente', async () => {
    // Guarda actual: sin reserva/cliente no se dispara el E2 (ni se piden condiciones).
    const motor = motorFalso();
    const condiciones = condicionesQueDevuelve('https://storage.local/condiciones/T.pdf');
    const adaptador = new DispararE2Adapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(null),
      condiciones,
    );

    await adaptador.disparar({ tenantId: TENANT, reservaId: RESERVA_ID, pdfUrl: null });

    expect(motor.despachar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2.7 (e) — un FALLO al generar condiciones no rompe el E2 (fire-and-forget).
// ===========================================================================

describe('DispararE2Adapter — fallo de condiciones no propaga (2.7e)', () => {
  it('debe_despachar_solo_el_presupuesto_cuando_generar_condiciones_lanza', async () => {
    // Arrange — la generación de condiciones lanza (fallo real de render/subida, p. ej.
    // la flakiness ESM). El E2 es post-commit: un fallo del adjunto NUNCA debe propagar
    // ni tumbar la pre_reserva ya commiteada.
    const motor = motorFalso();
    const adaptador = new DispararE2Adapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(reservaConCliente()),
      condicionesQueLanza(),
    );

    // Act / Assert — no lanza y despacha el E2 con solo el presupuesto.
    await expect(
      adaptador.disparar({
        tenantId: TENANT,
        reservaId: RESERVA_ID,
        pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
      }),
    ).resolves.toBeUndefined();

    const comando = motor.despachar.mock.calls[0][0];
    expect(comando.adjuntos).toEqual([
      {
        clave: 'presupuesto',
        nombre: 'presupuesto.pdf',
        pdfUrl: 'https://storage.local/presupuestos/T/p.pdf',
      },
    ]);
  });
});
