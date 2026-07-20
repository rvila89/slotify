/**
 * Caso de uso `EnviarBorradorUseCase` (US-046 / UC-36; design.md D-1).
 *
 * ACCIÓN MANUAL del Gestor: revisa, edita OPCIONALMENTE `asunto`/`cuerpo` y confirma el
 * envío de una `COMUNICACION` en `estado='borrador'`. Orquesta los puertos de US-045 y
 * DELEGA el envío en el ÚNICO camino de finalización del motor (`finalizarEnvio`), previa
 * edición de `asunto`/`cuerpo` y previa validación del destinatario (D-1, D-4).
 *
 * Guardas (D-2): estado no borrador → `EstadoNoBorradorError` (409, idempotencia: no
 * re-envía, no revierte, no duplica); destinatario nulo/ inválido → `DestinatarioInvalidoError`
 * (422, NO se intenta el envío, la fila PERMANECE en `borrador`); fallo del proveedor →
 * `ProveedorEmailError` (502, la fila ya quedó persistida en `fallido` por el motor, sin
 * propagar la excepción cruda del proveedor). Todo bajo el `tenant_id` del JWT (RLS).
 *
 * Aplicación PURA: depende SOLO de puertos/colaboradores inyectados (hexagonal, hook
 * `no-infra-in-domain`); no importa `@nestjs/*` ni Prisma.
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { CodigoEmail, EstadoComunicacion } from '../domain/codigo-email';
import type { ComunicacionRepositoryPort } from '../domain/comunicacion.repository.port';
import type { AdjuntoRef } from '../domain/enviar-email.port';
import { esEmailValido } from '../domain/esemailvalido';
import type { DespacharEmailService } from './despachar-email.service';
import {
  DestinatarioInvalidoError,
  ProveedorEmailError,
} from './comunicacion-errors';

// Re-exporta los errores COMPARTIDOS para no romper a los consumidores que ya los
// importan desde este módulo (specs, `descartar-borrador`, controller). La definición
// canónica vive en `comunicacion-errors.ts` (misma clase en todos los use-cases).
export {
  DestinatarioInvalidoError,
  ProveedorEmailError,
} from './comunicacion-errors';

/**
 * Proyección de la `COMUNICACION` cargada para la acción manual (por id + tenant + reserva).
 * El `destinatarioEmail` se hereda del CLIENTE y NO es editable por el gestor.
 */
export interface ComunicacionContexto {
  idComunicacion: string;
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: CodigoEmail;
  estado: EstadoComunicacion;
  asunto: string;
  cuerpo: string;
  destinatarioEmail: string | null;
  fechaEnvio: Date | null;
  /**
   * Idioma de la RESERVA vinculada (US-047 D-2): determina el dossier a adjuntar al
   * enviar E1 (`Dossier-Masia-Encis-{idioma}.pdf`). Ausente/nulo → degrada a `'es'`.
   */
  idioma?: string | null;
}

/** Parámetros de carga de la comunicación (scoped por el tenant del JWT y la reserva). */
export interface CargarComunicacionParams {
  tenantId: string;
  reservaId: string;
  idComunicacion: string;
}

/**
 * Puerto de LECTURA de la `COMUNICACION` de la acción manual. El adaptador (RLS) NO
 * devuelve filas de otro tenant (→ `null` → 404).
 */
export interface CargarComunicacionPort {
  cargar(
    params: CargarComunicacionParams,
  ): Promise<ComunicacionContexto | null>;
}

/**
 * Comando de entrada. El `tenantId`/`usuarioId` derivan del JWT (nunca del body); el
 * gestor sólo puede editar `asunto`/`cuerpo` (OPCIONALES). `codigoEmail`/`destinatarioEmail`
 * NO son parte del comando: siempre se usan los de la fila cargada.
 */
export interface EnviarBorradorComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
  idComunicacion: string;
  /** Asunto editado (opcional); si se omite, se envía el original del borrador. */
  asunto?: string;
  /** Cuerpo editado (opcional); si se omite, se envía el original del borrador. */
  cuerpo?: string;
}

