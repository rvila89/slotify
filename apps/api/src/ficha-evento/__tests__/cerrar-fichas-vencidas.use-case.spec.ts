/**
 * TESTS DE APLICACIÓN del caso de uso `CerrarFichasVencidasService`
 * (US-026 / UC-20 FA-01, actor Sistema) — fase TDD RED. tasks.md Fase 3:
 * 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9.
 *
 * Trazabilidad: US-026; spec-delta `ficha-operativa` (Requirements: "Barrido periódico
 * protegido de cierre automático en T-1d (A10)", "Cierre automático de la ficha en
 * T-1d con los datos disponibles (A10)", "El cierre forzado no depende del contenido
 * de la ficha (ficha vacía)", "Filtro estricto por estado — solo reserva_confirmada",
 * "El trigger se evalúa solo contra fecha_evento - 1 día = hoy", "Idempotencia del
 * barrido", "Procesa todas las elegibles con aislamiento de fallos por RESERVA",
 * "La auditoría del cierre automático registra el origen Sistema"); design.md §D-3
 * (transición declarativa reutilizada), §D-4 (selección + idempotencia), §D-6
 * (idempotencia/concurrencia), §D-7 (dominio puro + caso de uso de aplicación:
 * listar candidatas, por cada una en su propia transacción, re-evaluar guarda,
 * aplicar la mutación de cierre reutilizada de US-025 forzada por Sistema, auditar
 * origen Sistema causa A10, agregar resumen con fallo aislado).
 *
 * DOMINIO/APLICACIÓN AISLADOS (skill `tdd-core`, hexagonal): se ejercita el caso de
 * uso contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma ni la BD. Dos
 * puertos, en paralelo estricto al barrido de US-012:
 *   - `CandidatasCierreFichaPort.listarCandidatas()` — lectura CROSS-TENANT de las
 *     RESERVA con `estado = 'reserva_confirmada'` AND `pre_evento_status != 'cerrado'`
 *     AND `date(fecha_evento) = date(hoy) + 1 día` (D-4). La SELECCIÓN es del
 *     adaptador (integración), aquí se asume que la lista ya llega filtrada.
 *   - `CierreFichaVencidaPort.cerrarFicha(candidata)` — UoW ATÓMICA por RESERVA: bajo
 *     el contexto RLS del tenant de la candidata, re-evalúa la guarda A10, y —si sigue
 *     siendo candidata— cierra la ficha (`ficha_cerrada = true`, `fecha_cierre = now()`,
 *     `pre_evento_status → cerrado`) + AUDIT_LOG transición origen Sistema causa A10.
 *
 * RED: aún NO existe `application/cerrar-fichas-vencidas.service.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  CerrarFichasVencidasService,
  type CandidatasCierreFichaPort,
  type CierreFichaVencidaPort,
  type FichaCandidataCierre,
  type ResultadoCierreFicha,
  type ResumenBarridoFichas,
} from '../application/cerrar-fichas-vencidas.service';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-0000000000b2';
const DIA_MS = 24 * 60 * 60 * 1000;
const MANANA = new Date(Date.now() + DIA_MS);

// ---------------------------------------------------------------------------
// Dobles de los puertos (in-memory) con spies.
// ---------------------------------------------------------------------------

const candidata = (over: Partial<FichaCandidataCierre> = {}): FichaCandidataCierre => ({
  reservaId: `res-${Math.random().toString(36).slice(2, 8)}`,
  tenantId: TENANT_A,
  fechaEvento: MANANA,
  preEventoStatus: 'en_curso',
  ...over,
});

type CandidatasFake = CandidatasCierreFichaPort & { listarCandidatas: jest.Mock };
type CierreFake = CierreFichaVencidaPort & { cerrarFicha: jest.Mock };

const crearCandidatasFake = (candidatas: FichaCandidataCierre[]): CandidatasFake => ({
  listarCandidatas: jest.fn(async () => candidatas),
});

/**
 * Doble de la UoW por RESERVA. Por defecto cierra con éxito (`cerrada = true`).
 * `resultados` mapea reservaId → desenlace ('lanza' | `false` para "ya no candidata
 * bajo lock") para los tests de idempotencia y fallo aislado.
 */
const crearCierreFake = (
  resultados?: Record<string, ResultadoCierreFicha | 'lanza'>,
): CierreFake => ({
  cerrarFicha: jest.fn(async (c: FichaCandidataCierre): Promise<ResultadoCierreFicha> => {
    const r = resultados?.[c.reservaId];
    if (r === 'lanza') {
      throw new Error('fallo simulado de cierre');
    }
    return (
      r ?? {
        reservaId: c.reservaId,
        cerrada: true,
        preEventoStatusAnterior: c.preEventoStatus,
      }
    );
  }),
});

