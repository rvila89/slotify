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
   * - URL del ALMACÉN LOCAL (`ALMACEN_LOCAL_BASE_URL`, p. ej. `http://localhost:3000/almacen/…`)
   *   → `content` como Buffer leyendo el fichero de `ALMACEN_LOCAL_DIR`. Es la CAUSA RAÍZ del
   *   `fallido` de E2: el `pdfUrl` de un adjunto lo produce el almacén como una URL pública
   *   (`urlPublica`), pero en dev/sandbox esa URL apunta a `localhost` y NO es ALCANZABLE por los
   *   servidores de Resend (que intentan descargar el `path`), por lo que la API rechaza el envío
   *   y el motor marca la COMUNICACION como `fallido`. Al ser el adjunto del presupuesto REQUERIDO
   *   (D-1), degradar no es opción: se resuelve la URL local a bytes y se envía como `content`.
   * - Otra URL HTTP/HTTPS (almacén cloud público) → `path` (la API de Resend la descarga).
   * - Path local del sistema de ficheros → `content` como Buffer (el SDK de Resend no lee paths
   *   locales; la API los rechaza con 422).
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
        const rutaLocalAlmacen = this.rutaLocalDeUrlAlmacen(adjunto.pdfUrl);
        if (rutaLocalAlmacen !== null) {
          // URL del almacén LOCAL: NO reenviar como `path` (Resend no alcanza localhost).
          // Leer el fichero del almacén y enviarlo como Buffer (fix del `fallido`).
          return { filename: adjunto.nombre, content: this.leerPdfLocal(rutaLocalAlmacen) };
        }
        if (adjunto.pdfUrl.startsWith('http://') || adjunto.pdfUrl.startsWith('https://')) {
          // URL pública (almacén cloud): Resend la descarga.
          return { filename: adjunto.nombre, path: adjunto.pdfUrl };
        }
        // Path local del sistema de ficheros (dev sin S3): leer y enviar como Buffer.
        return { filename: adjunto.nombre, content: this.leerPdfLocal(adjunto.pdfUrl) };
      }),
    };
  }

  /**
   * Si `pdfUrl` es una URL servida por el ALMACÉN LOCAL (`ALMACEN_LOCAL_BASE_URL`), devuelve la
   * RUTA FÍSICA del fichero bajo `ALMACEN_LOCAL_DIR`; `null` en otro caso (URL cloud pública o
   * path local, que se tratan aparte). Así el adjunto local se envía como Buffer alcanzable por
   * Resend en lugar de una URL `localhost` que la API no puede descargar.
   */
  private rutaLocalDeUrlAlmacen(pdfUrl: string): string | null {
    const baseUrl = (process.env['ALMACEN_LOCAL_BASE_URL'] ?? 'http://localhost:3000/almacen')
      .replace(/\/+$/, '');
    if (!pdfUrl.startsWith(`${baseUrl}/`)) {
      return null;
    }
    const clave = pdfUrl.slice(baseUrl.length + 1);
    const almacenDir = path.resolve(process.env['ALMACEN_LOCAL_DIR'] ?? '.almacen');
    return path.resolve(almacenDir, clave);
  }

  /**
   * Lee un PDF del almacén local como Buffer, restringido al directorio del almacén (evita
   * arbitrary file read) y a la extensión `.pdf`.
   */
  private leerPdfLocal(rutaFichero: string): Buffer {
    const almacenDir = path.resolve(process.env['ALMACEN_LOCAL_DIR'] ?? '.almacen');
    const resolved = path.resolve(rutaFichero);
    if (resolved !== almacenDir && !resolved.startsWith(almacenDir + path.sep)) {
      throw new Error(`Adjunto fuera del directorio permitido: ${rutaFichero}`);
    }
    if (path.extname(resolved).toLowerCase() !== '.pdf') {
      throw new Error(`Extensión de adjunto no permitida: ${rutaFichero}`);
    }
    return fs.readFileSync(resolved);
  }
}
