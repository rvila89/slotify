/**
 * Adaptador STUB del puerto `PresentarFacturaSenalBorradorPort` (US-021, §D-6).
 *
 * La presentación de la factura de señal en borrador es un efecto POST-COMMIT y es del
 * dominio de US-022 (UC-18), FUERA del alcance de este change (anti-scope). Aquí solo se
 * deja el punto de extensión: un stub no-op que US-022 sustituirá por el disparo real de
 * la generación del borrador. Su fallo NO revierte la confirmación (lo garantiza el
 * caso de uso, que traga la excepción).
 */
import { Injectable } from '@nestjs/common';
import type { PresentarFacturaSenalBorradorPort } from '../application/confirmar-pago-senal.use-case';

@Injectable()
export class PresentarFacturaSenalStubAdapter {
  readonly presentar: PresentarFacturaSenalBorradorPort = async () => {
    // No-op en US-021: la generación/aprobación de la factura de señal es US-022.
  };
}
