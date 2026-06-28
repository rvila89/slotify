/**
 * Adaptador del puerto `TarifaEstimadaPort` (US-004 / UC-03 §D-4).
 *
 * Envuelve el motor de tarifa de US-016 (`CalculadoraTarifaService`, exportado por
 * `TarifasModule`) y lo adapta al contrato decorativo que necesita el alta para
 * enriquecer E1. Hexagonal: el caso de uso del alta NO conoce `tarifas`, solo el
 * puerto; este adaptador es el único punto de contacto.
 *
 * La TOLERANCIA a faltas/errores (degradar a "E1 sin precio") vive en el caso de
 * uso (`calcularTarifaTolerante`), que solo invoca este puerto cuando hay fecha +
 * invitados + horas y captura cualquier excepción del motor.
 */
import { Injectable } from '@nestjs/common';
import { CalculadoraTarifaService } from '../../tarifas/domain/calculadora-tarifa.service';
import type {
  TarifaEstimadaParams,
  TarifaEstimadaPort,
  TarifaEstimadaResultado,
} from '../application/alta-consulta.use-case';

@Injectable()
export class TarifaEstimadaAdapter implements TarifaEstimadaPort {
  constructor(private readonly calculadora: CalculadoraTarifaService) {}

  async estimar(params: TarifaEstimadaParams): Promise<TarifaEstimadaResultado | null> {
    const resultado = await this.calculadora.calcular(
      {
        fechaEvento: params.fechaEvento,
        duracionHoras: params.duracionHoras,
        numAdultosNinosMayores4: params.numAdultosNinosMayores4,
        extras: params.extras.map((e) => ({ extraId: e.extraId, cantidad: e.cantidad })),
      },
      params.tenantId,
    );
    return {
      temporada: resultado.temporada,
      tarifaAConsultar: resultado.tarifaAConsultar,
      precioTarifaEur: resultado.precioTarifaEur,
      extrasTotalEur: resultado.extrasTotalEur,
      totalEur: resultado.totalEur,
      tarifaId: resultado.tarifaId,
    };
  }
}
