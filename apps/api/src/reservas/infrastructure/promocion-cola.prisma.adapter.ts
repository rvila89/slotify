/**
 * Adaptador REAL del seam `PromocionColaPort` (US-018 / UC-12, A15). SUSTITUYE al
 * `PromocionColaStubAdapter` no-op (D-1): la liberación de una fecha con cola activa
 * (`liberarFecha()`, US-041) dispara este adaptador post-commit EXACTAMENTE una vez, y
 * aquí se ejecuta la mecánica real A15 (promoción FIFO + re-bloqueo + reordenación).
 *
 * NO re-inventa el seam ni el disparo (contrato CONGELADO de US-012/US-041): recibe
 * `{ tenantId, fecha }` y delega en el caso de uso de aplicación
 * `PromoverPrimeroEnColaService`, que orquesta la transacción atómica vía la UoW. El
 * puerto devuelve `void`; el desenlace detallado lo consume el propio caso de uso.
 *
 * Hexagonal: infraestructura que enlaza el seam de dominio con el caso de uso; el
 * efecto real (transacción, lock, RLS) vive en la UoW Prisma.
 */
import { Injectable } from '@nestjs/common';
import type { PromocionColaPort } from '../domain/liberar-fecha.service';
import { PromoverPrimeroEnColaService } from '../application/promover-primero-en-cola.service';

@Injectable()
export class PromocionColaPrismaAdapter implements PromocionColaPort {
  constructor(private readonly servicio: PromoverPrimeroEnColaService) {}

  async promoverPrimeroEnCola(params: { tenantId: string; fecha: Date }): Promise<void> {
    await this.servicio.promoverPrimeroEnCola(params);
  }
}
