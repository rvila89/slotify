/**
 * Test de CONTRATO del puerto de dominio `ComunicacionRepositoryPort` y del error
 * `ComunicacionDuplicadaError` (US-045) — fase TDD RED. tasks.md Fase 2: 2.2 / 2.3.
 *
 * Trazabilidad: US-045, spec-delta `comunicaciones` (Requirements: "Registro en
 * COMUNICACION con estado y fecha de envío coherentes", "Idempotencia de un email
 * por reserva y código"; Scenario: "Una carrera de doble inserción la frena el
 * índice único"), design.md §4 (índice UNIQUE parcial `(reserva_id, codigo_email)
 * WHERE reserva_id IS NOT NULL` + chequeo en tx) y §5 (modelo COMUNICACION).
 *
 * El puerto es una interfaz PURA: la implementación Prisma (con el índice UNIQUE
 * parcial real) se verifica contra la BD en QA (tasks.md 4.4). Aquí se fija el
 * CONTRATO de forma: el repositorio expone `buscarPorReservaYCodigo`, `crear` y
 * `actualizarEstado`, y traduce la violación del UNIQUE en `ComunicacionDuplicadaError`
 * (que el motor trata como "ya existe" sin error de usuario).
 *
 * RED: aún no existe `comunicacion.repository.port.ts` ni `codigo-email.ts`; los
 * imports fallan y la batería está en ROJO. GREEN = `backend-developer`.
 */
import {
  ComunicacionDuplicadaError,
  type ComunicacionRepositoryPort,
  type ComunicacionRegistrada,
  type RegistrarComunicacionParams,
} from './comunicacion.repository.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-1';
const CLIENTE_ID = 'cli-1';

describe('ComunicacionRepositoryPort — contrato del puerto de dominio', () => {
  it('debe_aceptar_una_implementacion_que_busque_cree_y_actualice_estado', async () => {
    let almacenado: ComunicacionRegistrada | null = null;
    const repo: ComunicacionRepositoryPort = {
      buscarPorReservaYCodigo: async () => almacenado,
      crear: async (p: RegistrarComunicacionParams): Promise<ComunicacionRegistrada> => {
        almacenado = {
          idComunicacion: 'com-1',
          tenantId: p.tenantId,
          reservaId: p.reservaId,
          clienteId: p.clienteId,
          codigoEmail: p.codigoEmail,
          estado: p.estado,
          destinatarioEmail: p.destinatarioEmail,
          fechaEnvio: p.fechaEnvio,
        };
        return almacenado;
      },
      actualizarEstado: async (p) => {
        almacenado = { ...(almacenado as ComunicacionRegistrada), estado: p.estado, fechaEnvio: p.fechaEnvio };
        return almacenado;
      },
    };

    expect(
      await repo.buscarPorReservaYCodigo({
        tenantId: TENANT,
        reservaId: RESERVA_ID,
        codigoEmail: 'E1',
      }),
    ).toBeNull();

    const creada = await repo.crear({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      clienteId: CLIENTE_ID,
      codigoEmail: 'E1',
      asunto: 'ASUNTO-E1',
      cuerpo: '<p>Hola</p>',
      destinatarioEmail: 'marta.soler@example.com',
      estado: 'enviado',
      fechaEnvio: new Date('2026-06-28T10:00:00.000Z'),
    });
    expect(creada.estado).toBe('enviado');
    expect(creada.fechaEnvio).toBeInstanceOf(Date);

    const actualizada = await repo.actualizarEstado({
      tenantId: TENANT,
      idComunicacion: creada.idComunicacion,
      estado: 'fallido',
      fechaEnvio: null,
    });
    expect(actualizada.estado).toBe('fallido');
    expect(actualizada.fechaEnvio).toBeNull();
  });
});

describe('ComunicacionDuplicadaError — colisión del índice UNIQUE parcial', () => {
  it('debe_ser_un_error_de_dominio_que_identifica_la_reserva_y_el_codigo_en_conflicto', () => {
    const error = new ComunicacionDuplicadaError(RESERVA_ID, 'E1');

    expect(error).toBeInstanceOf(Error);
    expect(error.reservaId).toBe(RESERVA_ID);
    expect(error.codigoEmail).toBe('E1');
  });
});
