/**
 * Adaptador del puerto `ClockPort`: reloj del sistema.
 *
 * Aísla `new Date()` para que el dominio sea determinista y testeable (los
 * tests inyectan un reloj fijo).
 */
import { Injectable } from '@nestjs/common';
import { ClockPort } from '../domain/bloquear-fecha.service';

@Injectable()
export class SistemaClockAdapter implements ClockPort {
  ahora(): Date {
    return new Date();
  }
}
