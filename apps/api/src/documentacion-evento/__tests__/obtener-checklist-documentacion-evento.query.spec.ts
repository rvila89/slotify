/**
 * TESTS de la QUERY `ObtenerChecklistDocumentacionEventoQuery` (UC-24 / US-033) —
 * fase TDD RED. tasks.md Fase 3: 3.4.
 *
 * Trazabilidad: US-033 §Happy Path (checklist en tiempo real, tres ítems ✅),
 * §Reglas de Validación (existencia de ≥1 DOCUMENTO por tipo + reserva); spec-delta
 * `documentacion-evento` (Requirement "Checklist consultable del estado de la
 * documentación del evento"); design.md §D-checklist. Contrato CONGELADO:
 *   - `GET /reservas/{id}/documentos-evento/checklist` → 200
 *     `{ items: [{ tipo, completado, documento? }] }` (3 ítems: dni_anverso,
 *     dni_reverso, clausula_responsabilidad).
 *
 * El checklist se DERIVA por lectura (no se materializa): `completado = existe ≥1
 * DOCUMENTO de ese tipo + reservaId bajo RLS`; el `documento` de referencia es el MÁS
 * RECIENTE por `fechaCreacion`. Consultable también en `post_evento` (FA-01), a
 * diferencia de la ESCRITURA (solo `evento_en_curso`). Filtra por tenantId (RLS).
 *
 * Ejercita la APLICACIÓN contra un DOBLE del puerto de listado (in-memory), sin tocar
 * Prisma (hexagonal). La RLS REAL (cross-tenant) se verifica en `…-integracion.spec.ts`.
 *
 * RED: aún NO existe
 * `documentacion-evento/application/obtener-checklist-documentacion-evento.query.ts`.
 * El import falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  ObtenerChecklistDocumentacionEventoQuery,
  ReservaNoEncontradaError,
  type ObtenerChecklistDocumentacionEventoDeps,
  type ReservaChecklistDocumentacionEvento,
  type DocumentoEventoPersistido,
} from '../application/obtener-checklist-documentacion-evento.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const RESERVA_ID = 'res-evento';
const MB = 1024 * 1024;

const doc = (
  tipo: DocumentoEventoPersistido['tipo'],
  fechaCreacion: Date,
  over: Partial<DocumentoEventoPersistido> = {},
): DocumentoEventoPersistido => ({
  idDocumento: `doc-${tipo}-${fechaCreacion.getTime()}`,
  tipo,
  reservaId: RESERVA_ID,
  tenantId: TENANT,
  url: `https://docs/documentos-evento/${tipo}.jpg`,
  mimeType: 'image/jpeg',
  nombreArchivo: `${tipo}.jpg`,
  tamanoBytes: 1 * MB,
  fechaCreacion,
  ...over,
});

const reservaEnCurso = (
  over: Partial<ReservaChecklistDocumentacionEvento> = {},
): ReservaChecklistDocumentacionEvento => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'evento_en_curso',
  ...over,
});

const montar = (opciones: {
  reserva?: ReservaChecklistDocumentacionEvento | null;
  documentos?: DocumentoEventoPersistido[];
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaEnCurso();
  const cargarReserva = jest.fn(async () => reserva);
  const listarDocumentosEvento = jest.fn(
    async (_params: {
      tenantId: string;
      reservaId: string;
      tipos: ReadonlyArray<DocumentoEventoPersistido['tipo']>;
    }) => opciones.documentos ?? [],
  );
  const deps: ObtenerChecklistDocumentacionEventoDeps = {
    cargarReserva,
    listarDocumentosEvento,
  };
  return {
    query: new ObtenerChecklistDocumentacionEventoQuery(deps),
    cargarReserva,
    listarDocumentosEvento,
  };
};

const consulta = { tenantId: TENANT, reservaId: RESERVA_ID };

// ===========================================================================
// 3.4 — Derivación por existencia ≥1 por tipo; tres ítems siempre presentes.
// ===========================================================================

describe('ObtenerChecklistDocumentacionEventoQuery — derivación por existencia (3.4)', () => {
  it('debe_devolver_los_tres_items_en_los_tres_tipos_obligatorios', async () => {
    const { query } = montar({ documentos: [] });

    const checklist = await query.ejecutar(consulta);

    expect(checklist.items).toHaveLength(3);
    expect(checklist.items.map((i) => i.tipo).sort()).toEqual(
      ['clausula_responsabilidad', 'dni_anverso', 'dni_reverso'].sort(),
    );
  });

  it('debe_marcar_completado_true_solo_para_los_tipos_con_al_menos_un_documento', async () => {
    const { query } = montar({
      documentos: [doc('dni_anverso', new Date('2026-06-20T10:00:00.000Z'))],
    });

    const checklist = await query.ejecutar(consulta);

    const anverso = checklist.items.find((i) => i.tipo === 'dni_anverso');
    const reverso = checklist.items.find((i) => i.tipo === 'dni_reverso');
    const clausula = checklist.items.find((i) => i.tipo === 'clausula_responsabilidad');
    expect(anverso?.completado).toBe(true);
    expect(reverso?.completado).toBe(false);
    expect(clausula?.completado).toBe(false);
  });

  it('debe_marcar_los_tres_completados_cuando_existe_un_documento_de_cada_tipo', async () => {
    const { query } = montar({
      documentos: [
        doc('dni_anverso', new Date('2026-06-20T10:00:00.000Z')),
        doc('dni_reverso', new Date('2026-06-20T10:05:00.000Z')),
        doc('clausula_responsabilidad', new Date('2026-06-20T10:10:00.000Z')),
      ],
    });

    const checklist = await query.ejecutar(consulta);

    expect(checklist.items.every((i) => i.completado)).toBe(true);
  });
});

// ===========================================================================
// 3.4 — El ítem completado toma el documento MÁS RECIENTE (por fechaCreacion).
// ===========================================================================

describe('ObtenerChecklistDocumentacionEventoQuery — documento de referencia más reciente', () => {
  it('debe_referenciar_el_documento_mas_reciente_por_fechaCreacion_de_cada_tipo', async () => {
    const viejo = doc('dni_anverso', new Date('2026-06-20T10:00:00.000Z'), {
      idDocumento: 'anverso-viejo',
    });
    const nuevo = doc('dni_anverso', new Date('2026-06-20T12:30:00.000Z'), {
      idDocumento: 'anverso-nuevo',
    });
    // Orden de entrada arbitrario: la query debe elegir el más reciente igualmente.
    const { query } = montar({ documentos: [nuevo, viejo] });

    const checklist = await query.ejecutar(consulta);

    const anverso = checklist.items.find((i) => i.tipo === 'dni_anverso');
    expect(anverso?.documento?.idDocumento).toBe('anverso-nuevo');
  });

  it('no_debe_incluir_documento_de_referencia_en_los_items_pendientes', async () => {
    const { query } = montar({
      documentos: [doc('dni_anverso', new Date('2026-06-20T10:00:00.000Z'))],
    });

    const checklist = await query.ejecutar(consulta);

    const reverso = checklist.items.find((i) => i.tipo === 'dni_reverso');
    expect(reverso?.documento).toBeUndefined();
  });
});

// ===========================================================================
// FA-01 — el checklist es consultable también en post_evento (subida tardía).
// ===========================================================================

describe('ObtenerChecklistDocumentacionEventoQuery — consultable en post_evento (FA-01)', () => {
  it('debe_devolver_el_checklist_cuando_la_reserva_esta_en_post_evento', async () => {
    const { query } = montar({
      reserva: reservaEnCurso({ estado: 'post_evento' }),
      documentos: [doc('dni_anverso', new Date('2026-06-20T10:00:00.000Z'))],
    });

    const checklist = await query.ejecutar(consulta);

    expect(checklist.items).toHaveLength(3);
    const anverso = checklist.items.find((i) => i.tipo === 'dni_anverso');
    const reverso = checklist.items.find((i) => i.tipo === 'dni_reverso');
    expect(anverso?.completado).toBe(true);
    expect(reverso?.completado).toBe(false);
  });
});

// ===========================================================================
// RLS — la query filtra por tenantId (pasa el tenant al puerto de listado).
// ===========================================================================

describe('ObtenerChecklistDocumentacionEventoQuery — filtrado por tenant (RLS)', () => {
  it('debe_pasar_el_tenantId_y_el_reservaId_al_puerto_de_listado', async () => {
    const { query, listarDocumentosEvento } = montar({ documentos: [] });

    await query.ejecutar(consulta);

    expect(listarDocumentosEvento).toHaveBeenCalledTimes(1);
    const args = listarDocumentosEvento.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / cross-tenant (RLS): la reserva de otro tenant no
//        es resoluble → ReservaNoEncontradaError.
// ===========================================================================

describe('ObtenerChecklistDocumentacionEventoQuery — RESERVA inexistente / cross-tenant', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_la_reserva_no_existe_para_el_tenant', async () => {
    const { query, listarDocumentosEvento } = montar({ reserva: null });

    await expect(
      query.ejecutar({ tenantId: OTRO_TENANT, reservaId: RESERVA_ID }),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
    // Sin reserva resoluble, no se listan documentos.
    expect(listarDocumentosEvento).not.toHaveBeenCalled();
  });
});