/** Resultado: la comunicación tras el envío (estado terminal + fecha efectiva). */
export interface EnviarBorradorResultado {
  idComunicacion: string;
  reservaId: string;
  clienteId: string;
  estado: EstadoComunicacion;
  codigoEmail: CodigoEmail;
  asunto: string;
  cuerpo: string;
  destinatarioEmail: string | null;
  fechaEnvio: Date | null;
  fechaCreacion: Date;
  esReenvio: boolean;
}

/** Dependencias (puertos/colaboradores) del caso de uso. */
export interface EnviarBorradorDeps {
  cargarComunicacion: CargarComunicacionPort;
  comunicaciones: ComunicacionRepositoryPort;
  /** Motor de US-045: se reutiliza `finalizarEnvio` (único camino de envío, D-1). */
  motor: DespacharEmailService;
  auditoria: AuditLogPort;
  /**
   * URL base del almacén de documentos para construir la referencia del dossier E1
   * (US-047 D-2). Si NO está configurada, el envío degrada a `adjuntos: []` (igual que
   * el alta), sin bloquear.
   */
  dossierBaseUrl?: string;
}

/** La `COMUNICACION` no existe para el tenant del JWT (o es de otro tenant, RLS) → 404. */
export class ComunicacionNoEncontradaError extends Error {
  readonly codigo = 'comunicacion_no_encontrada';

  constructor(idComunicacion: string) {
    super(`No se encontró la comunicación ${idComunicacion} para el tenant`);
    this.name = 'ComunicacionNoEncontradaError';
  }
}

/** La `COMUNICACION` no está en `borrador` (ya `enviado`/`fallido`): conflicto → 409. */
export class EstadoNoBorradorError extends Error {
  readonly codigo = 'estado_no_borrador';
  readonly estadoActual: EstadoComunicacion;

  constructor(estadoActual: EstadoComunicacion) {
    super(
      `La comunicación no está en 'borrador' (estado actual: '${estadoActual}'): no es accionable`,
    );
    this.name = 'EstadoNoBorradorError';
    this.estadoActual = estadoActual;
  }
}

/**
 * Heurística conservadora (design.md §D-2) para decidir el formato del cuerpo persistido en
 * el borrador: `true` si contiene marcado de BLOQUE HTML (`<p>`/`<br>`/`<div>`/`<ul>`/`<li>`
 * /`<ol>`), señal de un borrador del catálogo que ya es HTML y NO debe re-escaparse;
 * `false` para el texto plano del E1 de transición o del cuerpo editado por el gestor.
 */
const contieneMarcadoHtml = (cuerpo: string): boolean =>
  /<(p|br|div|ul|ol|li)\b/i.test(cuerpo);

export class EnviarBorradorUseCase {
  constructor(private readonly deps: EnviarBorradorDeps) {}

