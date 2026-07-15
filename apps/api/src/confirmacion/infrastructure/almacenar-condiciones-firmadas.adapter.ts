/**
 * Adaptador del puerto `AlmacenarCondicionesFirmadasPort` (US-024, §D-almacenamiento).
 *
 * Sube la copia firmada al almacén de objetos (`AlmacenDocumentosPort`, épico #6)
 * REUTILIZANDO el adaptador seleccionado por env (`local` en MVP/test). La clave es
 * VERSIONADA por reserva (decisión Gate 1): `condiciones-firmadas/{tenantId}/
 * {reservaId}/{uuid}.{ext}` — incluye el tenant (aislamiento), la reserva (agrupación)
 * y un `uuid` discriminador de versión para NO sobrescribir versiones anteriores (la
 * re-firma conserva el histórico de binarios, §D-re-firma). La `url` devuelta se
 * persiste en `DOCUMENTO.url`. Hexagonal: depende solo del puerto de dominio del almacén.
 */
import { randomUUID } from 'node:crypto';
import type { AlmacenDocumentosPort } from '../../documentos/domain/almacen-documentos.port';
import type {
  AlmacenarCondicionesFirmadasPort,
  CondicionesFirmadasSubidas,
} from '../application/registrar-firma-condiciones.use-case';

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

export class AlmacenarCondicionesFirmadasAdapter {
  constructor(private readonly almacen: AlmacenDocumentosPort) {}

  readonly almacenar: AlmacenarCondicionesFirmadasPort = async (params: {
    tenantId: string;
    reservaId: string;
    condiciones: CondicionesFirmadasSubidas;
  }) => {
    const extension = extensionDeMime(params.condiciones.mimeType);
    const clave = `condiciones-firmadas/${params.tenantId}/${params.reservaId}/${randomUUID()}.${extension}`;
    return this.almacen.subir(new Uint8Array(params.condiciones.buffer), clave);
  };
}
