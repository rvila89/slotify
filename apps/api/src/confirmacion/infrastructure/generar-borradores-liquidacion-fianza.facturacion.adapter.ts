/**
 * Adaptador del puerto `GenerarBorradoresLiquidacionFianzaPort` (US-021/US-027 §D-1) que
 * MATERIALIZA el disparo de US-027: invoca `GenerarBorradoresLiquidacionFianzaUseCase` tras el
 * commit de la confirmación.
 *
 * Es un efecto POST-COMMIT: su fallo NO revierte la confirmación (la reserva ya está en
 * `reserva_confirmada`) y es reintentable por idempotencia. El caso de uso de confirmación ya
 * traga la excepción; aquí solo se delega la generación de los borradores de liquidación/fianza.
 */
import { Injectable } from '@nestjs/common';
import { GenerarBorradoresLiquidacionFianzaUseCase } from '../../facturacion/application/generar-borradores-liquidacion-fianza.use-case';
import type { GenerarBorradoresLiquidacionFianzaPort } from '../application/confirmar-pago-senal.use-case';

@Injectable()
export class GenerarBorradoresLiquidacionFianzaFacturacionAdapter {
  constructor(
    private readonly generarBorradores: GenerarBorradoresLiquidacionFianzaUseCase,
  ) {}

  readonly generar: GenerarBorradoresLiquidacionFianzaPort = async (params) => {
    await this.generarBorradores.ejecutar({
      tenantId: params.tenantId,
      reservaId: params.reservaId,
    });
  };
}
