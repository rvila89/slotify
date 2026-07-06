/**
 * Adaptador del puerto `ClockPort` (US-044, design.md §D-3): reloj del sistema. Provee
 * el instante actual para calcular las ventanas temporales del dashboard en backend
 * (evita el off-by-one de TZ del cliente). Aislado en infraestructura para poder fijar
 * un reloj determinista en los tests del use-case.
 */
import { Injectable } from '@nestjs/common';
import type { ClockPort } from '../domain/clock.port';

@Injectable()
export class ClockAdapter implements ClockPort {
  ahora(): Date {
    return new Date();
  }
}
