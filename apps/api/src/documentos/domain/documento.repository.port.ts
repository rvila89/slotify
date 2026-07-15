/**
 * Puerto de dominio del repositorio de DOCUMENTO (épico #6, US-023 / GAP 1 —
 * `condiciones-particulares-e3-us023`).
 *
 * Interfaz PURA de dominio: sin `@nestjs`, sin Prisma (hook `no-infra-in-domain`). El puerto es
 * TX-BOUND: sus operaciones viven DENTRO de la unidad de trabajo (transacción + RLS) del envío
 * E3, de modo que la persistencia del DOCUMENTO se consolida o revierte junto al resto (factura
 * `borrador → enviada`, COMUNICACION E3, AUDIT_LOG). La búsqueda de idempotencia filtra por
 * `tenant_id` (RLS: no se ven documentos de otro tenant).
 *
 * Idempotencia (US-023 §Reglas de validación / design.md §D-persistencia-documento): solo un
 * DOCUMENTO de condiciones por reserva; antes de crear se busca por `reserva + tipo`, y si existe
 * se reutiliza (no se crea una 2ª fila).
 */

/** Proyección mínima del DOCUMENTO persistido. */
export interface DocumentoPersistido {
  idDocumento: string;
  tipo: 'condiciones_particulares';
  reservaId: string;
  tenantId: string;
  url: string;
  mimeType: string;
}

/** Repositorio TX-BOUND de DOCUMENTO, idempotente por reserva + tipo. */
export interface DocumentoRepositoryPort {
  /** Busca el DOCUMENTO de la reserva por tipo (idempotencia). RLS por `tenant_id`. */
  buscarPorReservaYTipo(params: {
    reservaId: string;
    tenantId: string;
    tipo: 'condiciones_particulares';
  }): Promise<DocumentoPersistido | null>;

  /** Crea la fila DOCUMENTO dentro de la unidad de trabajo del envío E3. */
  crear(params: {
    reservaId: string;
    tenantId: string;
    tipo: 'condiciones_particulares';
    url: string;
    mimeType: string;
    nombreArchivo?: string;
    tamanoBytes?: number;
  }): Promise<DocumentoPersistido>;
}
