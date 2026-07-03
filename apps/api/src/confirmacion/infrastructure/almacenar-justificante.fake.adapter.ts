/**
 * Adaptador FAKE del puerto `AlmacenarJustificantePort` (US-021, §D-5).
 *
 * En el MVP/test el almacenamiento del binario se simula devolviendo una `url` local
 * determinista (mismo enfoque que el PDF de presupuesto de US-014, que usa un fake). El
 * proveedor real (bucket/objeto) se enchufará aquí sin tocar el caso de uso, que solo
 * conoce el puerto. La `url` devuelta se persiste en `DOCUMENTO.url`.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AlmacenarJustificantePort,
  JustificanteSubido,
} from '../application/confirmar-pago-senal.use-case';

/** Extensión de fichero inferida del mime (para una URL legible en el fake). */
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

@Injectable()
export class AlmacenarJustificanteFakeAdapter {
  readonly almacenar: AlmacenarJustificantePort = async (params: {
    tenantId: string;
    reservaId: string;
    justificante: JustificanteSubido;
  }) => {
    const extension = extensionDeMime(params.justificante.mimeType);
    return `https://storage.local/${params.tenantId}/${params.reservaId}/justificante-${randomUUID()}.${extension}`;
  };
}