  async ejecutar(
    comando: EnviarBorradorComando,
  ): Promise<EnviarBorradorResultado> {
    // 1. Cargar la comunicación scoped por el tenant del JWT y la reserva (RLS).
    const comunicacion = await this.deps.cargarComunicacion.cargar({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      idComunicacion: comando.idComunicacion,
    });
    if (comunicacion === null) {
      throw new ComunicacionNoEncontradaError(comando.idComunicacion);
    }

    // 2. Guarda de estado / idempotencia: sólo `borrador` es enviable (no re-envía,
    //    no revierte `enviado`, no duplica). `enviado`/`fallido` son de solo lectura.
    if (comunicacion.estado !== 'borrador') {
      throw new EstadoNoBorradorError(comunicacion.estado);
    }

    // 3. Validación de destinatario PREVIA al envío (D-4): nulo/ inválido bloquea y
    //    DEJA la fila en `borrador` (no la marca `fallido`), sin tocar el proveedor.
    if (!esEmailValido(comunicacion.destinatarioEmail)) {
      throw new DestinatarioInvalidoError();
    }

    // 4. Edición OPCIONAL: se envía lo EFECTIVAMENTE enviado (editado si viene, si no,
    //    el original). `codigoEmail`/`destinatarioEmail` NUNCA se editan (de la fila).
    const asuntoEfectivo = comando.asunto ?? comunicacion.asunto;
    const cuerpoEfectivo = comando.cuerpo ?? comunicacion.cuerpo;

    // 4.a Formato del cuerpo para el borde de envío (change `consulta-fecha-borrador-fix`,
    //     design.md §D-2): un borrador del catálogo persiste HTML (`<p>`/`<br>`) y debe
    //     enviarse INTACTO (sin doble-escape); el E1 de transición y los cuerpos editados
    //     por el gestor son TEXTO PLANO y se convierten a HTML. Se detecta por presencia de
    //     marcado de bloque HTML (heurística conservadora de §D-2).
    const cuerpoEsHtml = contieneMarcadoHtml(cuerpoEfectivo);

    // 4.b Adjunto del dossier al enviar E1 (US-047 D-2): paridad EXACTA con el alta
    //     (`AltaConsultaUseCase`). Solo para `E1` y solo si se conoce la URL base del
    //     almacén; el idioma sale de la RESERVA cargada (ausente → `'es'`). Para otros
    //     códigos o sin `dossierBaseUrl`, se envía SIN adjunto (degradación graceful).
    const idioma = comunicacion.idioma ?? 'es';
    const dossierRef: AdjuntoRef | undefined =
      comunicacion.codigoEmail === 'E1' && this.deps.dossierBaseUrl
        ? {
            clave: 'dossier',
            nombre: `Dossier-Masia-Encis-${idioma}.pdf`,
            pdfUrl: `${this.deps.dossierBaseUrl}/dossiers/Dossier-Masia-Encis-${idioma}.pdf`,
          }
        : undefined;

    // 5. Delegar el envío en el ÚNICO camino de finalización del motor (D-1): éxito →
    //    `enviado` + fecha; fallo del proveedor → `fallido` sin fecha + AUDIT_LOG (el
    //    motor persiste el estado y NO propaga la excepción cruda del proveedor).
    const resultado = await this.deps.motor.finalizarEnvio({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      idComunicacion: comunicacion.idComunicacion,
      destinatario: comunicacion.destinatarioEmail as string,
      asunto: asuntoEfectivo,
      cuerpo: cuerpoEfectivo,
      cuerpoEsHtml,
      codigoEmail: comunicacion.codigoEmail,
      ...(dossierRef !== undefined ? { adjuntos: [dossierRef] } : {}),
    });

    // 6. Fallo del proveedor → error mapeable a 502 (la fila ya quedó `fallido`).
    if (resultado.estado === 'fallido') {
      throw new ProveedorEmailError();
    }

    // 7. AUDIT_LOG del envío manual bajo el tenant del JWT.
    await this.deps.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      accion: 'actualizar',
      entidad: 'COMUNICACION',
      entidadId: comunicacion.idComunicacion,
      datosNuevos: {
        motivo: 'envio_manual_borrador',
        codigoEmail: comunicacion.codigoEmail,
        estado: resultado.estado,
      },
    });

    return {
      idComunicacion: comunicacion.idComunicacion,
      reservaId: comunicacion.reservaId,
      clienteId: comunicacion.clienteId,
      estado: resultado.estado,
      codigoEmail: comunicacion.codigoEmail,
      asunto: asuntoEfectivo,
      cuerpo: cuerpoEfectivo,
      destinatarioEmail: comunicacion.destinatarioEmail,
      fechaEnvio: resultado.fechaEnvio,
      // La fila ya existía (borrador pre-existente): fecha de creación y flag reales.
      fechaCreacion: resultado.comunicacion.fechaCreacion,
      esReenvio: resultado.comunicacion.esReenvio,
    };
  }
}
