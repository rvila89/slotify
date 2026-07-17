/**
 * TESTS de contrato del puerto GENERALIZADO `DocumentoRepositoryPort` (US-033 / GAP
 * D-documento-repo) — fase TDD RED. tasks.md Fase 3: 3.5.
 *
 * Trazabilidad: US-033; spec-delta `documentacion-evento` (Requirement de creación de
 * DOCUMENTO); design.md §D-documento-repo (GENERALIZAR el puerto de US-023 de un
 * literal `'condiciones_particulares'` a un UNION de dominio `TipoDocumentoDominio`, y
 * AÑADIR un método de LISTADO por reserva/tipos para el checklist). US-023
 * (`condiciones_particulares`) debe seguir VERDE (relajación de tipos compatible hacia
 * atrás, aditiva).
 *
 * Es un test de CONTRATO/TIPOS de dominio PURO (hook `no-infra-in-domain`): define un
 * doble in-memory que IMPLEMENTA la interfaz generalizada. Si la interfaz sigue tipada
 * al literal `'condiciones_particulares'`, el doble que usa los tipos del evento y el
 * método de listado NO compila → RED por AUSENCIA DE GENERALIZACIÓN. GREEN es de
 * `backend-developer` (relajar el union + añadir `listarPorReservaYTipos`).
 *
 * RED: hoy `documento.repository.port.ts` tipa `tipo` como el literal
 * `'condiciones_particulares'` y NO expone `listarPorReservaYTipos`. Los símbolos
 * `TipoDocumentoDominio` / `listarPorReservaYTipos` no existen → el import y el tipado
 * fallan.
 */
import type {
  DocumentoRepositoryPort,
  DocumentoPersistido,
  TipoDocumentoDominio,
} from '../documento.repository.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-evento';

/**
 * Doble in-memory que implementa la interfaz GENERALIZADA. Si `tipo` siguiera siendo el
 * literal `'condiciones_particulares'`, los `crear`/`listarPorReservaYTipos` con
 * `dni_anverso` no compilarían.
 */
class DocumentoRepositoryFake implements DocumentoRepositoryPort {
  readonly filas: DocumentoPersistido[] = [];
  private seq = 0;

  async buscarPorReservaYTipo(params: {
    reservaId: string;
    tenantId: string;
    tipo: TipoDocumentoDominio;
  }): Promise<DocumentoPersistido | null> {
    const fila = this.filas.find(
      (f) =>
        f.reservaId === params.reservaId &&
        f.tenantId === params.tenantId &&
        f.tipo === params.tipo,
    );
    return fila ?? null;
  }

  async crear(params: {
    reservaId: string;
    tenantId: string;
    tipo: TipoDocumentoDominio;
    url: string;
    mimeType: string;
    nombreArchivo?: string;
    tamanoBytes?: number;
  }): Promise<DocumentoPersistido> {
    this.seq += 1;
    const fila: DocumentoPersistido = {
      idDocumento: `doc-${this.seq}`,
      tipo: params.tipo,
      reservaId: params.reservaId,
      tenantId: params.tenantId,
      url: params.url,
      mimeType: params.mimeType,
    };
    this.filas.push(fila);
    return fila;
  }

  async listarPorReservaYTipos(params: {
    reservaId: string;
    tenantId: string;
    tipos: ReadonlyArray<TipoDocumentoDominio>;
  }): Promise<DocumentoPersistido[]> {
    return this.filas.filter(
      (f) =>
        f.reservaId === params.reservaId &&
        f.tenantId === params.tenantId &&
        params.tipos.includes(f.tipo),
    );
  }
}

describe('DocumentoRepositoryPort — generalización a union de tipos de dominio (US-033, 3.5)', () => {
  it('debe_admitir_crear_con_los_tres_tipos_de_documentacion_del_evento', async () => {
    const repo = new DocumentoRepositoryFake();

    for (const tipo of [
      'dni_anverso',
      'dni_reverso',
      'clausula_responsabilidad',
    ] as const) {
      const creado = await repo.crear({
        reservaId: RESERVA_ID,
        tenantId: TENANT,
        tipo,
        url: `https://docs/${tipo}.jpg`,
        mimeType: 'image/jpeg',
        nombreArchivo: `${tipo}.jpg`,
        tamanoBytes: 1024,
      });
      expect(creado.tipo).toBe(tipo);
    }

    expect(repo.filas).toHaveLength(3);
  });

  it('debe_seguir_admitiendo_condiciones_particulares_sin_regresion_de_US_023', async () => {
    const repo = new DocumentoRepositoryFake();

    const creado = await repo.crear({
      reservaId: RESERVA_ID,
      tenantId: TENANT,
      tipo: 'condiciones_particulares',
      url: 'https://docs/condiciones.pdf',
      mimeType: 'application/pdf',
    });

    expect(creado.tipo).toBe('condiciones_particulares');
    // La búsqueda idempotente de US-023 sigue disponible con el mismo literal.
    const encontrado = await repo.buscarPorReservaYTipo({
      reservaId: RESERVA_ID,
      tenantId: TENANT,
      tipo: 'condiciones_particulares',
    });
    expect(encontrado?.idDocumento).toBe(creado.idDocumento);
  });

  it('debe_listar_por_reserva_y_tipos_solo_los_del_tenant_y_reserva_solicitados', async () => {
    const repo = new DocumentoRepositoryFake();
    await repo.crear({
      reservaId: RESERVA_ID,
      tenantId: TENANT,
      tipo: 'dni_anverso',
      url: 'https://docs/anverso.jpg',
      mimeType: 'image/jpeg',
    });
    await repo.crear({
      reservaId: RESERVA_ID,
      tenantId: TENANT,
      tipo: 'dni_reverso',
      url: 'https://docs/reverso.jpg',
      mimeType: 'image/jpeg',
    });
    // Documento de otra reserva: no debe aparecer en el listado.
    await repo.crear({
      reservaId: 'otra-reserva',
      tenantId: TENANT,
      tipo: 'clausula_responsabilidad',
      url: 'https://docs/clausula.pdf',
      mimeType: 'application/pdf',
    });

    const listado = await repo.listarPorReservaYTipos({
      reservaId: RESERVA_ID,
      tenantId: TENANT,
      tipos: ['dni_anverso', 'dni_reverso', 'clausula_responsabilidad'],
    });

    expect(listado).toHaveLength(2);
    expect(listado.map((f) => f.tipo).sort()).toEqual(['dni_anverso', 'dni_reverso']);
  });
});
