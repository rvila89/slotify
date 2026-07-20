/**
 * TESTS del `ReenviarE2PresupuestoAdapter` (reenvío SIN cambios del presupuesto,
 * mejora de US-015 / UC-15) — change `presupuesto-edicion-reenvio-email-real`,
 * tasks.md 3.3 — fase TDD RED.
 *
 * CAUSA RAÍZ (design.md §Contexto): hoy `ReenviarE2PresupuestoAdapter.reenviar` es un
 * STUB — resuelve la RESERVA bajo RLS pero luego solo hace `void this.motorEmail;` y
 * retorna SIN invocar el motor de email → el correo del reenvío "sin cambios" NUNCA se
 * envía de verdad. Esta corrección exige que el adaptador DEJE DE SER no-op e invoque
 * `DespacharEmailService.despacharReenvio` (D1): salta la idempotencia, crea la ÚNICA
 * fila `COMUNICACION` E2 (`es_reenvio=true`) y ENVÍA por el transporte real.
 *
 * D2: el reenvío SIN cambios usa el texto E2 ESTÁNDAR (NO la marca de edición): el
 * comando al motor NO debe llevar `esEdicion:true`.
 *
 * ESTRATEGIA: UNIT con dobles (no toca la BD real). Se dobla `PrismaService`
 * (`$transaction`/`fijarTenant`) y `DespacharEmailService.despacharReenvio` (espía el
 * comando). El adjunto del presupuesto viaja por referencia (`pdf_url` del vigente).
 *
 * RED: el adaptador es hoy un stub (`void this.motorEmail;`), así que
 * `motor.despacharReenvio` NUNCA se llama y estas aserciones (invocación real +
 * codigoEmail E2 + sin marca de edición) FALLAN por comportamiento. GREEN es de
 * `backend-developer`.
 */
import { ReenviarE2PresupuestoAdapter } from '../reenviar-presupuesto.prisma.adapter';
import type {
  DespacharEmailComando,
  DespacharEmailService,
} from '../../../comunicaciones/application/despachar-email.service';
import type { PrismaService } from '../../../shared/prisma/prisma.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-prereserva';
const PDF_VIGENTE = 'https://storage.local/presupuestos/T/vigente.pdf';

/** Fila RESERVA (con cliente) que resuelve la tx del adaptador. */
const reservaConCliente = (idioma = 'es') => ({
  idReserva: RESERVA_ID,
  codigo: 'R-0001',
  idioma,
  clienteId: 'cli-1',
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
const prismaFalso = (
  reserva: ReturnType<typeof reservaConCliente> | null,
): PrismaService => {
  const tx = { reserva: { findFirst: jest.fn(async () => reserva) } };
  return {
    fijarTenant: jest.fn(async () => undefined),
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
};

/** Motor doble: espía `despacharReenvio` (el camino real del reenvío). */
const motorFalso = (): jest.Mocked<Pick<DespacharEmailService, 'despacharReenvio'>> => ({
  despacharReenvio: jest.fn(async (_comando: DespacharEmailComando) => ({}) as never),
});

// ===========================================================================
// El reenvío DEJA DE SER un no-op: invoca el motor por `despacharReenvio`.
// ===========================================================================

describe('ReenviarE2PresupuestoAdapter — invoca el motor de email (deja de ser stub)', () => {
  it('debe_invocar_despacharReenvio_con_codigo_E2_y_los_datos_de_reserva_cliente', async () => {
    const motor = motorFalso();
    const adaptador = new ReenviarE2PresupuestoAdapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(reservaConCliente()),
    );

    await adaptador.reenviar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: PDF_VIGENTE,
    });

    // El transporte real se ejerce por el camino de reenvío del motor (no idempotente).
    expect(motor.despacharReenvio).toHaveBeenCalledTimes(1);
    const comando = motor.despacharReenvio.mock.calls[0][0];
    expect(comando.codigoEmail).toBe('E2');
    expect(comando.tenantId).toBe(TENANT);
    expect(comando.reserva).toEqual({ idReserva: RESERVA_ID, codigo: 'R-0001' });
    expect(comando.cliente.email).toBe('anna@example.com');
  });

  it('debe_adjuntar_el_presupuesto_vigente_por_referencia', async () => {
    const motor = motorFalso();
    const adaptador = new ReenviarE2PresupuestoAdapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(reservaConCliente()),
    );

    await adaptador.reenviar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: PDF_VIGENTE,
    });

    const comando = motor.despacharReenvio.mock.calls[0][0];
    expect(comando.adjuntos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clave: 'presupuesto', pdfUrl: PDF_VIGENTE }),
      ]),
    );
  });

  it('NO_debe_marcar_esEdicion_el_reenvio_sin_cambios_usa_texto_E2_estandar', async () => {
    const motor = motorFalso();
    const adaptador = new ReenviarE2PresupuestoAdapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(reservaConCliente()),
    );

    await adaptador.reenviar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: PDF_VIGENTE,
    });

    // D2: el reenvío sin cambios NO lleva marca de edición (E2 estándar).
    const comando = motor.despacharReenvio.mock.calls[0][0] as DespacharEmailComando & {
      esEdicion?: boolean;
    };
    expect(comando.esEdicion ?? false).toBe(false);
  });

  it('debe_propagar_el_idioma_de_la_reserva_al_motor', async () => {
    const motor = motorFalso();
    const adaptador = new ReenviarE2PresupuestoAdapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(reservaConCliente('ca')),
    );

    await adaptador.reenviar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: PDF_VIGENTE,
    });

    expect(motor.despacharReenvio).toHaveBeenCalledWith(
      expect.objectContaining({ idioma: 'ca' }),
    );
  });

  it('no_debe_despachar_cuando_la_reserva_no_existe_o_no_tiene_cliente', async () => {
    const motor = motorFalso();
    const adaptador = new ReenviarE2PresupuestoAdapter(
      motor as unknown as DespacharEmailService,
      prismaFalso(null),
    );

    await adaptador.reenviar({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      pdfUrl: PDF_VIGENTE,
    });

    expect(motor.despacharReenvio).not.toHaveBeenCalled();
  });
});
