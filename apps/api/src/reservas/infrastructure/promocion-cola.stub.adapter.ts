/**
 * STUB no-op del puerto `PromocionColaPort` (US-041 / UC-31, §D-2 — seam US-018).
 *
 * DEUDA TÉCNICA (ligada a US-018 "Promoción del primero en cola"): la liberación de
 * una fecha con cola activa DEBE disparar la promoción del siguiente en cola. Ese
 * caso de uso aún no existe; este adaptador es un no-op idempotente que materializa
 * el SEAM (punto de extensión) sin efectos colaterales. Cuando se implemente US-018,
 * este stub se sustituye por el adaptador que invoca el caso de uso real de
 * promoción. La liberación (US-041) ya invoca el seam exactamente una vez por fecha
 * liberada con cola activa; solo falta el destinatario real.
 */
import { Injectable } from '@nestjs/common';
import { PromocionColaPort } from '../domain/liberar-fecha.service';

@Injectable()
export class PromocionColaStubAdapter implements PromocionColaPort {
  async promoverPrimeroEnCola(_params: { tenantId: string; fecha: Date }): Promise<void> {
    // No-op deliberado hasta US-018. Ver cabecera del fichero.
    return undefined;
  }
}
