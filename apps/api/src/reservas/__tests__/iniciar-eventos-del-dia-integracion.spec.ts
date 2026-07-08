/**
 * TESTS DE INTEGRACIÓN del barrido de INICIO AUTOMÁTICO DE EVENTO en T-0
 * (US-031 / UC-23, actor Sistema) — fase TDD RED. tasks.md Fase 3:
 * 3.3 (auditoría origen Sistema en BD), 3.6 (filtro estricto por estado), 3.7 (filtro
 * por fecha de calendario + blindaje off-by-one TZ), 3.8 (idempotencia 2.ª ejecución).
 *
 * Trazabilidad: US-031; spec-delta `consultas` (Requirements: "Transición atómica a
 * evento_en_curso solo con las tres precondiciones cumplidas", "Filtro estricto por
 * estado y fecha — solo reserva_confirmada con fecha_evento hoy", "Idempotencia del
 * barrido", "La auditoría del inicio automático registra el origen Sistema"); design.md
 * §D-3 (transición declarativa), §D-4 (selección por FECHA DE CALENDARIO —no string
 * formateado, blindaje del off-by-one de TZ conocido en `formatearFechaHora`— +
 * idempotencia), §D-5 (cross-tenant read / RLS write), §D-7 (adaptadores Prisma).
 *
 * Es un test de INTEGRACIÓN: ejercita el caso de uso REAL
 * `IniciarEventosDelDiaService` contra los adaptadores Prisma (listado cross-tenant de
 * candidatas por `date(fecha_evento) = CURRENT_DATE` AND `estado='reserva_confirmada'` +
 * UoW de transición con `$transaction` + `SET LOCAL app.tenant_id` + `SELECT … FOR
 * UPDATE`) sobre el Postgres AISLADO de tests (`slotify_test`, `.env.test`; memoria
 * "Tests con BD aislada slotify_test"). SIN Redis ni locks distribuidos (regla del
 * proyecto): la atomicidad por RESERVA se apoya en la transacción serializada por el
 * motor. Requiere el Postgres arriba + migración aplicada sobre `slotify_test`.
 *
 * RED: aún NO existen `application/iniciar-eventos-del-dia.service.ts`, sus puertos, ni
 * los adaptadores de listado/transición en `infrastructure/`, ni su registro en
 * `ReservasModule`; los imports/símbolos fallan y toda la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba, no es fallo de infra). GREEN es
 * de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  AccionAudit,
  CanalEntrada,
  EstadoReserva,
  FianzaStatus,
  LiquidacionStatus,
  PreEventoStatus,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { IniciarEventosDelDiaService } from '../application/iniciar-eventos-del-dia.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us031-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Fechas de EVENTO como FECHA DE CALENDARIO a mediodía UTC, RELATIVAS a "hoy", para que
 * la selección por `date(fecha_evento) = date(hoy)` (D-4) las incluya/excluya de forma
 * determinista, cualquiera que sea el día de ejecución. `fecha_evento` es `@db.Date`
 * (solo fecha); el mediodía UTC evita que un offset de TZ empuje la fecha de calendario
 * al día anterior/siguiente.
 */
const aMediodiaUTC = (offsetDias: number): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return new Date(base.getTime() + offsetDias * DIA_MS);
};
const HOY = aMediodiaUTC(0);
const AYER = aMediodiaUTC(-1);
const MANANA = aMediodiaUTC(1);

