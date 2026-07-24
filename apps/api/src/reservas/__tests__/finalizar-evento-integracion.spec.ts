/**
 * TESTS DE INTEGRACIÓN de la finalización manual del evento (US-034 / UC-25)
 * — fase TDD RED. tasks.md Fase 3: 3.3 (happy path con fianza), 3.4 (sin fianza),
 * 3.5 (dato anómalo), 3.6 (fallo de E5), 3.7 (conflicto de estado / irreversibilidad),
 * 3.10 (RLS multi-tenant).
 *
 * Trazabilidad: US-034; spec-delta `consultas` (transición evento_en_curso → post_evento,
 * irreversible, guarda de origen declarativa, auditoría `accion='transicion'` origen
 * Usuario) y spec-delta `comunicaciones` (E5 condicionado a `fianza_eur > 0`, NULL/0 == sin
 * fianza, alerta de dato anómalo, transición↔envío separados, NPS programada). Contrato
 * congelado `docs/api-spec.yml` op `finalizarEvento`. design.md §D-2/§D-4/§D-5/§D-8/§D-9.
 *
 * INTEGRACIÓN REAL contra el Postgres AISLADO de tests (`slotify_test`, `.env.test`) — NO
 * mocks (memoria del proyecto: "US-049 backend nunca probado contra BD real"): la
 * transición, la COMUNICACION E5 y el AUDIT_LOG se verifican por el ESTADO DE LA BD real.
 * El envío de E5 usa el `FakeEmailAdapter` (EMAIL_TRANSPORT=fake, cero red) al que se le
 * puede FORZAR un fallo del proveedor (`forzarFallo`) para el caso 3.6. Fechas/emails
 * propios; se limpia el sembrado. NO depende del deadlock 40P01 flaky de US-004 (US-034 no
 * toca FECHA_BLOQUEADA). BD aislada (memoria: "Tests con BD aislada slotify_test").
 *
 * RED: aún NO existe `reservas/application/finalizar-evento.use-case.ts` ni su cableado en
 * `ReservasModule` (token `FINALIZAR_EVENTO_*`). El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba: no es fallo de
 * infra). GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  EstadoReserva,
  FianzaStatus,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  FinalizarEventoUseCase,
  type FinalizarEventoComando,
} from '../application/finalizar-evento.use-case';
import { ENVIAR_EMAIL_PORT } from '../../comunicaciones/comunicaciones.tokens';
import type { FakeEmailAdapter } from '../../comunicaciones/infrastructure/fake-email.adapter';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us034-int.test';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: FinalizarEventoUseCase;
let fakeEmail: FakeEmailAdapter;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/** Siembra una RESERVA en `evento_en_curso` con la fianza indicada y un CLIENTE con email. */
const sembrarEnCurso = async (params: {
  fianzaEur?: string | null;
  fianzaStatus?: FianzaStatus;
  estado?: EstadoReserva;
  tenantId?: string;
} = {}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Nadia',
      apellidos: 'Ferrer',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U034-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.evento_en_curso,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2028-05-10T00:00:00.000Z'),
      fianzaEur: params.fianzaEur === undefined ? '1000.00' : params.fianzaEur,
      fianzaStatus: params.fianzaStatus ?? FianzaStatus.cobrada,
    },
  });
  return reserva.idReserva;
};

const comando = (
  reservaId: string,
  over: Partial<FinalizarEventoComando> = {},
): FinalizarEventoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  ...over,
});

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });

const comunicacionesE5 = (reservaId: string) =>
  prisma.comunicacion.findMany({ where: { reservaId, codigoEmail: 'E5' } });

