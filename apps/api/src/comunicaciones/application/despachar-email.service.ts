/**
 * Motor de email reutilizable `DespacharEmailService` (US-045 / UC-35, design.md §2).
 *
 * Servicio de APLICACIÓN que orquesta el despacho de un email del ciclo de vida
 * (E1–E8) a partir de un trigger, dependiendo SOLO de puertos de dominio inyectados
 * (catálogo de plantillas, repositorio de COMUNICACION, lectura de idioma del
 * tenant, auditoría, puerto de envío y reloj). No importa Prisma, `@nestjs/*` ni el
 * proveedor externo (hexagonal): el mismo motor sirve a cualquier trigger.
 *
 * Algoritmo (codificado en la batería `despachar-email.service.spec.ts`):
 *   1. Resolver idioma: `comando.idioma ?? TENANT_SETTINGS.idioma ?? 'es'`.
 *   2. Idempotencia: si ya existe COMUNICACION `(reserva, código)` → no duplica ni
 *      reenvía (`motivo:'idempotente'`).
 *   3. Seleccionar plantilla con FALLBACK a `es` (+ AUDIT_LOG si usa el fallback).
 *   4. Si NO es auto-envío → crear `borrador` SIN `fecha_envio` (`motivo:'borrador'`).
 *   5. Validar variables requeridas (nula → AUDIT_LOG, no crea `enviado`,
 *      `motivo:'variable_nula'`).
 *   6. Validar adjuntos requeridos (`pdf_url` nulo → AUDIT_LOG, no envía,
 *      `motivo:'adjunto_no_disponible'`).
 *   7. Crear la fila (outbox) ANTES de enviar: la colisión del UNIQUE parcial en
 *      `crear` (carrera de doble trigger) se captura como `ComunicacionDuplicadaError`
 *      y se trata como "ya existe" sin reenviar (`motivo:'idempotente'`).
 *   8. Enviar por el puerto. Éxito → `actualizarEstado` a `enviado` + `fecha_envio`
 *      (`motivo:'enviado'`). Fallo del proveedor → `actualizarEstado` a `fallido`
 *      SIN `fecha_envio` + AUDIT_LOG, sin reintento ni excepción al llamador
 *      (`motivo:'fallido'`).
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type {
  CatalogoPlantillasPort,
  RenderPlantilla,
} from '../domain/catalogo-plantillas.port';
import type {
  ComunicacionRegistrada,
  ComunicacionRepositoryPort,
} from '../domain/comunicacion.repository.port';
import { ComunicacionDuplicadaError } from '../domain/comunicacion.repository.port';
import type { TenantSettingsPort } from '../domain/tenant-settings.port';
import type { CodigoEmail } from '../domain/codigo-email';
import type {
  AdjuntoRef,
  EnviarEmailComando,
  EnviarEmailPort,
} from '../domain/enviar-email.port';

export type { AdjuntoRef };

/** Idioma por defecto del catálogo (MVP entrega `es`). */
const IDIOMA_DEFECTO = 'es';

/** Puerto de reloj (inyectable) para fijar `fecha_envio` de forma testeable. */
export interface ClockPort {
  ahora(): Date;
}

/** Proyección mínima de la RESERVA que el motor necesita para renderizar. */
export interface ReservaParaDespacho {
  idReserva: string;
  codigo: string;
}

/** Proyección mínima del CLIENTE (el `email` puede faltar → variable nula). */
export interface ClienteParaDespacho {
  idCliente: string;
  nombre: string;
  apellidos: string;
  email: string | null;
  telefono: string;
}

