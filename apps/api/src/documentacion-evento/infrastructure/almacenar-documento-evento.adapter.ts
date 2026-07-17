/**
 * Adaptador del puerto `AlmacenarDocumentoEventoPort` (US-033, §D-almacenamiento).
 *
 * Sube el binario al almacén de objetos (`AlmacenDocumentosPort`, épico #6) REUTILIZANDO el
 * adaptador durable seleccionado por env (`ALMACEN_PROVIDER=local` en MVP/test). La clave es
 * VERSIONADA por reserva + tipo: `documentos-evento/{tenantId}/{reservaId}/{tipo}/{uuid}.{ext}`
 * — incluye el tenant (aislamiento), la reserva y el tipo (agrupación) y un `uuid` discriminador
 * para NO sobrescribir versiones anteriores (la re-subida conserva el histórico de binarios,
 * §D-no-idempotencia). La `url` devuelta se persiste en `DOCUMENTO.url`. Hexagonal: depende solo
 * del puerto de dominio del almacén.
 */
import { randomUUID } from 'node:crypto';
import type { AlmacenDocumentosPort } from '../../documentos/domain/almacen-documentos.port';
import type {
  AlmacenarDocumentoEventoPort,
  ArchivoDocumentoEventoSubido,
  TipoDocumentacionEvento,
} from '../application/subir-documento-evento.use-case';

/** Extensión de fichero inferida del mime (para la clave/URL legible). */
const extensionDeMime = (mimeType: string): string => {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
};

export class AlmacenarDocumentoEventoAdapter {
  constructor(private readonly almacen: AlmacenDocumentosPort) {}

  readonly almacenar: AlmacenarDocumentoEventoPort = async (params: {
    tenantId: string;
    reservaId: string;
    tipo: TipoDocumentacionEvento;
    archivo: ArchivoDocumentoEventoSubido;
  }) => {
    const extension = extensionDeMime(params.archivo.mimeType);
    const clave = `documentos-evento/${params.tenantId}/${params.reservaId}/${params.tipo}/${randomUUID()}.${extension}`;
    return this.almacen.subir(new Uint8Array(params.archivo.buffer), clave);
  };
}
