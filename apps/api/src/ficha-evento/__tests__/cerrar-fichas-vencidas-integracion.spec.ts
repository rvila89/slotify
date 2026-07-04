/**
 * TESTS DE INTEGRACIÓN del barrido de CIERRE AUTOMÁTICO de ficha operativa en T-1d
 * (US-026 / UC-20 FA-01, actor Sistema) — fase TDD RED. tasks.md Fase 3:
 * 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8.
 *
 * Trazabilidad: US-026; spec-delta `ficha-operativa` (todos los Requirements de cierre
 * automático A10: triplete de mutación, ficha vacía, filtro estricto por estado,
 * trigger solo `fecha_evento = mañana`, idempotencia, múltiples reservas, auditoría
 * origen Sistema causa A10); design.md §D-3 (transición declarativa), §D-4 (selección
 * por FECHA DE CALENDARIO —no string formateado, blindaje del off-by-one de TZ— +
 * idempotencia), §D-5 (cross-tenant read / RLS write), §D-7 (adaptadores Prisma).
 *
 * Es un test de INTEGRACIÓN: ejercita el caso de uso REAL
 * `CerrarFichasVencidasService` contra los adaptadores Prisma (listado cross-tenant de
 * candidatas + UoW de cierre con `$transaction` + `SET LOCAL app.tenant_id`) sobre el
 * Postgres AISLADO de tests (`slotify_test`, `.env.test`; ver memoria "Tests con BD
 * aislada slotify_test"). SIN Redis ni locks distribuidos (regla del proyecto): la
 * atomicidad por RESERVA se apoya en la transacción serializada por el motor. Requiere
 * el Postgres arriba + migración aplicada sobre `slotify_test`.
 *
 * Reutiliza la MUTACIÓN de cierre de US-025 (`ficha_cerrada`, `fecha_cierre`,
 * `pre_evento_status → cerrado`), forzada por Sistema (sin usuario, causa A10).
 *
 * RED: aún NO existen `application/cerrar-fichas-vencidas.service.ts`, sus puertos, ni
 * los adaptadores de listado/cierre en `infrastructure/`, ni su registro en
 * `FichaEventoModule`; los imports/símbolos fallan y toda la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba, no es fallo de infra). GREEN es
 * de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  AccionAudit,
  CanalEntrada,
  EstadoReserva,
  PreEventoStatus,
} from '@prisma/client';
import { FichaEventoModule } from '../ficha-evento.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CerrarFichasVencidasService } from '../application/cerrar-fichas-vencidas.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us026-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Fechas de EVENTO como FECHA DE CALENDARIO a mediodía UTC. Se calculan RELATIVAS a
 * "hoy" para que la selección por `date(fecha_evento) = date(hoy) + 1 día` (D-4) las
 * incluya/excluya de forma determinista, cualquiera que sea el día de ejecución. El
 * mediodía UTC evita que un offset de TZ empuje la fecha al día anterior/siguiente.
 */
const aMediodiaUTC = (offsetDias: number): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return new Date(base.getTime() + offsetDias * DIA_MS);
};
const HOY = aMediodiaUTC(0);
const MANANA = aMediodiaUTC(1);
const PASADO_MANANA = aMediodiaUTC(2);

let moduleRef: TestingModule;
let prisma: PrismaService;
let servicio: CerrarFichasVencidasService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/** Siembra una RESERVA con su FICHA_OPERATIVA 1:1 en el estado indicado. */
const sembrar = async (params: {
  fechaEvento: Date;
  estado?: EstadoReserva;
  preEventoStatus?: PreEventoStatus;
  tenantId?: string;
  fichaCerrada?: boolean;
}): Promise<{ reservaId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: { tenantId, nombre: 'Int', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U026I-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fechaEvento,
      preEventoStatus: params.preEventoStatus ?? PreEventoStatus.en_curso,
    },
  });
  await prisma.fichaOperativa.create({
    data: {
      reservaId: reserva.idReserva,
      fichaCerrada: params.fichaCerrada ?? false,
    },
  });
  return { reservaId: reserva.idReserva };
};

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });
const leerFicha = (reservaId: string) =>
  prisma.fichaOperativa.findUnique({ where: { reservaId } });
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
    await prisma.fichaOperativa.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (clienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), FichaEventoModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  servicio = moduleRef.get(CerrarFichasVencidasService);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.2 — Happy path: RESERVA confirmada, ficha en_curso, fecha_evento = mañana → cierre
//        del TRIPLETE (ficha_cerrada=true, fecha_cierre poblada, pre_evento_status →
//        cerrado) + AUDIT_LOG transición origen Sistema causa A10.
// ===========================================================================