/** Comando de entrada del motor. */
export interface DespacharEmailComando {
  /** Tenant emisor (del JWT en el trigger, nunca del path/body). */
  tenantId: string;
  /** Código de plantilla del catálogo a despachar. */
  codigoEmail: CodigoEmail;
  /** Datos de la RESERVA del trigger. */
  reserva: ReservaParaDespacho;
  /** Datos del CLIENTE destinatario. */
  cliente: ClienteParaDespacho;
  /** Auto-envío (default `true`); `false` deja la comunicación en `borrador`. */
  autoenviar?: boolean;
  /** Idioma explícito (precede al de `TENANT_SETTINGS`). */
  idioma?: string;
  /** Adjuntos por referencia disponibles para el envío. */
  adjuntos?: AdjuntoRef[];
  /**
   * Marca de EDICIÓN (derivada en servidor, default `false`): cuando el disparo
   * proviene de una edición del presupuesto, la plantilla E2 renderiza la variante
   * "presupuesto actualizado" (asunto + párrafo). NO entra por el contrato ni el body.
   */
  esEdicion?: boolean;
}

/** Motivo del resultado del despacho. */
export type MotivoDespacho =
  | 'enviado'
  | 'borrador'
  | 'fallido'
  | 'idempotente'
  | 'variable_nula'
  | 'plantilla_no_encontrada'
  | 'adjunto_no_disponible';

/** Resultado del despacho: la comunicación trazada (o `null`) y el motivo. */
export interface DespacharEmailResultado {
  comunicacion: ComunicacionRegistrada | null;
  motivo: MotivoDespacho;
}

/**
 * Parámetros del camino de envío POST-COMMIT (`finalizarEnvio`): una COMUNICACION ya
 * creada en estado NO final que debe enviarse y promoverse a `enviado`/`fallido`.
 */
export interface FinalizarEnvioParams {
  tenantId: string;
  reservaId: string;
  idComunicacion: string;
  destinatario: string;
  asunto: string;
  cuerpo: string;
  codigoEmail: CodigoEmail;
  /**
   * Formato del `cuerpo` (design.md §D-2): `true` → ya es HTML (borrador del catálogo);
   * `false`/ausente → texto plano (E1 de transición / email manual), se convierte a HTML
   * en el borde de envío. El llamador declara el formato del cuerpo que persistió.
   */
  cuerpoEsHtml?: boolean;
  /** Adjuntos por referencia opcionales (ej. dossier de E1). */
  adjuntos?: AdjuntoRef[];
}

/** Resultado de `finalizarEnvio`: estado terminal alcanzado y la fila actualizada. */
export interface FinalizarEnvioResultado {
  estado: 'enviado' | 'fallido';
  fechaEnvio: Date | null;
  comunicacion: ComunicacionRegistrada;
}

/** Dependencias (puertos) del motor. */
export interface DespacharEmailDeps {
  catalogo: CatalogoPlantillasPort;
  comunicaciones: ComunicacionRepositoryPort;
  tenantSettings: TenantSettingsPort;
  auditoria: AuditLogPort;
  enviarEmail: EnviarEmailPort;
  clock: ClockPort;
}

export class DespacharEmailService {
  constructor(private readonly deps: DespacharEmailDeps) {}

