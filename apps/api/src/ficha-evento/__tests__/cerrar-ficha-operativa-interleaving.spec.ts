/**
 * TEST DE INTERLEAVING (concurrencia C-2) del CIERRE MANUAL de la ficha operativa
 * (US-025 / UC-20 §D-6) frente al CIERRE AUTOMÁTICO A10 (US-026): el cierre manual
 * PIERDE la carrera porque otra vía (el barrido A10 u otro cierre concurrente) ya dejó
 * `pre_evento_status = cerrado` ANTES de que el manual re-evaluara la guarda bajo el
 * lock (`SELECT … FOR UPDATE`).
 *
 * Subsana el hallazgo Alta del code-review de US-026: la UoW de cierre manual endurecida
 * lanza `FichaYaCerradaError` bajo el lock cuando la ficha ya está cerrada, y ese error
 * NO estaba mapeado → degradaba a HTTP 500. Tras el fix, el caso de uso lo intercepta y
 * resuelve el cierre manual de forma IDEMPOTENTE (la ficha YA está en el estado deseado
 * por el gestor), devolviendo la ficha cerrada actual (equivalente HTTP 200), SIN
 * re-mutar estado y SIN duplicar auditoría.
 *
 * Es un test de INTEGRACIÓN sobre el caso de uso REAL `CerrarFichaOperativaUseCase`
 * cableado en `FichaEventoModule` con sus adaptadores Prisma reales (UoW de cierre con
 * `$transaction` + `SET LOCAL app.tenant_id` + `SELECT … FOR UPDATE` + re-evaluación de
 * la máquina de estados). NO mockea la UoW: ejercita el camino nuevo REAL del hallazgo.
 * Corre contra el Postgres AISLADO de tests (`slotify_test`, `.env.test`; ver memoria
 * "Tests con BD aislada slotify_test"). SIN Redis ni locks distribuidos.
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
import { CerrarFichaOperativaUseCase } from '../application/cerrar-ficha-operativa.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us025-interleaving.test';

let moduleRef: TestingModule;
let prisma: PrismaService;
let cerrar: CerrarFichaOperativaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/** Siembra una RESERVA confirmada con su FICHA_OPERATIVA 1:1 en el estado indicado. */
const sembrar = async (params: {
  preEventoStatus: PreEventoStatus;
  fichaCerrada: boolean;
  fechaCierre?: Date | null;
}): Promise<{ reservaId: string }> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Interleave', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U025IL-${sufijo()}`,
      estado: EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2026-08-01T12:00:00.000Z'),
      preEventoStatus: params.preEventoStatus,
    },
  });
  await prisma.fichaOperativa.create({
    data: {
      reservaId: reserva.idReserva,
      fichaCerrada: params.fichaCerrada,
      fechaCierre: params.fechaCierre ?? null,
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
  cerrar = moduleRef.get(CerrarFichaOperativaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// C-2 — El cierre manual pierde la carrera: la ficha ya está `cerrado` (la cerró el
//        cron A10 u otra vía). Bajo el lock, la UoW aborta con FichaYaCerradaError; el
//        caso de uso lo resuelve IDEMPOTENTE → devuelve la ficha cerrada (equivalente
//        200), NO lanza (NO 500), NO muta y NO duplica auditoría.
// ===========================================================================

describe('Cierre manual US-025 pierde la carrera contra el cierre A10 (C-2)', () => {
  it('debe_resolver_idempotente_devolviendo_la_ficha_cerrada_sin_lanzar_ni_500', async () => {
    // Estado de partida: la ficha YA fue cerrada por otra vía (p. ej. el barrido A10),
    // con SU auditoría de transición ya escrita.
    const fechaCierrePrevia = new Date('2026-07-31T23:00:00.000Z');
    const { reservaId } = await sembrar({
      preEventoStatus: PreEventoStatus.cerrado,
      fichaCerrada: true,
      fechaCierre: fechaCierrePrevia,
    });
    await prisma.auditLog.create({
      data: {
        tenantId: TENANT,
        usuarioId: null,
        entidad: 'RESERVA',
        entidadId: reservaId,
        accion: AccionAudit.transicion,
        datosNuevos: { preEventoStatus: 'cerrado', causa: 'A10' },
      },
    });

    // El gestor lanza el cierre manual DESPUÉS: bajo el lock reevalúa la guarda,
    // encuentra `cerrado` (transición cerrado → cerrado inválida) → la UoW aborta y el
    // caso de uso resuelve idempotente. NO debe lanzar (antes del fix daba 500).
    const promesa = cerrar.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId });
    await expect(promesa).resolves.toBeDefined();

    const resultado = await promesa;
    // Desenlace 200-idempotente: devuelve la ficha cerrada actual.
    expect(resultado.fichaCerrada).toBe(true);
    expect(resultado.preEventoStatus).toBe('cerrado');
    expect(resultado.reservaId).toBe(reservaId);
    expect(Array.isArray(resultado.avisosCamposVacios)).toBe(true);

    // NO muta estado: la reserva sigue cerrada y la fecha de cierre es la PREVIA (no la
    // sobrescribió el cierre manual que perdió la carrera).
    const reserva = await leerReserva(reservaId);
    const ficha = await leerFicha(reservaId);
    expect(reserva?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect(ficha?.fichaCerrada).toBe(true);
    expect(ficha?.fechaCierre?.toISOString()).toBe(fechaCierrePrevia.toISOString());

    // NO duplica auditoría: sigue habiendo EXACTAMENTE la transición original (la del
    // cierre A10); el cierre manual que perdió la carrera NO añadió otra.
    expect(await contarTransiciones(reservaId)).toBe(1);
  });

  it('no_debe_lanzar_FichaYaCerradaError_al_borde_del_caso_de_uso', async () => {
    const { reservaId } = await sembrar({
      preEventoStatus: PreEventoStatus.cerrado,
      fichaCerrada: true,
      fechaCierre: new Date('2026-07-31T23:00:00.000Z'),
    });

    // El caso de uso NO relanza FichaYaCerradaError (ni ningún otro error): lo absorbe.
    await expect(
      cerrar.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId }),
    ).resolves.not.toThrow();
  });
});
