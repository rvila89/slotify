/**
 * Adaptador del puerto `PresentarFacturaSenalBorradorPort` (US-021 §D-6) que MATERIALIZA el
 * disparo de US-022: invoca `GenerarFacturaSenalUseCase` tras el commit de la confirmación.
 *
 * Es un efecto POST-COMMIT: su fallo NO revierte la confirmación (la reserva ya está en
 * `reserva_confirmada`). El caso de uso de confirmación ya traga la excepción; aquí solo se
 * delega la generación de la factura de señal en borrador.
 */
import { Injectable } from '@nestjs/common';
import { GenerarFacturaSenalUseCase } from '../../facturacion/application/generar-factura-senal.use-case';
import type { PresentarFacturaSenalBorradorPort } from '../application/confirmar-pago-senal.use-case';

@Injectable()
export class PresentarFacturaSenalFacturacionAdapter {
  constructor(private readonly generarFactura: GenerarFacturaSenalUseCase) {}

  readonly presentar: PresentarFacturaSenalBorradorPort = async (params) => {
    await this.generarFactura.ejecutar({
      tenantId: params.tenantId,
      reservaId: params.reservaId,
    });
  };
}