  async despachar(comando: DespacharEmailComando): Promise<DespacharEmailResultado> {
    const { tenantId, codigoEmail, reserva, cliente } = comando;
    const autoenviar = comando.autoenviar ?? true;

    // 1. Resolver idioma: comando → TENANT_SETTINGS → default `es`.
    const idiomaPreferido =
      comando.idioma ??
      (await this.deps.tenantSettings.obtenerIdioma(tenantId)) ??
      IDIOMA_DEFECTO;

    // 2. Idempotencia: si ya existe la comunicación, no duplica ni reenvía.
    const existente = await this.deps.comunicaciones.buscarPorReservaYCodigo({
      tenantId,
      reservaId: reserva.idReserva,
      codigoEmail,
    });
    if (existente !== null) {
      return { comunicacion: existente, motivo: 'idempotente' };
    }

    // 3. Seleccionar plantilla con fallback a `es` (+ auditoría del fallback).
    let idiomaUsado = idiomaPreferido;
    let plantilla = this.deps.catalogo.seleccionar(codigoEmail, idiomaPreferido);
    if (plantilla === null && idiomaPreferido !== IDIOMA_DEFECTO) {
      plantilla = this.deps.catalogo.seleccionar(codigoEmail, IDIOMA_DEFECTO);
      idiomaUsado = IDIOMA_DEFECTO;
      await this.auditar(comando, {
        motivo: 'fallback_idioma',
        idiomaTenant: idiomaPreferido,
        idiomaUsado: IDIOMA_DEFECTO,
        codigoEmail,
      });
    }
    if (plantilla === null) {
      await this.auditar(comando, {
        motivo: 'plantilla_no_encontrada',
        idiomaTenant: idiomaPreferido,
        codigoEmail,
      });
      return { comunicacion: null, motivo: 'plantilla_no_encontrada' };
    }

    const variables = this.construirVariables(comando);
    const render = plantilla.render(variables);

    // 4. Sin auto-envío: crear borrador (sin fecha_envio), sin tocar el proveedor.
    if (!autoenviar) {
      const borrador = await this.deps.comunicaciones.crear({
        tenantId,
        reservaId: reserva.idReserva,
        clienteId: cliente.idCliente,
        codigoEmail,
        asunto: render.asunto,
        cuerpo: render.cuerpoHtml,
        destinatarioEmail: cliente.email ?? '',
        estado: 'borrador',
        fechaEnvio: null,
      });
      return { comunicacion: borrador, motivo: 'borrador' };
    }

    // 5. Validar variables requeridas: una nula impide el envío malformado.
    const variableFaltante = plantilla.variablesRequeridas.find((clave) => {
      const valor = variables[clave];
      return valor === null || valor === undefined || valor === '';
    });
    if (variableFaltante !== undefined) {
      await this.auditar(comando, {
        motivo: 'variable_nula',
        campoFaltante: variableFaltante,
        codigoEmail,
      });
      return { comunicacion: null, motivo: 'variable_nula' };
    }

    // 6. Validar adjuntos requeridos: un pdf_url nulo bloquea el envío.
    for (const clave of plantilla.adjuntosRequeridos) {
      const adjunto = (comando.adjuntos ?? []).find((a) => a.clave === clave);
      if (adjunto === undefined || adjunto.pdfUrl === null) {
        await this.auditar(comando, {
          motivo: 'adjunto_no_disponible',
          adjuntoFaltante: clave,
          codigoEmail,
        });
        return { comunicacion: null, motivo: 'adjunto_no_disponible' };
      }
    }

    // 7. Crear la fila (outbox) ANTES de enviar; la carrera la frena el UNIQUE.
    let comunicacion: ComunicacionRegistrada;
    try {
      comunicacion = await this.deps.comunicaciones.crear({
        tenantId,
        reservaId: reserva.idReserva,
        clienteId: cliente.idCliente,
        codigoEmail,
        asunto: render.asunto,
        cuerpo: render.cuerpoHtml,
        destinatarioEmail: cliente.email as string,
        estado: 'borrador',
        fechaEnvio: null,
      });
    } catch (error) {
      if (error instanceof ComunicacionDuplicadaError) {
        const yaExiste = await this.deps.comunicaciones.buscarPorReservaYCodigo({
          tenantId,
          reservaId: reserva.idReserva,
          codigoEmail,
        });
        return { comunicacion: yaExiste, motivo: 'idempotente' };
      }
      throw error;
    }

    // 8. Enviar por el puerto y FINALIZAR el estado (éxito → enviado + fecha;
    //    fallo → fallido sin fecha + AUDIT_LOG). Camino centralizado y reutilizado
    //    por el cableado E1 del alta (decisión 6 del Gate 1).
    const { estado, fechaEnvio } = await this.enviarYFinalizar({
      tenantId,
      reservaId: reserva.idReserva,
      idComunicacion: comunicacion.idComunicacion,
      codigoEmail,
      comandoEnvio: this.construirComandoEnvio(comando, render, idiomaUsado, variables),
    });
    const finalizada = await this.deps.comunicaciones.actualizarEstado({
      tenantId,
      idComunicacion: comunicacion.idComunicacion,
      estado,
      fechaEnvio,
    });
    return {
      comunicacion: finalizada,
      motivo: estado === 'enviado' ? 'enviado' : 'fallido',
    };
  }