const montar = (
  candidatas: FichaCandidataCierre[],
  resultados?: Record<string, ResultadoCierreFicha | 'lanza'>,
) => {
  const candidatasPort = crearCandidatasFake(candidatas);
  const cierrePort = crearCierreFake(resultados);
  const servicio = new CerrarFichasVencidasService({
    candidatas: candidatasPort,
    cierre: cierrePort,
  });
  return { servicio, candidatasPort, cierrePort };
};

// ===========================================================================
// 3.2 — Happy path: candidata en `en_curso` → se cierra. El use-case delega en la
//        UoW `cerrarFicha` pasando el tenant de la fila; el resumen cuenta 1 cerrada.
//        spec-delta: "RESERVA confirmada con ficha en_curso cierra en el barrido".
// ===========================================================================

describe('CerrarFichasVencidasService — happy path ficha en_curso (3.2)', () => {
  it('debe_cerrar_la_ficha_en_curso_y_reflejar_una_cerrada_en_el_resumen', async () => {
    const c = candidata({ preEventoStatus: 'en_curso' });
    const { servicio, cierrePort } = montar([c]);

    const resumen: ResumenBarridoFichas = await servicio.ejecutar();

    expect(cierrePort.cerrarFicha).toHaveBeenCalledTimes(1);
    expect(cierrePort.cerrarFicha).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: c.reservaId, preEventoStatus: 'en_curso' }),
    );
    expect(resumen.candidatas).toBe(1);
    expect(resumen.fichasCerradas).toBe(1);
    expect(resumen.fallos).toBe(0);
  });
});

// ===========================================================================
// 3.3 — Ficha vacía (`pendiente`): se cierra IGUALMENTE, sin aviso ni error por
//        campos vacíos (a diferencia del cierre manual de US-025, que devuelve
//        `avisosCamposVacios`). El proceso batch de Sistema NO es interactivo.
//        spec-delta: "El cierre forzado no depende del contenido de la ficha".
// ===========================================================================

describe('CerrarFichasVencidasService — ficha vacía en pendiente se cierra igual (3.3)', () => {
  it('debe_cerrar_la_ficha_en_pendiente_sin_bloquear_por_campos_vacios', async () => {
    const c = candidata({ preEventoStatus: 'pendiente' });
    const { servicio, cierrePort } = montar([c]);

    const resumen = await servicio.ejecutar();

    expect(cierrePort.cerrarFicha).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: c.reservaId, preEventoStatus: 'pendiente' }),
    );
    expect(resumen.fichasCerradas).toBe(1);
    expect(resumen.fallos).toBe(0);
  });

  it('no_debe_exponer_ningun_aviso_de_campos_vacios_en_el_resumen', async () => {
    const c = candidata({ preEventoStatus: 'pendiente' });
    const { servicio } = montar([c]);

    const resumen = await servicio.ejecutar();

    // El resumen del proceso de Sistema es puramente de recuentos (contrato
    // `BarridoFichasResumen`): NO lleva avisos interactivos como el cierre manual.
    expect(resumen).not.toHaveProperty('avisosCamposVacios');
    expect(Object.keys(resumen).sort()).toEqual(['candidatas', 'fallos', 'fichasCerradas']);
  });
});

// ===========================================================================
// 3.7 — Idempotencia a nivel de use-case: una candidata que bajo lock YA NO es
//        candidata (`cerrada = false`, la re-evaluación de la guarda dentro de la
//        transacción la vio ya `cerrado`) → no cuenta como cerrada ni como fallo.
//        Es la base de "N ejecuciones = 1 cierre".
//        spec-delta: "Idempotencia del barrido — ficha ya cerrada no se re-cierra".
// ===========================================================================

describe('CerrarFichasVencidasService — idempotencia (ya cerrada bajo lock) (3.7)', () => {
  it('no_debe_contar_como_cerrada_una_ficha_que_dejo_de_ser_candidata_bajo_lock', async () => {
    const c = candidata({ preEventoStatus: 'en_curso' });
    const { servicio } = montar([c], {
      [c.reservaId]: {
        reservaId: c.reservaId,
        cerrada: false, // re-evaluación bajo transacción: ya `cerrado` (idempotencia).
        preEventoStatusAnterior: 'cerrado',
      },
    });

    const resumen = await servicio.ejecutar();

    expect(resumen.candidatas).toBe(1);
    expect(resumen.fichasCerradas).toBe(0);
    expect(resumen.fallos).toBe(0);
  });
});

