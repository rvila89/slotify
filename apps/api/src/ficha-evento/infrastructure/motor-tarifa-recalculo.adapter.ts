/**
 * Adaptador del puerto `MotorTarifaRecalculoPort` (change `reserva-viva-edicion-recalculo-
 * ficha` §D-4.1) sobre `CalculadoraTarifaService` (US-016).
 *
 * Traduce el resultado del motor al subconjunto que consume `RecalcularReservaVivaUseCase`
 * y NORMALIZA los edge cases de §D-7 a `tarifaAConsultar`: `>50` invitados ya devuelve
 * `tarifaAConsultar=true`; `TarifaNoConfiguradaError` (combinación válida sin fila de tarifa)
 * también se degrada a `tarifaAConsultar` (el use-case exigirá `precioManualEur`).
 * `TemporadaNoConfiguradaError` y `ValidacionTarifaError` se propagan (422/400).
 */
import { Injectable } from '@nestjs/common';
import {
  CalculadoraTarifaService,
  TarifaNoConfiguradaError,
} from '../../tarifas/domain/calculadora-tarifa.service';
import type {
  MotorTarifaRecalculoPort,
  ResultadoTarifaRecalculo,
} from '../application/recalcular-reserva-viva.use-case';

@Injectable()
export class MotorTarifaRecalculoAdapter implements MotorTarifaRecalculoPort {
  constructor(private readonly calculadora: CalculadoraTarifaService) {}

  async calcular(
    input: {
      fechaEvento: Date;
      duracionHoras: number;
      numAdultosNinosMayores4: number;
      extras: Array<{ extraId: string; cantidad: number }>;
    },
    tenantId: string,
  ): Promise<ResultadoTarifaRecalculo> {
    try {
      const resultado = await this.calculadora.calcular(input, tenantId);
      return {
        tarifaAConsultar: resultado.tarifaAConsultar,
        totalEur: resultado.totalEur,
      };
    } catch (error) {
      // Combinación válida sin fila de TARIFA → tarifa a consultar (precio manual, §D-7).
      if (error instanceof TarifaNoConfiguradaError) {
        return { tarifaAConsultar: true, totalEur: null };
      }
      throw error;
    }
  }
}
