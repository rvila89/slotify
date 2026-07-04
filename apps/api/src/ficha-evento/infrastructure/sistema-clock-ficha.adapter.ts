/**
 * Adaptador del puerto `ClockPort` de la ficha operativa: reloj del sistema.
 *
 * Aísla `new Date()` para que la aplicación sea determinista y testeable (los tests
 * inyectan un reloj fijo).
 */
import { Injectable } from '@nestjs/common';
import type { ClockPort } from '../domain/ficha-operativa.ports';

@Injectable()
export class SistemaClockFichaAdapter implements ClockPort {
  ahora(): Date {
    return new Date();
  }
}