describe('Barrido US-026 — happy path: cierra ficha en_curso de mañana (3.2)', () => {
  it('debe_cerrar_el_triplete_y_auditar_transicion_origen_Sistema_causa_A10', async () => {
    const { reservaId } = await sembrar({
      fechaEvento: MANANA,
      estado: EstadoReserva.reserva_confirmada,
      preEventoStatus: PreEventoStatus.en_curso,
    });

    const resumen = await servicio.ejecutar();
    expect(resumen.fichasCerradas).toBeGreaterThanOrEqual(1);

    // Triplete de mutación (reuso de US-025, forzado por Sistema).
    const ficha = await leerFicha(reservaId);
    expect(ficha?.fichaCerrada).toBe(true);
    expect(ficha?.fechaCierre).toBeInstanceOf(Date);
    const reserva = await leerReserva(reservaId);
    expect(reserva?.preEventoStatus).toBe(PreEventoStatus.cerrado);

    // AUDIT_LOG: transición sobre RESERVA, origen Sistema (usuarioId NO poblado por
    // usuario), causa A10 en datos_nuevos, datos_anteriores.pre_evento_status='en_curso'.
    const transiciones = await prisma.auditLog.findMany({
      where: { entidadId: reservaId, accion: AccionAudit.transicion },
    });
    expect(transiciones.length).toBe(1);
    const t = transiciones[0];
    expect(t.entidad).toBe('RESERVA');
    expect(t.usuarioId).toBeNull();
    expect(JSON.stringify(t.datosNuevos)).toContain('A10');
    expect(JSON.stringify(t.datosNuevos)).toContain('cerrado');
    expect(JSON.stringify(t.datosAnteriores)).toContain('en_curso');
  });
});

// ===========================================================================
// 3.3 — Ficha vacía (pendiente): se cierra IGUALMENTE, sin aviso ni error; la
//        auditoría registra datos_anteriores.pre_evento_status='pendiente'.
// ===========================================================================

