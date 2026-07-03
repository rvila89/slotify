/**
 * Adaptador del puerto `ClockPort` del módulo confirmacion: reloj del sistema.
 *
 * Aísla `new Date()` para que el caso de uso sea determinista y testeable (los tests
 * inyectan un reloj fijo).
 */
import { Injectable } from '@nestjs/common';
import type { ClockPort } from '../application/confirmar-pago-senal.use-case';

@Injectable()
export class SistemaClockAdapter implements ClockPort {
  ahora(): Date {
    return new Date();
  }
}