  /**
   * REENVÍO manual e intencionado del Gestor (US-035 D-3A / US-028 D-4): despacha el
   * email SALTÁNDOSE la idempotencia `(reserva_id, codigo_email)` de US-045, creando
   * SIEMPRE una fila COMUNICACION NUEVA marcada `es_reenvio = true` (fuera del índice
   * UNIQUE parcial). Es la excepción AUDITADA a la idempotencia: no consulta la
   * comunicación existente ni la reutiliza; cada llamada es una confirmación nueva al
   * cliente (p. ej. cada corrección del IBAN dispara su propio E8).
   *
   * REUTILIZA el resto del motor (selección de plantilla con fallback, validación de
   * variables/adjuntos y el ÚNICO camino de envío/finalización `enviarYFinalizar`), de
   * modo que el resultado (`enviado`/`fallido`) y su AUDIT_LOG son idénticos al del
   * despacho normal. Best-effort: un fallo del proveedor deja la fila en `fallido` SIN
   * propagar la excepción al llamador (el efecto persistido —p. ej. el IBAN— ya commiteó).
   */
  async despacharReenvio(
    comando: DespacharEmailComando,
  ): Promise<DespacharEmailResultado> {
    const { tenantId, codigoEmail, reserva, cliente } = comando;

    // 1. Resolver idioma (mismo criterio que `despachar`): comando → TENANT_SETTINGS → `es`.
    const idiomaPreferido =
      comando.idioma ??
      (await this.deps.tenantSettings.obtenerIdioma(tenantId)) ??
      IDIOMA_DEFECTO;

    // 2. Seleccionar plantilla con fallback a `es` (+ auditoría del fallback). SIN el
    //    chequeo de idempotencia previo: el reenvío SIEMPRE crea fila nueva.
    let idiomaUsado = idiomaPreferido;
    let plantilla = this.deps.catalogo.seleccionar(codigoEmail, idiomaPreferido);
    if (plantilla === null && idiomaPreferido !== IDIOMA_DEFECTO) {
      plantilla = this.deps.catalogo.seleccionar(codigoEmail, IDIOMA_DEFECTO);
      idiomaUsado = IDIOMA_DEFECTO;
      await this.auditar(comando, {
        motivo: 'fallback_idioma',
        idiomaTenant: idiomaPreferido,
        idiomaUsado: IDIOMA_DEFECTO,
        codigoEmail,
      });
    }
    if (plantilla === null) {
      await this.auditar(comando, {
        motivo: 'plantilla_no_encontrada',
        idiomaTenant: idiomaPreferido,
        codigoEmail,
      });
      return { comunicacion: null, motivo: 'plantilla_no_encontrada' };
    }

    const variables = this.construirVariables(comando);
    const render = plantilla.render(variables);

    // 3. Validar variables requeridas: una nula impide el envío malformado.
    const variableFaltante = plantilla.variablesRequeridas.find((clave) => {
      const valor = variables[clave];
      return valor === null || valor === undefined || valor === '';
    });
    if (variableFaltante !== undefined) {
      await this.auditar(comando, {
        motivo: 'variable_nula',
        campoFaltante: variableFaltante,
        codigoEmail,
      });
      return { comunicacion: null, motivo: 'variable_nula' };
    }

    // 4. Validar adjuntos requeridos.
    for (const clave of plantilla.adjuntosRequeridos) {
      const adjunto = (comando.adjuntos ?? []).find((a) => a.clave === clave);
      if (adjunto === undefined || adjunto.pdfUrl === null) {
        await this.auditar(comando, {
          motivo: 'adjunto_no_disponible',
          adjuntoFaltante: clave,
          codigoEmail,
        });
        return { comunicacion: null, motivo: 'adjunto_no_disponible' };
      }
    }

    // 5. Crear SIEMPRE una fila NUEVA marcada `esReenvio` (excepción a la idempotencia,
    //    D-3A): al estar fuera del índice UNIQUE parcial no colisiona con la fila previa.
    const comunicacion = await this.deps.comunicaciones.crear({
      tenantId,
      reservaId: reserva.idReserva,
      clienteId: cliente.idCliente,
      codigoEmail,
      asunto: render.asunto,
      cuerpo: render.cuerpoHtml,
      destinatarioEmail: cliente.email as string,
      estado: 'borrador',
      fechaEnvio: null,
      esReenvio: true,
    });

    // 6. Enviar y finalizar el estado por el MISMO camino que el despacho normal.
    const { estado, fechaEnvio } = await this.enviarYFinalizar({
      tenantId,
      reservaId: reserva.idReserva,
      idComunicacion: comunicacion.idComunicacion,
      codigoEmail,
      comandoEnvio: this.construirComandoEnvio(comando, render, idiomaUsado, variables),
    });
    const finalizada = await this.deps.comunicaciones.actualizarEstado({
      tenantId,
      idComunicacion: comunicacion.idComunicacion,
      estado,
      fechaEnvio,
    });
    return {
      comunicacion: finalizada,
      motivo: estado === 'enviado' ? 'enviado' : 'fallido',
    };
  }