const transicionesDe = (reservaId: string) =>
  prisma.auditLog.findMany({
    where: { entidadId: reservaId, accion: 'transicion' },
  });

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { clienteId: { in: clienteIds } },
    select: { idReserva: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  if (ids.length > 0) {
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (clienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(FinalizarEventoUseCase);
  fakeEmail = moduleRef.get(ENVIAR_EMAIL_PORT);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.3 — Happy path con fianza: estado → post_evento; SIN COMUNICACION E5 (el flujo de
//        solicitud de IBAN E5 se eliminó en fix-liquidacion-fianza-independientes);
//        e5.resultado=no_aplica; AUDIT_LOG transicion origen Usuario con
//        datos_anteriores/datos_nuevos correctos.
// ===========================================================================

describe('Finalizar evento — happy path con fianza sin E5 (3.3)', () => {
  it('debe_pasar_a_post_evento_sin_crear_comunicacion_e5_y_auditar_como_usuario', async () => {
    const reservaId = await sembrarEnCurso({ fianzaEur: '1000.00' });

    const resultado = await useCase.ejecutar(comando(reservaId));

    // Estado persistido = post_evento.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(resultado.estado).toBe('post_evento');

    // NO se crea COMUNICACION E5 (flujo eliminado); e5.resultado=no_aplica.
    expect(await comunicacionesE5(reservaId)).toHaveLength(0);
    expect(resultado.e5.resultado).toBe('no_aplica');
    expect(resultado.e5.comunicacionId).toBeNull();

    // AUDIT_LOG de transición: origen Usuario (usuario_id poblado), datos correctos.
    const transiciones = await transicionesDe(reservaId);
    expect(transiciones).toHaveLength(1);
    expect(transiciones[0].entidad).toBe('RESERVA');
    expect(transiciones[0].usuarioId).toBe(GESTOR);
    expect((transiciones[0].datosAnteriores as { estado?: string })?.estado).toBe(
      'evento_en_curso',
    );
    expect((transiciones[0].datosNuevos as { estado?: string })?.estado).toBe(
      'post_evento',
    );
  });
});

// ===========================================================================
// 3.4 — Sin fianza (fianza_eur=0 y fianza_eur=NULL): estado → post_evento; SIN
//        COMUNICACION E5; e5.resultado=no_aplica; auditoría de transición registrada.
// ===========================================================================

describe('Finalizar evento — sin fianza no crea COMUNICACION E5 (3.4)', () => {
  it('no_debe_crear_comunicacion_e5_cuando_fianza_eur_es_cero', async () => {
    const reservaId = await sembrarEnCurso({
      fianzaEur: '0.00',
      fianzaStatus: FianzaStatus.pendiente,
    });

    const resultado = await useCase.ejecutar(comando(reservaId));

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(await comunicacionesE5(reservaId)).toHaveLength(0);
    expect(resultado.e5.resultado).toBe('no_aplica');
    expect(resultado.e5.comunicacionId).toBeNull();
    // La transición se audita igualmente.
    expect(await transicionesDe(reservaId)).toHaveLength(1);
  });

  it('no_debe_crear_comunicacion_e5_cuando_fianza_eur_es_null', async () => {
    const reservaId = await sembrarEnCurso({
      fianzaEur: null,
      fianzaStatus: FianzaStatus.pendiente,
    });

    const resultado = await useCase.ejecutar(comando(reservaId));

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(await comunicacionesE5(reservaId)).toHaveLength(0);
    expect(resultado.e5.resultado).toBe('no_aplica');
  });
});

// ===========================================================================
// 3.5 — Dato anómalo: fianza_status='cobrada' + fianza_eur IS NULL → sin E5 y ALERTA de
//        dato anómalo en AUDIT_LOG (accion='actualizar', motivo=dato_anomalo_fianza).
// ===========================================================================

describe('Finalizar evento — dato anómalo fianza cobrada sin importe (3.5)', () => {
  it('debe_tratar_como_sin_fianza_y_dejar_alerta_de_dato_anomalo_en_audit_log', async () => {
    const reservaId = await sembrarEnCurso({
      fianzaEur: null,
      fianzaStatus: FianzaStatus.cobrada,
    });

    const resultado = await useCase.ejecutar(comando(reservaId));

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(await comunicacionesE5(reservaId)).toHaveLength(0);
    expect(resultado.e5.resultado).toBe('no_aplica');

    // AUDIT_LOG contiene una entrada de alerta de dato anómalo referida a la reserva.
    const logs = await prisma.auditLog.findMany({ where: { entidadId: reservaId } });
    const alerta = logs.find(
      (l) => (l.datosNuevos as { motivo?: string })?.motivo === 'dato_anomalo_fianza',
    );
    expect(alerta).toBeDefined();
  });
});

// ===========================================================================
// 3.6 — fix-liquidacion-fianza-independientes: el flujo de E5 (solicitud de IBAN) se
//        eliminó, así que la finalización NO envía ningún email (no hay un E5 que pueda
//        fallar). Se conserva un único caso que verifica que, aun con fianza_eur>0 y con
//        el proveedor fake forzado a fallar, la finalización procede a post_evento SIN
//        crear ninguna COMUNICACION E5 (el proveedor ni siquiera se invoca).
// ===========================================================================

describe('Finalizar evento — la finalización no envía ningún email (3.6)', () => {
  it('debe_pasar_a_post_evento_sin_crear_comunicacion_e5_aunque_el_proveedor_este_caido', async () => {
    const reservaId = await sembrarEnCurso({ fianzaEur: '1000.00' });
    // Aunque el proveedor de email cayese, la finalización no dispara ningún envío.
    fakeEmail.forzarFallo(new Error('PROVEEDOR_EMAIL_CAIDO'));

    const resultado = await useCase.ejecutar(comando(reservaId));

    // La reserva queda en post_evento.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(resultado.estado).toBe('post_evento');

    // NO se crea COMUNICACION E5; e5.resultado=no_aplica.
    expect(await comunicacionesE5(reservaId)).toHaveLength(0);
    expect(resultado.e5.resultado).toBe('no_aplica');
    expect(resultado.e5.comunicacionId).toBeNull();

    // La transición se auditó igualmente.
    expect(await transicionesDe(reservaId)).toHaveLength(1);
  });
});

// ===========================================================================
// 3.7 — Conflicto de estado / irreversibilidad: finalizar una RESERVA en estado distinto
//        de evento_en_curso → rechazo (code=transicion_no_permitida), SIN mutar ni E5.
//        Incluye la segunda finalización de una ya en post_evento (irreversible).
// ===========================================================================

describe('Finalizar evento — conflicto de estado / irreversibilidad (3.7)', () => {
  it('debe_rechazar_sin_efectos_cuando_la_reserva_esta_en_reserva_confirmada', async () => {
    const reservaId = await sembrarEnCurso({ estado: EstadoReserva.reserva_confirmada });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'transicion_no_permitida',
    });

    // Sin mutación, sin COMUNICACION E5, sin AUDIT_LOG de transición.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_confirmada);
    expect(await comunicacionesE5(reservaId)).toHaveLength(0);
    expect(await transicionesDe(reservaId)).toHaveLength(0);
  });

  it('debe_rechazar_la_segunda_finalizacion_de_una_reserva_ya_en_post_evento_sin_re_disparar_e5', async () => {
    const reservaId = await sembrarEnCurso({ fianzaEur: '1000.00' });
    // Primera finalización efectiva.
    await useCase.ejecutar(comando(reservaId));
    const comsTras1 = await comunicacionesE5(reservaId);

    // Segunda finalización sobre la ya finalizada → conflicto (irreversible).
    await expect(useCase.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'transicion_no_permitida',
    });

    // Sigue en post_evento; NO se re-dispara E5; UNA sola transición auditada.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(await comunicacionesE5(reservaId)).toHaveLength(comsTras1.length);
    expect(await transicionesDe(reservaId)).toHaveLength(1);
  });
});

// ===========================================================================
// 3.10 — Multi-tenancy / RLS: un tenant NO puede finalizar la RESERVA de otro tenant
//         → 404 (invisible bajo RLS), sin mutar nada.
// ===========================================================================

describe('Finalizar evento — aislamiento multi-tenant / RLS (3.10)', () => {
  it('debe_rechazar_como_404_y_no_mutar_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const reservaId = await sembrarEnCurso({ fianzaEur: '1000.00' });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toMatchObject({ codigo: 'RESERVA_NO_ENCONTRADA' });

    // La reserva sigue en evento_en_curso, sin E5 ni transición.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);
    expect(await comunicacionesE5(reservaId)).toHaveLength(0);
    expect(await transicionesDe(reservaId)).toHaveLength(0);
  });
});
