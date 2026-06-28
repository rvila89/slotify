/**
 * Adaptador de reloj del sistema para el motor de email (US-045).
 *
 * INFRAESTRUCTURA: implementa `ClockPort` devolviendo la hora real. Se inyecta para
 * que `fecha_envio` sea testeable (los tests sustituyen el reloj por uno fijo).
 */
import { Injectable } from '@nestjs/common';
import type { ClockPort } from '../application/despachar-email.service';

@Injectable()
export class SistemaClockAdapter implements ClockPort {
  ahora(): Date {
    return new Date();
  }
}