  /**
   * FINALIZA (post-commit) una COMUNICACION ya creada en estado NO final por un
   * trigger externo (p. ej. el alta de consulta crea la fila E1 en `borrador` DENTRO
   * de su transacción para preservar la atomicidad US-003, y delega aquí el envío).
   *
   * Centraliza el ÚNICO camino de éxito/fallo (decisión 6 del Gate 1): envía por el
   * puerto y promueve la fila a `enviado` (+`fecha_envio`) o, ante fallo del
   * proveedor, a `fallido` (sin `fecha_envio`) + AUDIT_LOG. Sin reintento y SIN
   * propagar la excepción al llamador (el alta ya commiteó: el fallo de email no
   * debe tumbar el 201). Operación idempotente y fuera de la unidad de trabajo del
   * trigger.
   */
  async finalizarEnvio(
    params: FinalizarEnvioParams,
  ): Promise<FinalizarEnvioResultado> {
    const { estado, fechaEnvio } = await this.enviarYFinalizar({
      tenantId: params.tenantId,
      reservaId: params.reservaId,
      idComunicacion: params.idComunicacion,
      codigoEmail: params.codigoEmail,
      comandoEnvio: {
        destinatario: params.destinatario,
        asunto: params.asunto,
        cuerpo: params.cuerpo,
        // Propaga el formato declarado por el llamador (design.md §D-2).
        ...(params.cuerpoEsHtml !== undefined
          ? { cuerpoEsHtml: params.cuerpoEsHtml }
          : {}),
        codigoEmail: params.codigoEmail,
        tenantId: params.tenantId,
        ...(params.adjuntos !== undefined && params.adjuntos.length > 0
          ? { adjuntos: params.adjuntos }
          : {}),
      },
    });
    const finalizada = await this.deps.comunicaciones.actualizarEstado({
      tenantId: params.tenantId,
      idComunicacion: params.idComunicacion,
      estado,
      fechaEnvio,
    });
    return { estado, fechaEnvio, comunicacion: finalizada };
  }

  /**
   * Rellena (post-commit) el CONTENIDO de un borrador E1 creado con comentarios en el
   * alta (fix-borrador-e1-cuerpo-prerelleno): actualiza SOLO `asunto` + `cuerpo` con el
   * texto renderizado, manteniendo la fila en `borrador` (guarda de estado en el
   * repositorio). Delega en el mismo `ComunicacionRepositoryPort` del motor, de modo que
   * el alta reutiliza este servicio (ya inyectado para `finalizarEnvio`) sin wiring nuevo.
   * Fuera de la unidad de trabajo del alta; el llamador lo invoca best-effort.
   */
  async actualizarContenidoBorrador(params: {
    tenantId: string;
    idComunicacion: string;
    asunto: string;
    cuerpo: string;
  }): Promise<ComunicacionRegistrada> {
    return this.deps.comunicaciones.actualizarContenidoBorrador(params);
  }

