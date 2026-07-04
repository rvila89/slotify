/**
 * Adaptador del puerto `ClockPort` del módulo facturacion: reloj del sistema.
 *
 * Aísla `new Date()` para que los casos de uso sean deterministas y testeables (los tests
 * inyectan un reloj fijo).
 */
import { Injectable } from '@nestjs/common';
import type { ClockPort } from '../application/generar-factura-senal.use-case';

@Injectable()
export class SistemaClockAdapter implements ClockPort {
  ahora(): Date {
    return new Date();
  }
}
