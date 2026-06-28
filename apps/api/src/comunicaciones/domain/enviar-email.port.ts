/**
 * Puerto de DOMINIO para el envío de email (US-003 / UC-03).
 *
 * Interfaz PURA: no importa `@nestjs/*`, Prisma ni infraestructura (hook
 * `no-infra-in-domain`). La lógica de cuándo enviar (auto-envío de E1 vs borrador
 * según `comentarios`) vive en la aplicación; este puerto solo describe el
 * CONTRATO de transporte.
 *
 * En US-003 el adaptador es un STUB no-op (no hace red). US-045 sustituye ese
 * adaptador por el transporte real (Resend/Postmark) SIN tocar este puerto ni el
 * dominio/aplicación que dependen de él.
 */

/** Datos mínimos para despachar un email transaccional. */
export interface EnviarEmailComando {
  /** Dirección de correo del destinatario. */
  destinatario: string;
  /** Asunto del mensaje. */
  asunto: string;
  /** Cuerpo del mensaje (texto/HTML según el adaptador). */
  cuerpo: string;
  /** Código de plantilla del catálogo (E1…E8). */
  codigoEmail: string;
}

/** Puerto de envío de email. La infraestructura lo implementa con un adaptador. */
export interface EnviarEmailPort {
  enviar(comando: EnviarEmailComando): Promise<void>;
}