  /**
   * Núcleo del camino de envío: invoca el puerto y, según el resultado, AUDITA y
   * decide el estado final SIN persistirlo (la persistencia la hace el llamador con
   * el `actualizarEstado`). Nunca propaga la excepción del proveedor.
   */
  private async enviarYFinalizar(ctx: {
    tenantId: string;
    reservaId: string;
    idComunicacion: string;
    codigoEmail: CodigoEmail;
    comandoEnvio: EnviarEmailComando;
  }): Promise<{ estado: 'enviado' | 'fallido'; fechaEnvio: Date | null }> {
    try {
      await this.deps.enviarEmail.enviar(ctx.comandoEnvio);
    } catch (errorProveedor) {
      await this.auditarPorReserva(ctx.tenantId, ctx.reservaId, {
        motivo: 'fallido',
        error:
          errorProveedor instanceof Error
            ? errorProveedor.message
            : String(errorProveedor),
        codigoEmail: ctx.codigoEmail,
      });
      return { estado: 'fallido', fechaEnvio: null };
    }
    await this.auditarPorReserva(ctx.tenantId, ctx.reservaId, {
      motivo: 'enviado',
      codigoEmail: ctx.codigoEmail,
    });
    return { estado: 'enviado', fechaEnvio: this.deps.clock.ahora() };
  }

  /** Variables de plantilla a partir de RESERVA y CLIENTE. */
  private construirVariables(
    comando: DespacharEmailComando,
  ): Record<string, unknown> {
    const { reserva, cliente } = comando;
    return {
      nombre: cliente.nombre,
      apellidos: cliente.apellidos,
      email: cliente.email,
      telefono: cliente.telefono,
      codigo: reserva.codigo,
      codigoReserva: reserva.codigo,
      idReserva: reserva.idReserva,
      // Marca de edición server-side (default false): la plantilla E2 la lee para
      // renderizar la variante "presupuesto actualizado". Se propaga por `despachar`
      // y `despacharReenvio` (ambos usan este helper).
      esEdicion: comando.esEdicion ?? false,
    };
  }

  /** Comando de envío para el puerto, incorporando adjuntos por referencia. */
  private construirComandoEnvio(
    comando: DespacharEmailComando,
    render: RenderPlantilla,
    idioma: string,
    variables: Record<string, unknown>,
  ) {
    return {
      destinatario: comando.cliente.email as string,
      asunto: render.asunto,
      cuerpo: render.cuerpoHtml,
      // El catálogo YA renderiza HTML (`cuerpoHtml`): se envía intacto (design.md §D-2).
      cuerpoEsHtml: true,
      codigoEmail: comando.codigoEmail,
      idioma,
      tenantId: comando.tenantId,
      variables,
      ...(comando.adjuntos !== undefined ? { adjuntos: comando.adjuntos } : {}),
    };
  }

  /** Registra la operación del motor en AUDIT_LOG (entidad COMUNICACION). */
  private async auditar(
    comando: DespacharEmailComando,
    datosNuevos: Record<string, unknown>,
  ): Promise<void> {
    await this.auditarPorReserva(comando.tenantId, comando.reserva.idReserva, datosNuevos);
  }

  /** Variante de `auditar` que no requiere el comando completo (solo tenant + reserva). */
  private async auditarPorReserva(
    tenantId: string,
    reservaId: string,
    datosNuevos: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.auditoria.registrar({
      tenantId,
      accion: 'crear',
      entidad: 'COMUNICACION',
      entidadId: reservaId,
      datosNuevos,
    });
  }
}
