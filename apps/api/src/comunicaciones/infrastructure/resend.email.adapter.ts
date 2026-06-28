/**
 * Adaptador REAL del puerto `EnviarEmailPort` sobre Resend (US-045, design.md §1).
 *
 * INFRAESTRUCTURA: el proveedor externo vive SOLO aquí; el dominio/aplicación
 * dependen del puerto. Se selecciona con `EMAIL_TRANSPORT=resend`. En modo
 * `EMAIL_SANDBOX` el destinatario se reescribe a una dirección de prueba de Resend
 * (`delivered@resend.dev`) para QA sin alcanzar al cliente. El SDK NO lanza ante
 * errores de la API (devuelve `{ data, error }`); aquí se traduce el `error` a una
 * excepción para que el motor marque la COMUNICACION como `fallido` + AUDIT_LOG.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import type {
  AdjuntoRef,
  EnviarEmailComando,
  EnviarEmailPort,
} from '../domain/enviar-email.port';

/** Dirección de prueba de Resend usada en modo sandbox (no alcanza al cliente). */
const DESTINATARIO_SANDBOX = 'delivered@resend.dev';

/** Configuración del transporte Resend (de `config/env.validation`). */
export interface ResendEmailConfig {
  apiKey: string;
  from: string;
  sandbox: boolean;
}

@Injectable()
export class ResendEmailAdapter implements EnviarEmailPort {
  private readonly logger = new Logger(ResendEmailAdapter.name);
  private readonly cliente: Resend;

  constructor(private readonly config: ResendEmailConfig) {
    this.cliente = new Resend(config.apiKey);
  }

  async enviar(comando: EnviarEmailComando): Promise<void> {
    const destinatario = this.config.sandbox
      ? DESTINATARIO_SANDBOX
      : comando.destinatario;

    const { data, error } = await this.cliente.emails.send({
      from: this.config.from,
      to: [destinatario],
      subject: comando.asunto,
      html: comando.cuerpo,
      text: comando.cuerpo,
      ...this.adjuntosResend(comando.adjuntos),
    });

    if (error !== null) {
      // El motor traduce esta excepción en estado `fallido` + AUDIT_LOG.
      throw new Error(
        `Resend rechazó el envío de ${comando.codigoEmail}: ${error.message}`,
      );
    }
    this.logger.log(
      `[resend] ${comando.codigoEmail} → ${destinatario} (id ${data?.id ?? '—'})`,
    );
  }

  /** Traduce los adjuntos por referencia al formato de Resend (URL → `path`). */
  private adjuntosResend(
    adjuntos: AdjuntoRef[] | undefined,
  ): { attachments?: { filename: string; path: string }[] } {
    const disponibles = (adjuntos ?? []).filter(
      (adjunto): adjunto is AdjuntoRef & { pdfUrl: string } =>
        adjunto.pdfUrl !== null,
    );
    if (disponibles.length === 0) {
      return {};
    }
    return {
      attachments: disponibles.map((adjunto) => ({
        filename: adjunto.nombre,
        path: adjunto.pdfUrl,
      })),
    };
  }
}