let moduleRef: TestingModule;
let prisma: PrismaService;
let servicio: IniciarEventosDelDiaService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/** Siembra una RESERVA con los tres `*_status` y `cond_part_firmadas` indicados. */
const sembrar = async (params: {
  fechaEvento: Date;
  estado?: EstadoReserva;
  preEventoStatus?: PreEventoStatus;
  liquidacionStatus?: LiquidacionStatus;
  fianzaStatus?: FianzaStatus;
  condPartFirmadas?: boolean;
  tenantId?: string;
}): Promise<{ reservaId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: { tenantId, nombre: 'Int', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U031I-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fechaEvento,
      preEventoStatus: params.preEventoStatus ?? PreEventoStatus.cerrado,
      liquidacionStatus: params.liquidacionStatus ?? LiquidacionStatus.cobrada,
      fianzaStatus: params.fianzaStatus ?? FianzaStatus.cobrada,
      condPartFirmadas: params.condPartFirmadas ?? true,
    },
  });
  return { reservaId: reserva.idReserva };
};

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });
const contarTransiciones = (reservaId: string): Promise<number> =>
  prisma.auditLog.count({
    where: { entidadId: reservaId, accion: AccionAudit.transicion },
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
  servicio = moduleRef.get(IniciarEventosDelDiaService);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.3 — Happy path (BD): RESERVA confirmada, fecha_evento = hoy, tres precondiciones →
//        estado = evento_en_curso + AUDIT_LOG transición origen Sistema con
//        datos_anteriores={estado:reserva_confirmada}, datos_nuevos={estado:
//        evento_en_curso}, usuario_id NO poblado.
// ===========================================================================

describe('Barrido US-031 — happy path: inicia evento de hoy y audita origen Sistema (3.3)', () => {
  it('debe_transicionar_a_evento_en_curso_y_auditar_transicion_origen_Sistema', async () => {
    const { reservaId } = await sembrar({ fechaEvento: HOY });

    const resumen = await servicio.ejecutar();
    expect(resumen.eventosIniciados).toBeGreaterThanOrEqual(1);

    // Transición de estado.
    const reserva = await leerReserva(reservaId);
    expect(reserva?.estado).toBe(EstadoReserva.evento_en_curso);

    // AUDIT_LOG: transición sobre RESERVA, origen Sistema (usuarioId NO poblado por
    // usuario), datos_anteriores.estado='reserva_confirmada', datos_nuevos.estado=
    // 'evento_en_curso'.
    const transiciones = await prisma.auditLog.findMany({
      where: { entidadId: reservaId, accion: AccionAudit.transicion },
    });
    expect(transiciones.length).toBe(1);
    const t = transiciones[0];
    expect(t.entidad).toBe('RESERVA');
    expect(t.usuarioId).toBeNull();
    expect(JSON.stringify(t.datosAnteriores)).toContain('reserva_confirmada');
    expect(JSON.stringify(t.datosNuevos)).toContain('evento_en_curso');
  });
});

// ===========================================================================
// 3.6 — Filtro estricto por estado: RESERVA en consulta / pre_reserva /
//        reserva_cancelada / reserva_completada / post_evento / evento_en_curso con
//        fecha_evento = hoy NO se transiciona (solo `reserva_confirmada` es candidata),
//        sin efectos secundarios ni auditoría.
// ===========================================================================

describe('Barrido US-031 — filtro estricto por estado (3.6)', () => {
  const noConfirmadas: ReadonlyArray<EstadoReserva> = [
    EstadoReserva.consulta,
    EstadoReserva.pre_reserva,
    EstadoReserva.reserva_cancelada,
    EstadoReserva.reserva_completada,
    EstadoReserva.post_evento,
    EstadoReserva.evento_en_curso,
  ];

  it.each(noConfirmadas)(
    'no_debe_transicionar_una_reserva_en_%s_aunque_su_fecha_evento_sea_hoy',
    async (estado) => {
      const { reservaId } = await sembrar({ fechaEvento: HOY, estado });

      await servicio.ejecutar();

      // Su estado no cambia (salvo evento_en_curso, que ya lo era) y no hay auditoría.
      expect((await leerReserva(reservaId))?.estado).toBe(estado);
      expect(await contarTransiciones(reservaId)).toBe(0);
    },
  );
});

// ===========================================================================
// 3.7 — Filtro por fecha de calendario (D-4): solo `date(fecha_evento) = date(hoy)`
//        entra; AYER y MAÑANA quedan fuera; y un evento de HOY definido a un instante EN
//        EL EXTREMO del día (23:00 UTC) sigue siendo candidato (blindaje del off-by-one
//        de TZ conocido en presentación `formatearFechaHora`): la selección es por fecha
//        de calendario en el backend, NO por string formateado.
// ===========================================================================

describe('Barrido US-031 — selección por fecha de calendario, no por string (3.7)', () => {
  it('debe_transicionar_solo_la_de_hoy_dejando_intactas_ayer_y_manana', async () => {
    const { reservaId: idHoy } = await sembrar({ fechaEvento: HOY });
    const { reservaId: idAyer } = await sembrar({ fechaEvento: AYER });
    const { reservaId: idManana } = await sembrar({ fechaEvento: MANANA });

    await servicio.ejecutar();

    expect((await leerReserva(idHoy))?.estado).toBe(EstadoReserva.evento_en_curso);
    expect((await leerReserva(idAyer))?.estado).toBe(EstadoReserva.reserva_confirmada);
    expect((await leerReserva(idManana))?.estado).toBe(EstadoReserva.reserva_confirmada);
  });

  it('debe_seleccionar_un_evento_de_hoy_aunque_su_instante_este_al_borde_del_dia', async () => {
    // Hoy a las 23:00 UTC: mismo DÍA DE CALENDARIO que HOY (mediodía), aunque un formateo
    // naive con offset podría empujarlo a mañana. La invariante: entra por
    // date(fecha_evento) = date(hoy), no por el instante ni por su representación.
    const hoyBorde = new Date(HOY.getTime());
    hoyBorde.setUTCHours(23, 0, 0, 0);
    const { reservaId } = await sembrar({ fechaEvento: hoyBorde });

    await servicio.ejecutar();

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);
  });
});

// ===========================================================================
// 3.8 — Idempotencia: (a) RESERVA ya en evento_en_curso (pase previo / gestor US-032) NO
//        es candidata, no muta, no duplica auditoría; (b) segunda ejecución del barrido
//        no re-transiciona ni duplica AUDIT_LOG (N ejecuciones = 1 transición).
// ===========================================================================

describe('Barrido US-031 — idempotencia (3.8)', () => {
  it('no_debe_tocar_una_reserva_ya_en_evento_en_curso_ni_auditar_de_nuevo', async () => {
    const { reservaId } = await sembrar({
      fechaEvento: HOY,
      estado: EstadoReserva.evento_en_curso,
    });

    await servicio.ejecutar();

    expect(await contarTransiciones(reservaId)).toBe(0);
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);
  });

  it('no_debe_re_transicionar_ni_duplicar_auditoria_en_una_segunda_ejecucion', async () => {
    const { reservaId } = await sembrar({ fechaEvento: HOY });

    await servicio.ejecutar();
    const resumen2 = await servicio.ejecutar();

    // 2.ª ejecución: ya en evento_en_curso → no es candidata → 0 inicios nuevos.
    expect(resumen2.eventosIniciados).toBe(0);
    // Exactamente UNA transición tras dos pases.
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});

// ===========================================================================
// 3.4 (BD) — Precondiciones incumplidas: alguna de las tres distinta de su valor →
//        NO transiciona (permanece reserva_confirmada), 0 auditorías de transición.
//        (La alerta crítica se cubre a nivel de aplicación en el use-case spec.)
// ===========================================================================

describe('Barrido US-031 — precondiciones incumplidas no transicionan (3.4 BD)', () => {
  it('no_debe_transicionar_cuando_liquidacion_no_esta_cobrada', async () => {
    const { reservaId } = await sembrar({
      fechaEvento: HOY,
      liquidacionStatus: LiquidacionStatus.facturada,
    });

    await servicio.ejecutar();

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_confirmada);
    expect(await contarTransiciones(reservaId)).toBe(0);
  });
});

// ===========================================================================
// D-5 — Cross-tenant read / RLS write: candidatas de tenants distintos se transicionan,
//        cada una bajo el contexto RLS de SU tenant (el tenant sale de la fila, nunca de
//        input externo). Ninguna escritura cruza tenant.
// ===========================================================================

describe('Barrido US-031 — cross-tenant read / RLS write (D-5)', () => {
  it('debe_iniciar_candidatas_de_varios_tenants_sin_cruzar_tenant', async () => {
    const { reservaId: a } = await sembrar({ fechaEvento: HOY, tenantId: TENANT });
    const { reservaId: b } = await sembrar({ fechaEvento: HOY, tenantId: OTRO_TENANT });

    await servicio.ejecutar();

    const ra = await leerReserva(a);
    const rb = await leerReserva(b);
    expect(ra?.estado).toBe(EstadoReserva.evento_en_curso);
    expect(rb?.estado).toBe(EstadoReserva.evento_en_curso);
    expect(ra?.tenantId).toBe(TENANT);
    expect(rb?.tenantId).toBe(OTRO_TENANT);
  });
});
