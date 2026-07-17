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
import * as fs from 'node:fs';
import * as path from 'node:path';
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

  /**
   * Traduce los adjuntos por referencia al formato de Resend.
   * - URL HTTP/HTTPS → `path` (la API de Resend la descarga).
   * - Path local del sistema de ficheros → `content` como Buffer (el SDK de
   *   Resend no lee paths locales; la API los rechaza con 422).
   */
  private adjuntosResend(
    adjuntos: AdjuntoRef[] | undefined,
  ): { attachments?: { filename: string; path?: string; content?: Buffer }[] } {
    const disponibles = (adjuntos ?? []).filter(
      (adjunto): adjunto is AdjuntoRef & { pdfUrl: string } =>
        adjunto.pdfUrl !== null,
    );
    if (disponibles.length === 0) {
      return {};
    }
    return {
      attachments: disponibles.map((adjunto) => {
        if (adjunto.pdfUrl.startsWith('http://') || adjunto.pdfUrl.startsWith('https://')) {
          return { filename: adjunto.nombre, path: adjunto.pdfUrl };
        }
        // Path local: leer el fichero y enviar como Buffer (dev sin S3).
        // Restringir al directorio del almacén para evitar arbitrary file read.
        const almacenDir = path.resolve(process.env['ALMACEN_LOCAL_DIR'] ?? '.almacen');
        const resolved = path.resolve(adjunto.pdfUrl);
        if (!resolved.startsWith(almacenDir + path.sep)) {
          throw new Error(`Adjunto fuera del directorio permitido: ${adjunto.nombre}`);
        }
        if (path.extname(resolved).toLowerCase() !== '.pdf') {
          throw new Error(`Extensión de adjunto no permitida: ${adjunto.nombre}`);
        }
        const content = fs.readFileSync(resolved);
        return { filename: adjunto.nombre, content };
      }),
    };
  }
}
