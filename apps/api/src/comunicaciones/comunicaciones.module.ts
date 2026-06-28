/**
 * Módulo comunicaciones (US-003, hexagonal).
 *
 * Provee el puerto `EnviarEmailPort` con su adaptador STUB (no-op, sin red). Lo
 * exporta para que `reservas` (alta de consulta, email E1) lo consuma por token.
 * US-045 sustituirá el adaptador por el transporte real (Resend/Postmark) sin
 * tocar el dominio ni este contrato.
 */
import { Module } from '@nestjs/common';
import { EnviarEmailStubAdapter } from './infrastructure/enviar-email.stub.adapter';
import { ENVIAR_EMAIL_PORT } from './comunicaciones.tokens';

@Module({
  providers: [{ provide: ENVIAR_EMAIL_PORT, useClass: EnviarEmailStubAdapter }],
  exports: [ENVIAR_EMAIL_PORT],
})
export class ComunicacionesModule {}
