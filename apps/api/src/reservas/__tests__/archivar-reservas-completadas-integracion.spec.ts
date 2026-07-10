/**
 * TESTS DE INTEGRACIÓN del barrido de ARCHIVADO AUTOMÁTICO en T+7d
 * (US-037 / UC-28, actor Sistema) — fase TDD RED. tasks.md Fase 4:
 * 4.3 (auditoría origen Sistema en BD), 4.4/4.5 (sin fianza / retención total),
 * 4.6 (FA-01 alerta AUDIT_LOG), 4.8 (filtro estricto por estado),
 * 4.9 (filtro por antigüedad + off-by-one TZ), 4.10 (idempotencia 2.ª ejecución).
 *
 * ⚠️ REQUIERE POSTGRES REAL — NO EJECUTAR EN SUBAGENTES (memoria "Subagentes sin
 * Docker/Postgres"). Se lanza desde la sesión principal con el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`; memoria "Tests con BD aislada slotify_test") y la
 * migración de `fechaPostEvento` (D-2=A) aplicada.
 *
 * Trazabilidad: US-037; spec-delta `consultas` (Requirements: "Transición atómica a
 * reserva_completada solo con la guarda de fianza resuelta", "Fianza no resuelta en T+7d
 * — no archiva y emite alerta interna al gestor sin duplicar", "Filtro estricto por estado
 * y antigüedad — solo post_evento con ≥ 7 días naturales", "Idempotencia del barrido",
 * "La auditoría del archivado automático registra el origen Sistema"); design.md §D-6
 * (transición declarativa), §D-2=A (selección por `date(fechaPostEvento) <= hoy - 7`, por
 * FECHA DE CALENDARIO — no string formateado, blindaje del off-by-one de TZ), §D-8
 * (adaptadores Prisma cross-tenant read / RLS write).
 *
 * Es un test de INTEGRACIÓN: ejercita el caso de uso REAL
 * `ArchivarReservasCompletadasService` contra los adaptadores Prisma (listado cross-tenant
 * de candidatas por `estado='post_evento'` AND `date(fecha_post_evento) <= CURRENT_DATE - 7`
 * + UoW de transición con `$transaction` + `SET LOCAL app.tenant_id` + `SELECT … FOR
 * UPDATE`) sobre el Postgres aislado. SIN Redis ni locks distribuidos: la atomicidad por
 * RESERVA se apoya en la transacción serializada por el motor.
 *
 * RED: aún NO existen `application/archivar-reservas-completadas.service.ts`, sus puertos,
 * ni los adaptadores de listado/transición/alerta en `infrastructure/`, ni su registro en
 * `ReservasModule`; los imports/símbolos fallan y toda la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba, no es fallo de infra). GREEN es de
 * `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  AccionAudit,
  CanalEntrada,
  EstadoReserva,
  FianzaStatus,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ArchivarReservasCompletadasService } from '../application/archivar-reservas-completadas.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us037-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Instante a mediodía UTC desplazado `offsetDias` respecto a hoy, para que la selección
 * por `date(fecha_post_evento) <= date(hoy) - 7` (D-2=A) sea determinista cualquiera que
 * sea el día de ejecución. El mediodía UTC evita que un offset de TZ empuje la fecha de
 * calendario al día anterior/siguiente (blindaje del off-by-one conocido).
 */
const aMediodiaUTC = (offsetDias: number): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return new Date(base.getTime() + offsetDias * DIA_MS);
};
// Antigüedad LÍMITE: exactamente 7 días → candidata. 6 días → NO candidata.
const HACE_7_DIAS = aMediodiaUTC(-7);
const HACE_6_DIAS = aMediodiaUTC(-6);
const HACE_8_DIAS = aMediodiaUTC(-8);