// ===========================================================================
// 3.8 — Múltiples reservas de mañana: dos en `en_curso` se cierran, una que bajo lock
//        resultó `cerrada = false` (ya `cerrado`) se omite → resumen = 2 fichas
//        cerradas, 3 candidatas, 0 fallos. Cada cierre es una operación independiente.
//        spec-delta: "Tres reservas de mañana — dos abiertas se cierran, una cerrada
//        se omite".
// ===========================================================================

describe('CerrarFichasVencidasService — múltiples reservas de mañana (3.8)', () => {
  it('debe_cerrar_las_dos_abiertas_y_omitir_la_ya_cerrada', async () => {
    const abierta1 = candidata({ preEventoStatus: 'en_curso' });
    const abierta2 = candidata({ preEventoStatus: 'en_curso' });
    const yaCerrada = candidata({ preEventoStatus: 'en_curso' });
    const { servicio, cierrePort } = montar([abierta1, abierta2, yaCerrada], {
      [yaCerrada.reservaId]: {
        reservaId: yaCerrada.reservaId,
        cerrada: false,
        preEventoStatusAnterior: 'cerrado',
      },
    });

    const resumen = await servicio.ejecutar();

    expect(cierrePort.cerrarFicha).toHaveBeenCalledTimes(3);
    expect(resumen.candidatas).toBe(3);
    expect(resumen.fichasCerradas).toBe(2);
    expect(resumen.fallos).toBe(0);
  });
});

// ===========================================================================
// 3.9 — Atomicidad / fallo aislado: el fallo de una candidata NO aborta el lote; las
//        demás se cierran; el resumen refleja el fallo aislado. Cada candidata se
//        procesa en su PROPIA transacción independiente (semántica del lote de
//        US-012, D-6/D-7).
//        spec-delta: "Un fallo parcial en una candidata no revierte las demás".
// ===========================================================================

describe('CerrarFichasVencidasService — fallo aislado por RESERVA (3.9)', () => {
  it('debe_cerrar_las_demas_aunque_una_lance_y_reflejar_el_fallo_aislado', async () => {
    const ok1 = candidata({ preEventoStatus: 'en_curso' });
    const kaboom = candidata({ preEventoStatus: 'pendiente' });
    const ok2 = candidata({ preEventoStatus: 'en_curso' });
    const { servicio, cierrePort } = montar([ok1, kaboom, ok2], {
      [kaboom.reservaId]: 'lanza',
    });

    const resumen = await servicio.ejecutar();

    // Las tres candidatas se INTENTAN (fallo aislado, no corta el lote).
    expect(cierrePort.cerrarFicha).toHaveBeenCalledTimes(3);
    expect(resumen.candidatas).toBe(3);
    expect(resumen.fichasCerradas).toBe(2);
    expect(resumen.fallos).toBe(1);
  });
});

// ===========================================================================
// 3.4/3.5 (a nivel de aplicación) — Cross-tenant read, mutación por tenant de la
//        fila (D-5): el barrido es cross-tenant en la lectura, pero cada cierre recibe
//        el `tenantId` de SU candidata (nunca de input externo). El filtro estricto
//        por estado y por `fecha_evento = mañana` es responsabilidad de la SELECCIÓN
//        (adaptador de candidatas, cubierto en integración): el use-case cierra lo que
//        `listarCandidatas` le entrega.
// ===========================================================================

describe('CerrarFichasVencidasService — cross-tenant read, cierre por tenant de la fila', () => {
  it('debe_procesar_candidatas_de_varios_tenants_pasando_el_tenant_de_cada_fila', async () => {
    const a = candidata({ tenantId: TENANT_A, preEventoStatus: 'en_curso' });
    const b = candidata({ tenantId: TENANT_B, preEventoStatus: 'pendiente' });
    const { servicio, cierrePort } = montar([a, b]);

    const resumen = await servicio.ejecutar();

    expect(resumen.candidatas).toBe(2);
    expect(resumen.fichasCerradas).toBe(2);
    // Cada cierre se invoca con el tenant de SU candidata (RLS write por tenant).
    expect(cierrePort.cerrarFicha).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
    );
    expect(cierrePort.cerrarFicha).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_B }),
    );
  });

  it('debe_devolver_un_resumen_en_ceros_cuando_no_hay_candidatas', async () => {
    const { servicio, cierrePort } = montar([]);

    const resumen = await servicio.ejecutar();

    expect(cierrePort.cerrarFicha).not.toHaveBeenCalled();
    expect(resumen).toEqual<ResumenBarridoFichas>({
      candidatas: 0,
      fichasCerradas: 0,
      fallos: 0,
    });
  });
});
