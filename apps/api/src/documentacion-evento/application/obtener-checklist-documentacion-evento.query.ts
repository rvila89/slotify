/**
 * Query de APLICACIÓN: obtener el CHECKLIST del estado de la documentación obligatoria
 * del evento (UC-24 / US-033).
 *
 * El checklist se DERIVA por lectura (no se materializa, §D-checklist): para cada uno de
 * los tres tipos obligatorios `completado = existe ≥ 1 DOCUMENTO de ese tipo + reservaId
 * bajo RLS`; el `documento` de referencia es el MÁS RECIENTE por `fechaCreacion`. Siempre
 * devuelve los tres ítems en orden canónico.
 *
 * A diferencia de la ESCRITURA (solo `evento_en_curso`), el checklist es CONSULTABLE en
 * cualquier estado —incluido `post_evento` (FA-01)—: solo exige que la RESERVA sea
 * resoluble bajo RLS (cross-tenant → 404). Filtra por `tenantId` (RLS).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa
 * Prisma ni `@nestjs/*`.
 */
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';
import {
  derivarChecklistDocumentacionEvento,
  TIPOS_DOCUMENTACION_EVENTO,
  type ChecklistDocumentacionEvento,
  type DocumentoEventoPersistido,
  type TipoDocumentacionEvento,
} from './subir-documento-evento.use-case';

export type {
  ChecklistDocumentacionEvento,
  ChecklistItemDocumentacionEvento,
  DocumentoEventoPersistido,
  TipoDocumentacionEvento,
} from './subir-documento-evento.use-case';

/** Proyección de la RESERVA relevante para el checklist: estado + tenant (RLS). */
export interface ReservaChecklistDocumentacionEvento {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
}

/** Lectura de la RESERVA (RLS: cross-tenant → null → 404). */
export interface CargarReservaChecklistPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaChecklistDocumentacionEvento | null | undefined>;
}

/** Listado de los DOCUMENTOs del evento (RLS por `tenantId`). */
export interface ListarDocumentosEventoPort {
  (params: {
    tenantId: string;
    reservaId: string;
    tipos: ReadonlyArray<TipoDocumentacionEvento>;
  }): Promise<DocumentoEventoPersistido[]>;
}

/** Dependencias de la query (puertos inyectados). */
export interface ObtenerChecklistDocumentacionEventoDeps {
  cargarReserva: CargarReservaChecklistPort;
  listarDocumentosEvento: ListarDocumentosEventoPort;
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant invisible → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

export class ObtenerChecklistDocumentacionEventoQuery {
  constructor(private readonly deps: ObtenerChecklistDocumentacionEventoDeps) {}

  /**
   * Devuelve el checklist derivado. Exige que la RESERVA sea resoluble bajo RLS (404 si
   * no); no restringe por estado (consultable también en `post_evento`).
   */
  async ejecutar(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ChecklistDocumentacionEvento> {
    const reserva = await this.deps.cargarReserva({
      tenantId: params.tenantId,
      reservaId: params.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError(params.reservaId);
    }
    const documentos = await this.deps.listarDocumentosEvento({
      tenantId: params.tenantId,
      reservaId: params.reservaId,
      tipos: TIPOS_DOCUMENTACION_EVENTO,
    });
    return derivarChecklistDocumentacionEvento(documentos);
  }
}