describe('Barrido US-026 — ficha vacía en pendiente se cierra igual (3.3)', () => {
  it('debe_cerrar_la_ficha_pendiente_y_auditar_pendiente_como_estado_anterior', async () => {
    const { reservaId } = await sembrar({
      fechaEvento: MANANA,
      preEventoStatus: PreEventoStatus.pendiente,
    });

    await servicio.ejecutar();

    const reserva = await leerReserva(reservaId);
    const ficha = await leerFicha(reservaId);
    expect(reserva?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect(ficha?.fichaCerrada).toBe(true);

    const t = await prisma.auditLog.findFirst({
      where: { entidadId: reservaId, accion: AccionAudit.transicion },
    });
    expect(JSON.stringify(t?.datosAnteriores)).toContain('pendiente');
  });
});

// ===========================================================================
// 3.4 — Filtro estricto por estado: RESERVA en cancelada / pre_reserva /
//        reserva_completada / evento_en_curso / post_evento con fecha_evento = mañana
//        NO se cierra; ni RESERVA ni FICHA_OPERATIVA se modifican.
// ===========================================================================

describe('Barrido US-026 — filtro estricto por estado (3.4)', () => {
  const noConfirmadas: ReadonlyArray<EstadoReserva> = [
    EstadoReserva.reserva_cancelada,
    EstadoReserva.pre_reserva,
    EstadoReserva.reserva_completada,
    EstadoReserva.evento_en_curso,
    EstadoReserva.post_evento,
  ];

  it.each(noConfirmadas)(
    'no_debe_cerrar_una_reserva_en_%s_aunque_su_fecha_evento_sea_manana',
    async (estado) => {
      const { reservaId } = await sembrar({
        fechaEvento: MANANA,
        estado,
        preEventoStatus: PreEventoStatus.en_curso,
      });

      await servicio.ejecutar();

      const reserva = await leerReserva(reservaId);
      const ficha = await leerFicha(reservaId);
      expect(reserva?.preEventoStatus).toBe(PreEventoStatus.en_curso);
      expect(ficha?.fichaCerrada).toBe(false);
      expect(ficha?.fechaCierre).toBeNull();
      expect(await contarTransiciones(reservaId)).toBe(0);
    },
  );
});

// ===========================================================================
// 3.5 — Trigger solo fecha_evento = mañana: eventos de HOY y de PASADO MAÑANA NO entran
//        en el pase; solo el de mañana se cierra.
// ===========================================================================

describe('Barrido US-026 — trigger solo fecha_evento = mañana (3.5)', () => {
  it('debe_cerrar_solo_la_de_manana_dejando_intactas_hoy_y_pasado_manana', async () => {
    const { reservaId: idHoy } = await sembrar({ fechaEvento: HOY });
    const { reservaId: idManana } = await sembrar({ fechaEvento: MANANA });
    const { reservaId: idPasado } = await sembrar({ fechaEvento: PASADO_MANANA });

    await servicio.ejecutar();

    expect((await leerReserva(idManana))?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect((await leerReserva(idHoy))?.preEventoStatus).toBe(PreEventoStatus.en_curso);
    expect((await leerReserva(idPasado))?.preEventoStatus).toBe(PreEventoStatus.en_curso);
    expect((await leerFicha(idHoy))?.fichaCerrada).toBe(false);
    expect((await leerFicha(idPasado))?.fichaCerrada).toBe(false);
  });
});

// ===========================================================================
// 3.6 — INVARIANTE TZ (D-4): la selección se decide por FECHA DE CALENDARIO en el
//        backend (`date(fecha_evento) = date(hoy)+1`), NO por un string formateado
//        (deuda conocida de `formatearFechaHora`). Un evento de mañana definido a un
//        instante EN EL EXTREMO del día (23:00 UTC) sigue siendo candidato: la fecha de
//        calendario es la que manda, no la representación por horas/offset.
// ===========================================================================

describe('Barrido US-026 — selección por fecha de calendario, no por string (3.6)', () => {
  it('debe_seleccionar_un_evento_de_manana_aunque_su_instante_este_al_borde_del_dia', async () => {
    // Mañana a las 23:00 UTC: mismo DÍA DE CALENDARIO que MANANA (mediodía), aunque
    // un formateo naive con offset podría empujarlo a pasado mañana / hoy.
    const mananaBorde = new Date(MANANA.getTime());
    mananaBorde.setUTCHours(23, 0, 0, 0);
    const { reservaId } = await sembrar({ fechaEvento: mananaBorde });

    await servicio.ejecutar();

    // La invariante: entra por date(fecha_evento) = date(hoy)+1, no por el instante.
    expect((await leerReserva(reservaId))?.preEventoStatus).toBe(PreEventoStatus.cerrado);
  });
});

// ===========================================================================
// 3.7 — Idempotencia: (a) ficha ya cerrada (pre_evento_status='cerrado') NO es
//        candidata, no muta, no duplica auditoría; (b) segunda ejecución del barrido
//        no re-cierra ni duplica AUDIT_LOG.
// ===========================================================================

describe('Barrido US-026 — idempotencia (3.7)', () => {
  it('no_debe_tocar_una_ficha_ya_cerrada_manualmente_ni_auditar_de_nuevo', async () => {
    const { reservaId } = await sembrar({
      fechaEvento: MANANA,
      preEventoStatus: PreEventoStatus.cerrado,
      fichaCerrada: true,
    });

    await servicio.ejecutar();

    // No es candidata: sin nueva auditoría de transición.
    expect(await contarTransiciones(reservaId)).toBe(0);
    expect((await leerReserva(reservaId))?.preEventoStatus).toBe(PreEventoStatus.cerrado);
  });

  it('no_debe_re_cerrar_ni_duplicar_auditoria_en_una_segunda_ejecucion', async () => {
    const { reservaId } = await sembrar({
      fechaEvento: MANANA,
      preEventoStatus: PreEventoStatus.en_curso,
    });

    await servicio.ejecutar();
    const resumen2 = await servicio.ejecutar();

    // 2.ª ejecución: la ficha ya está cerrada → no es candidata → 0 cierres nuevos.
    expect(resumen2.fichasCerradas).toBe(0);
    // Exactamente UNA entrada de transición tras dos pases (N ejecuciones = 1 auditoría).
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});

// ===========================================================================
// 3.8 — Múltiples reservas de mañana: 2 en_curso se cierran (2 auditorías
//        independientes), 1 ya cerrada se omite; resumen refleja 2 fichas cerradas.
// ===========================================================================

describe('Barrido US-026 — múltiples reservas de mañana (3.8)', () => {
  it('debe_cerrar_las_dos_abiertas_y_omitir_la_cerrada_con_resumen_2', async () => {
    const { reservaId: a } = await sembrar({
      fechaEvento: MANANA,
      preEventoStatus: PreEventoStatus.en_curso,
    });
    const { reservaId: b } = await sembrar({
      fechaEvento: MANANA,
      preEventoStatus: PreEventoStatus.en_curso,
    });
    const { reservaId: cerrada } = await sembrar({
      fechaEvento: MANANA,
      preEventoStatus: PreEventoStatus.cerrado,
      fichaCerrada: true,
    });

    const resumen = await servicio.ejecutar();

    expect(resumen.fichasCerradas).toBe(2);
    expect((await leerReserva(a))?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect((await leerReserva(b))?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect(await contarTransiciones(a)).toBe(1);
    expect(await contarTransiciones(b)).toBe(1);
    // La ya cerrada no genera auditoría nueva.
    expect(await contarTransiciones(cerrada)).toBe(0);
  });
});

// ===========================================================================
// 3.4/D-5 — Cross-tenant read / RLS write: candidatas de tenants distintos se cierran,
//        cada una bajo el contexto RLS de SU tenant (el tenant sale de la fila, nunca
//        de input externo). Ninguna escritura cruza tenant.
// ===========================================================================

describe('Barrido US-026 — cross-tenant read / RLS write (D-5)', () => {
  it('debe_cerrar_candidatas_de_varios_tenants_sin_cruzar_tenant', async () => {
    const { reservaId: a } = await sembrar({ fechaEvento: MANANA, tenantId: TENANT });
    const { reservaId: b } = await sembrar({ fechaEvento: MANANA, tenantId: OTRO_TENANT });

    await servicio.ejecutar();

    const ra = await leerReserva(a);
    const rb = await leerReserva(b);
    expect(ra?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect(rb?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect(ra?.tenantId).toBe(TENANT);
    expect(rb?.tenantId).toBe(OTRO_TENANT);
  });
});