let moduleRef: TestingModule;
let prisma: PrismaService;
let servicio: ArchivarReservasCompletadasService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/** Siembra una RESERVA con estado, fianza y fechaPostEvento indicados. */
const sembrar = async (params: {
  fechaPostEvento: Date | null;
  estado?: EstadoReserva;
  fianzaStatus?: FianzaStatus;
  fianzaEur?: number | null;
  fianzaDevueltaEur?: number | null;
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
      codigo: `TST-U037I-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.post_evento,
      canalEntrada: CanalEntrada.web,
      fechaEvento: aMediodiaUTC(-10),
      fechaPostEvento: params.fechaPostEvento,
      fianzaStatus: params.fianzaStatus ?? FianzaStatus.devuelta,
      fianzaEur: params.fianzaEur ?? 300,
      fianzaDevueltaEur: params.fianzaDevueltaEur ?? null,
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
  servicio = moduleRef.get(ArchivarReservasCompletadasService);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 4.3 — Happy path (BD): RESERVA post_evento, fecha_post_evento hace 8 días, fianza
//        devuelta → estado = reserva_completada + AUDIT_LOG transición origen Sistema con
//        datos_anteriores={estado:post_evento}, datos_nuevos={estado:reserva_completada,
//        causa:'T+7d'}, usuario_id NO poblado.
// ===========================================================================

describe('Barrido US-037 — happy path: archiva y audita origen Sistema (4.3)', () => {
  it('debe_transicionar_a_reserva_completada_y_auditar_transicion_origen_Sistema', async () => {
    const { reservaId } = await sembrar({
      fechaPostEvento: HACE_8_DIAS,
      fianzaStatus: FianzaStatus.devuelta,
      fianzaEur: 300,
    });

    const resumen = await servicio.ejecutar();
    expect(resumen.archivadas).toBeGreaterThanOrEqual(1);

    const reserva = await leerReserva(reservaId);
    expect(reserva?.estado).toBe(EstadoReserva.reserva_completada);

    const transiciones = await prisma.auditLog.findMany({
      where: { entidadId: reservaId, accion: AccionAudit.transicion },
    });
    expect(transiciones.length).toBe(1);
    const t = transiciones[0];
    expect(t.entidad).toBe('RESERVA');
    expect(t.usuarioId).toBeNull();
    expect(JSON.stringify(t.datosAnteriores)).toContain('post_evento');
    expect(JSON.stringify(t.datosNuevos)).toContain('reserva_completada');
    expect(JSON.stringify(t.datosNuevos)).toContain('T+7d');
  });
});

// ===========================================================================
// 4.4/4.5 — Sin fianza (eur=0/null) y retención total (retenida_parcial, devuelta_eur=0)
//        archivan por la guarda de fianza satisfecha.
// ===========================================================================

describe('Barrido US-037 — sin fianza y retención total archivan (4.4/4.5)', () => {
  it('debe_archivar_sin_fianza_eur_0_aunque_el_status_sea_cobrada', async () => {
    const { reservaId } = await sembrar({
      fechaPostEvento: HACE_8_DIAS,
      fianzaStatus: FianzaStatus.cobrada,
      fianzaEur: 0,
    });

    await servicio.ejecutar();

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);
  });

  it('debe_archivar_retenida_parcial_con_devuelta_eur_0_retencion_100', async () => {
    const { reservaId } = await sembrar({
      fechaPostEvento: HACE_8_DIAS,
      fianzaStatus: FianzaStatus.retenida_parcial,
      fianzaEur: 500,
      fianzaDevueltaEur: 0,
    });

    await servicio.ejecutar();

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);
  });
});

// ===========================================================================
// 4.6 (BD) — FA-01: fianza cobrada con eur>0 en T+7d → NO transiciona (permanece
//        post_evento), 0 auditorías de TRANSICIÓN, y se registra la alerta interna FA-01
//        como entrada de AUDIT_LOG (actor Sistema, usuario_id null, tipo
//        fianza_pendiente_t7d — D-3=3.1). (La anti-duplicación se cubre en 4.7.)
// ===========================================================================

describe('Barrido US-037 — FA-01 fianza pendiente no archiva y deja alerta en AUDIT_LOG (4.6 BD)', () => {
  it('no_debe_transicionar_y_debe_dejar_una_alerta_fianza_pendiente_t7d_en_audit_log', async () => {
    const { reservaId } = await sembrar({
      fechaPostEvento: HACE_8_DIAS,
      fianzaStatus: FianzaStatus.cobrada,
      fianzaEur: 300,
    });

    const resumen = await servicio.ejecutar();

    // No transiciona: sigue en post_evento, sin auditoría de transición.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
    expect(await contarTransiciones(reservaId)).toBe(0);
    expect(resumen.fianzaPendiente).toBeGreaterThanOrEqual(1);

    // La alerta FA-01 queda como entrada de AUDIT_LOG con tipo fianza_pendiente_t7d y
    // usuario_id nulo (origen Sistema). NO es una acción de transición.
    const alertas = await prisma.auditLog.findMany({
      where: { entidadId: reservaId },
    });
    const alertaFA01 = alertas.find(
      (a) =>
        a.accion !== AccionAudit.transicion &&
        JSON.stringify(a.datosNuevos ?? a.datosAnteriores ?? {}).includes(
          'fianza_pendiente_t7d',
        ),
    );
    expect(alertaFA01).toBeDefined();
    expect(alertaFA01?.usuarioId).toBeNull();
  });
});

// ===========================================================================
// 4.8 — Filtro estricto por estado: RESERVA en consulta / pre_reserva / reserva_confirmada
//        / evento_en_curso / reserva_cancelada / reserva_completada con fecha_post_evento
//        antigua NO se archiva (solo `post_evento` es candidata), sin auditoría.
// ===========================================================================

describe('Barrido US-037 — filtro estricto por estado (4.8)', () => {
  const noPostEvento: ReadonlyArray<EstadoReserva> = [
    EstadoReserva.consulta,
    EstadoReserva.pre_reserva,
    EstadoReserva.reserva_confirmada,
    EstadoReserva.evento_en_curso,
    EstadoReserva.reserva_cancelada,
    EstadoReserva.reserva_completada,
  ];

  it.each(noPostEvento)(
    'no_debe_archivar_una_reserva_en_%s_aunque_su_fecha_post_evento_sea_antigua',
    async (estado) => {
      const { reservaId } = await sembrar({ fechaPostEvento: HACE_8_DIAS, estado });

      await servicio.ejecutar();

      expect((await leerReserva(reservaId))?.estado).toBe(estado);
      expect(await contarTransiciones(reservaId)).toBe(0);
    },
  );
});

// ===========================================================================
// 4.9 — Filtro por antigüedad (D-2=A) POR FECHA DE CALENDARIO: exactamente 7 días → SÍ
//        candidata; 6 días → NO; blindaje del off-by-one de TZ (selección por
//        date(fecha_post_evento), no por string formateado). Además, un post_evento a un
//        instante en el EXTREMO del día 7 (23:00 UTC) sigue entrando.
// ===========================================================================

describe('Barrido US-037 — selección por antigüedad de calendario, no por string (4.9)', () => {
  it('debe_archivar_la_de_exactamente_7_dias_y_dejar_intacta_la_de_6_dias', async () => {
    const { reservaId: id7 } = await sembrar({ fechaPostEvento: HACE_7_DIAS });
    const { reservaId: id6 } = await sembrar({ fechaPostEvento: HACE_6_DIAS });

    await servicio.ejecutar();

    // Límite exacto: 7 días naturales → candidata (≥ 7).
    expect((await leerReserva(id7))?.estado).toBe(EstadoReserva.reserva_completada);
    // 6 días → todavía NO cumple T+7d.
    expect((await leerReserva(id6))?.estado).toBe(EstadoReserva.post_evento);
  });

  it('debe_archivar_una_de_7_dias_aunque_su_instante_este_al_borde_del_dia', async () => {
    // Hace 7 días a las 23:00 UTC: mismo DÍA DE CALENDARIO que HACE_7_DIAS (mediodía). La
    // invariante: entra por date(fecha_post_evento) <= date(hoy)-7, no por el instante ni
    // por su representación formateada.
    const bordeDia = new Date(HACE_7_DIAS.getTime());
    bordeDia.setUTCHours(23, 0, 0, 0);
    const { reservaId } = await sembrar({ fechaPostEvento: bordeDia });

    await servicio.ejecutar();

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);
  });

  it('no_debe_archivar_post_evento_con_fecha_post_evento_null_residual_no_backfilleada', async () => {
    // Blindaje: una RESERVA en post_evento SIN fecha_post_evento (residual pre-migración
    // aún NO backfilleado) no debe archivarse hasta que se le asigne la fecha.
    const { reservaId } = await sembrar({ fechaPostEvento: null });

    await servicio.ejecutar();

    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
  });
});

// ===========================================================================
// 4.10 — FA-02 idempotencia (BD): (a) RESERVA ya en reserva_completada NO es candidata,
//        no muta, no duplica auditoría; (b) 2.ª ejecución del barrido no re-archiva ni
//        duplica AUDIT_LOG (N ejecuciones = 1 transición).
// ===========================================================================

describe('Barrido US-037 — idempotencia FA-02 (4.10)', () => {
  it('no_debe_tocar_una_reserva_ya_en_reserva_completada_ni_auditar_de_nuevo', async () => {
    const { reservaId } = await sembrar({
      fechaPostEvento: HACE_8_DIAS,
      estado: EstadoReserva.reserva_completada,
    });

    await servicio.ejecutar();

    expect(await contarTransiciones(reservaId)).toBe(0);
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);
  });

  it('no_debe_re_archivar_ni_duplicar_auditoria_en_una_segunda_ejecucion', async () => {
    const { reservaId } = await sembrar({ fechaPostEvento: HACE_8_DIAS });

    await servicio.ejecutar();
    const resumen2 = await servicio.ejecutar();

    // 2.ª ejecución: ya en reserva_completada → no candidata → 0 archivadas nuevas.
    expect(resumen2.archivadas).toBe(0);
    expect(await contarTransiciones(reservaId)).toBe(1);
  });

  it('no_debe_re_emitir_la_alerta_fianza_pendiente_en_dos_barridos_sin_cambio_de_fianza_4_7', async () => {
    // 4.7 (BD): anti-duplicación por AUDIT_LOG. Dos barridos seguidos sobre la misma
    // RESERVA con fianza pendiente y SIN cambio de fianza_status/fianza_eur → UNA sola
    // alerta fianza_pendiente_t7d.
    const { reservaId } = await sembrar({
      fechaPostEvento: HACE_8_DIAS,
      fianzaStatus: FianzaStatus.cobrada,
      fianzaEur: 300,
    });

    await servicio.ejecutar();
    await servicio.ejecutar();

    const alertas = await prisma.auditLog.findMany({ where: { entidadId: reservaId } });
    const alertasFA01 = alertas.filter((a) =>
      JSON.stringify(a.datosNuevos ?? a.datosAnteriores ?? {}).includes(
        'fianza_pendiente_t7d',
      ),
    );
    expect(alertasFA01.length).toBe(1);
    // Sigue sin archivarse.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
  });
});

// ===========================================================================
// D-8 — Cross-tenant read / RLS write: candidatas de tenants distintos se archivan, cada
//        una bajo el contexto RLS de SU tenant (el tenant sale de la fila, nunca de input
//        externo). Ninguna escritura cruza tenant.
// ===========================================================================

describe('Barrido US-037 — cross-tenant read / RLS write (D-8)', () => {
  it('debe_archivar_candidatas_de_varios_tenants_sin_cruzar_tenant', async () => {
    const { reservaId: a } = await sembrar({
      fechaPostEvento: HACE_8_DIAS,
      tenantId: TENANT,
    });
    const { reservaId: b } = await sembrar({
      fechaPostEvento: HACE_8_DIAS,
      tenantId: OTRO_TENANT,
    });

    await servicio.ejecutar();

    const ra = await leerReserva(a);
    const rb = await leerReserva(b);
    expect(ra?.estado).toBe(EstadoReserva.reserva_completada);
    expect(rb?.estado).toBe(EstadoReserva.reserva_completada);
    expect(ra?.tenantId).toBe(TENANT);
    expect(rb?.tenantId).toBe(OTRO_TENANT);
  });
});
