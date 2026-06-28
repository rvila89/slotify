/**
 * Adaptador STUB del puerto `EnviarEmailPort` (US-003, design.md §1).
 *
 * No realiza ninguna llamada de red: registra la intención de envío y retorna
 * éxito. Permite cumplir el observable de US-003 (la COMUNICACION E1 persistida con
 * el estado correcto) sin construir la infra real de email. US-045 reemplazará
 * este adaptador por el transporte real (Resend/Postmark) sin tocar el dominio.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  EnviarEmailComando,
  EnviarEmailPort,
} from '../domain/enviar-email.port';

@Injectable()
export class EnviarEmailStubAdapter implements EnviarEmailPort {
  private readonly logger = new Logger(EnviarEmailStubAdapter.name);

  async enviar(comando: EnviarEmailComando): Promise<void> {
    // Stub no-op: deja traza para diagnóstico, sin red (US-045 enchufa el real).
    this.logger.log(
      `[STUB email] ${comando.codigoEmail} → ${comando.destinatario} · "${comando.asunto}"`,
    );
    return Promise.resolve();
  }
}
