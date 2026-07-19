/**
 * Caso de uso de APLICACIÓN: confirmar el pago de la señal y activar la reserva
 * confirmada (UC-17 / US-021) — cierre del camino feliz previo al evento.
 *
 * Orquesta CINCO mutaciones en una sola transacción de BD (all-or-nothing) más un
 * efecto post-commit:
 *   0. Guardas SÍNCRONAS previas a la tx (rechazo SIN efectos): justificante presente,
 *      formato/tamaño válidos (≤ 10 MB, jpeg/png/pdf), RESERVA existente (404), origen
 *      válido (`pre_reserva`), `importe_total > 0`. Se validan ANTES de subir el fichero
 *      y de abrir la transacción.
 *   1. Sube físicamente el justificante al almacenamiento (fuera de la tx crítica;
 *      un rollback deja como mucho un fichero huérfano, nunca una fila DOCUMENTO sin
 *      RESERVA confirmada — §D-5).
 *   2. En UNA unidad de trabajo (tx + RLS):
 *        a. Crea el DOCUMENTO `tipo='justificante_pago'` (reservaId, tenantId, url, mime).
 *        b. Upgrade del bloqueo blando→firme reutilizando la primitiva atómica de
 *           US-040 (`bloquearFecha(fase='reserva_confirmada')`, UPDATE de la fila
 *           existente, `firme`/`ttl NULL`, `SELECT … FOR UPDATE` + `UNIQUE(tenant,fecha)`).
 *           El `SELECT … FOR UPDATE` serializa el doble clic (una gana; la segunda
 *           observa `reserva_confirmada` y aborta con `RESERVA_YA_CONFIRMADA`) y el
 *           `UNIQUE` frena la carrera D4 (fecha ya firme de OTRA reserva →
 *           `FECHA_NO_DISPONIBLE`). NUNCA Redis/locks distribuidos.
 *        c. Transición RESERVA `pre_reserva → reserva_confirmada`, `ttl_expiracion=NULL`,
 *           importes congelados (señal + liquidación) y los tres sub-procesos a
 *           `pendiente`.
 *        d. FICHA_OPERATIVA vacía IDEMPOTENTE (busca por reserva_id; si existe, no crea).
 *        e. AUDIT_LOG `accion='transicion'` (pre_reserva → reserva_confirmada).
 *      Tras el commit PRESENTA la factura de señal en borrador (US-022); su fallo NO
 *      revierte la confirmación ya comprometida.
 *
 * Importes (§D-3): `importe_senal = round(importe_total × pct_senal/100, 2)`,
 * `importe_liquidacion = importe_total − importe_senal` (complemento por resta, evita
 * desajuste de céntimos). `pct_senal` desde TENANT_SETTINGS (nunca hardcodeado).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa
 * Prisma ni `@nestjs/*`.
 */
import {
  esOrigenValidoParaConfirmarSenal,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Fichero justificante subido por el Gestor (multipart). */
export interface JustificanteSubido {
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number;
  buffer: Buffer;
}

/** Comando de confirmación del pago de la señal. */
export interface ConfirmarPagoSenalComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la operación (para auditoría). */
  usuarioId: string;
  /** RESERVA a confirmar (debe existir, ser origen válido y tener importe_total > 0). */
  reservaId: string;
  /** Fichero justificante; `null` si no se adjuntó (→ JUSTIFICANTE_REQUERIDO). */
  justificante: JustificanteSubido | null;
}

/** Proyección de la RESERVA relevante para la confirmación (origen, fecha, importe). */
export interface ReservaConfirmacion {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento: Date | null;
  /** Importe total (IVA incluido) fijado en la pre-reserva (US-014); Decimal string. */
  importeTotal: string | null;
  /**
   * Comentarios libres del alta (mejoras-detalle-consulta). Al crear la FICHA_OPERATIVA
   * vacía se usan para SEMBRAR `notasOperativas` (si existen y no están en blanco).
   */
  comentarios: string | null;
}

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Settings del tenant necesarios para congelar la señal (nunca hardcodeados). */
export interface TenantSettingsConfirmacion {
  /** Porcentaje de la señal sobre el total (40 en MVP). */
  pctSenal: number;
}

/** Lectura de los settings del tenant (RLS: cross-tenant → null). */
export interface TenantSettingsConfirmacionPort {
  obtener(tenantId: string): Promise<TenantSettingsConfirmacion | null>;
}

/** Datos para crear el DOCUMENTO del justificante. */
export interface CrearJustificanteParams {
  tenantId: string;
  reservaId: string;
  tipo: 'justificante_pago';
  nombreArchivo: string;
  url: string;
  mimeType: string;
  tamanoBytes: number;
}

/** DOCUMENTO creado (proyección de vuelta). */
export interface DocumentoCreado {
  idDocumento: string;
  tipo: string;
}

/** Repositorio tx-bound de DOCUMENTO. */
export interface DocumentoConfirmacionRepositoryPort {
  crearJustificante(params: CrearJustificanteParams): Promise<DocumentoCreado>;
}

/** Parámetros de la transición de la RESERVA a `reserva_confirmada` (importes + subs). */
export interface ConfirmarSenalReservaParams {
  idReserva: string;
  estado: 'reserva_confirmada';
  ttlExpiracion: null;
  importeSenal: string;
  importeLiquidacion: string;
  preEventoStatus: 'pendiente';
  liquidacionStatus: 'pendiente';
  fianzaStatus: 'pendiente';
}

/** Repositorio tx-bound de la RESERVA: aplica la transición + congelado de importes. */
export interface ReservaConfirmacionRepositoryPort {
  confirmarSenal(params: ConfirmarSenalReservaParams): Promise<void>;
}

/**
 * Repositorio tx-bound del upgrade del bloqueo a firme (fase `reserva_confirmada`).
 * Reutiliza la primitiva atómica de US-040 (`SELECT … FOR UPDATE` + `UNIQUE`): promueve
 * por UPDATE la fila existente de `(tenant, fecha)` a `firme`/`ttl NULL` conservando el
 * `reserva_id`. Puede lanzar `ReservaYaConfirmadaError` (doble clic: la RESERVA ya está
 * confirmada bajo el lock) o `FechaNoDisponibleError` (`P2002`: fecha ya firme de otra
 * reserva).
 */
export interface FechaBloqueadaConfirmacionRepositoryPort {
  upgradeAFirme(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<void>;
}

/** FICHA_OPERATIVA existente (proyección de la comprobación de idempotencia). */
export interface FichaOperativaExistente {
  idFicha: string;
  reservaId: string;
}

/** Repositorio tx-bound de FICHA_OPERATIVA (idempotente por `reserva_id @unique`). */
export interface FichaOperativaConfirmacionRepositoryPort {
  buscarPorReserva(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<FichaOperativaExistente | null>;
  crearVacia(params: {
    reservaId: string;
    fichaCerrada: false;
    /**
     * Siembra inicial de `notasOperativas` (mejoras-detalle-consulta): el
     * `comentarios` de la RESERVA ya recortado, o `null` si no había. Solo se aplica
     * al crear la ficha (idempotente: si ya existe, `crearVacia` no se invoca).
     */
    notasOperativas: string | null;
  }): Promise<{ idFicha: string }>;
}

/** Registro de auditoría de la transición. */
export interface RegistroAuditoriaConfirmacion {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'RESERVA';
  entidadId: string;
  accion: 'transicion';
  datosAnteriores: Record<string, unknown>;
  datosNuevos: Record<string, unknown>;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaConfirmacionPort {
  registrar(registro: RegistroAuditoriaConfirmacion): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosConfirmacion {
  documentos: DocumentoConfirmacionRepositoryPort;
  reservas: ReservaConfirmacionRepositoryPort;
  fechaBloqueada: FechaBloqueadaConfirmacionRepositoryPort;
  fichaOperativa: FichaOperativaConfirmacionRepositoryPort;
  auditoria: AuditoriaConfirmacionPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios tx-bound. Si el `trabajo`
 * rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoConfirmacionPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosConfirmacion) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA (fuera de la tx crítica; RLS: cross-tenant → null). */
export interface CargarReservaConfirmacionPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaConfirmacion | null | undefined>;
}

/** Almacenamiento físico del fichero justificante; devuelve la `url` persistible. */
export interface AlmacenarJustificantePort {
  (params: {
    tenantId: string;
    reservaId: string;
    justificante: JustificanteSubido;
  }): Promise<string>;
}

/** Presentación POST-COMMIT de la factura de señal en borrador (disparo de US-022). */
export interface PresentarFacturaSenalBorradorPort {
  (params: { tenantId: string; reservaId: string }): Promise<void>;
}

/**
 * Generación POST-COMMIT de los borradores de liquidación y fianza (disparo de US-027). Espejo
 * del disparo de la factura de señal (US-022): efecto posterior al commit de la confirmación,
 * atómico entre sus dos documentos. Su fallo NO revierte la confirmación (§D-1).
 */
export interface GenerarBorradoresLiquidacionFianzaPort {
  (params: { tenantId: string; reservaId: string }): Promise<void>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface ConfirmarPagoSenalDeps {
  unidadDeTrabajo: UnidadDeTrabajoConfirmacionPort;
  tenantSettings: TenantSettingsConfirmacionPort;
  cargarReserva: CargarReservaConfirmacionPort;
  almacenarJustificante: AlmacenarJustificantePort;
  presentarFacturaSenalBorrador: PresentarFacturaSenalBorradorPort;
  generarBorradoresLiquidacionFianza: GenerarBorradoresLiquidacionFianzaPort;
  clock: ClockPort;
}

/** Resultado de la confirmación (para la respuesta HTTP). */
export interface ConfirmarPagoSenalResultado {
  reservaId: string;
  estado: 'reserva_confirmada';
  importeSenal: string;
  importeLiquidacion: string;
  documento: DocumentoCreado;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español (con propiedad `codigo`)
// ---------------------------------------------------------------------------

/** La RESERVA no está en `pre_reserva` (guarda de origen). Mapea a 422. */
export class OrigenInvalidoError extends Error {
  readonly codigo = 'ORIGEN_INVALIDO' as const;

  constructor(mensaje = 'La reserva no está en estado pre_reserva') {
    super(mensaje);
    this.name = 'OrigenInvalidoError';
  }
}

/** No se adjuntó el fichero justificante. Mapea a 422. */
export class JustificanteRequeridoError extends Error {
  readonly codigo = 'JUSTIFICANTE_REQUERIDO' as const;

  constructor(mensaje = 'Es obligatorio adjuntar el justificante de pago') {
    super(mensaje);
    this.name = 'JustificanteRequeridoError';
  }
}

/** El `mimeType` del justificante no está permitido (no jpeg/png/pdf). Mapea a 422. */
export class FormatoNoPermitidoError extends Error {
  readonly codigo = 'FORMATO_NO_PERMITIDO' as const;
  readonly mimeType: string;

  constructor(mimeType: string) {
    super(`Formato de fichero no permitido: ${mimeType}`);
    this.name = 'FormatoNoPermitidoError';
    this.mimeType = mimeType;
  }
}

/** El fichero justificante supera los 10 MB. Mapea a 422. */
export class TamanoExcedidoError extends Error {
  readonly codigo = 'TAMANO_EXCEDIDO' as const;
  readonly tamanoBytes: number;

  constructor(tamanoBytes: number) {
    super('El fichero justificante supera el tamaño máximo de 10 MB');
    this.name = 'TamanoExcedidoError';
    this.tamanoBytes = tamanoBytes;
  }
}

/** El `importe_total` de la RESERVA es 0/null/negativo (sin presupuesto válido). 422. */
export class ImporteTotalInvalidoError extends Error {
  readonly codigo = 'IMPORTE_TOTAL_INVALIDO' as const;

  constructor(
    mensaje = 'El importe total de la reserva no es válido (no hay presupuesto aceptado)',
  ) {
    super(mensaje);
    this.name = 'ImporteTotalInvalidoError';
  }
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant es invisible → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/**
 * Doble clic / dos sesiones sobre la MISMA reserva: al adquirir el lock la segunda
 * transacción observa la RESERVA ya en `reserva_confirmada`. Mapea a 409.
 */
export class ReservaYaConfirmadaError extends Error {
  readonly codigo = 'RESERVA_YA_CONFIRMADA' as const;
  readonly motivo: string;

  constructor(motivo = 'La reserva ya ha sido confirmada') {
    super(motivo);
    this.name = 'ReservaYaConfirmadaError';
    this.motivo = motivo;
  }
}

/**
 * La `(tenant, fecha)` ya está en bloqueo firme de OTRA reserva (`P2002` del UNIQUE):
 * carrera D4. Mapea a 409. */
export class FechaNoDisponibleError extends Error {
  readonly codigo = 'FECHA_NO_DISPONIBLE' as const;
  readonly motivo: string;

  constructor(motivo = 'Fecha no disponible') {
    super(motivo);
    this.name = 'FechaNoDisponibleError';
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// Constantes y helpers puros
// ---------------------------------------------------------------------------

/** Tamaño máximo del justificante: 10 MB (inclusive). */
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

/** Formatos permitidos del justificante (validación autoritativa en servidor). */
const MIMES_PERMITIDOS: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

/**
 * Congela los importes de la señal (§D-3): `importe_senal = round(total × pct/100, 2)`
 * y `importe_liquidacion = total − importe_senal` (complemento por resta, garantiza
 * `senal + liquidacion = total` EXACTO sin desajuste de céntimos). Trabaja en céntimos
 * enteros para evitar el error de coma flotante y devuelve strings con 2 decimales.
 */
const congelarImportes = (
  importeTotal: string,
  pctSenal: number,
): { importeSenal: string; importeLiquidacion: string } => {
  const totalCentimos = Math.round(Number(importeTotal) * 100);
  const senalCentimos = Math.round((totalCentimos * pctSenal) / 100);
  const liquidacionCentimos = totalCentimos - senalCentimos;
  const aEuros = (centimos: number): string => (centimos / 100).toFixed(2);
  return {
    importeSenal: aEuros(senalCentimos),
    importeLiquidacion: aEuros(liquidacionCentimos),
  };
};

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ConfirmarPagoSenalUseCase {
  constructor(private readonly deps: ConfirmarPagoSenalDeps) {}

  /**
   * Confirma el pago de la señal: crea el DOCUMENTO, promueve el bloqueo a firme,
   * transiciona la RESERVA a `reserva_confirmada` (importes + sub-procesos), crea la
   * FICHA_OPERATIVA idempotente y audita — todo en UNA transacción. Tras el commit
   * presenta la factura de señal en borrador (post-commit, no revierte).
   */
  async ejecutar(
    comando: ConfirmarPagoSenalComando,
  ): Promise<ConfirmarPagoSenalResultado> {
    // (0) Guardas SÍNCRONAS previas a la tx (rechazo SIN efectos). Orden: justificante
    // presente → existencia → origen → importe → formato/tamaño.
    const justificante = this.validarJustificantePresente(comando.justificante);

    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }
    if (!esOrigenValidoParaConfirmarSenal(reserva.estado, reserva.subEstado)) {
      throw new OrigenInvalidoError();
    }
    const importeTotal = this.validarImporteTotal(reserva.importeTotal);
    this.validarFormatoYTamano(justificante);

    const settings = await this.obtenerSettings(comando.tenantId);
    const { importeSenal, importeLiquidacion } = congelarImportes(
      importeTotal,
      settings.pctSenal,
    );

    // (1) Subida física del fichero (fuera de la tx crítica; §D-5).
    const url = await this.deps.almacenarJustificante({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      justificante,
    });

    // (2) Transacción única (all-or-nothing). Cualquier rechazo propaga (rollback).
    const documento = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<DocumentoCreado> => {
        // (a) DOCUMENTO justificante_pago.
        const doc = await repos.documentos.crearJustificante({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
          tipo: 'justificante_pago',
          nombreArchivo: justificante.nombreArchivo,
          url,
          mimeType: justificante.mimeType,
          tamanoBytes: justificante.tamanoBytes,
        });

        // (b) Upgrade del bloqueo blando→firme (SELECT … FOR UPDATE + UNIQUE). El
        //     adaptador re-verifica la guarda de origen bajo el lock: doble clic →
        //     RESERVA_YA_CONFIRMADA; fecha firme de otra reserva (P2002) →
        //     FECHA_NO_DISPONIBLE.
        if (reserva.fechaEvento !== null) {
          await repos.fechaBloqueada.upgradeAFirme({
            tenantId: comando.tenantId,
            fecha: reserva.fechaEvento,
            reservaId: comando.reservaId,
          });
        }

        // (c) Transición RESERVA → reserva_confirmada (ttl NULL, importes, sub-procesos).
        await repos.reservas.confirmarSenal({
          idReserva: comando.reservaId,
          estado: 'reserva_confirmada',
          ttlExpiracion: null,
          importeSenal,
          importeLiquidacion,
          preEventoStatus: 'pendiente',
          liquidacionStatus: 'pendiente',
          fianzaStatus: 'pendiente',
        });

        // (d) FICHA_OPERATIVA vacía IDEMPOTENTE (si existe, no duplica).
        const fichaExistente = await repos.fichaOperativa.buscarPorReserva({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (fichaExistente === null) {
          // Siembra de `notasOperativas` con los comentarios del alta (mejoras-detalle-
          // consulta): recortados; en blanco/ausentes → null. Solo al CREAR la ficha
          // (idempotente: si ya existía, no se re-siembra ni se pisa).
          const comentariosTrim = (reserva.comentarios ?? '').trim();
          const notasOperativas = comentariosTrim.length > 0 ? comentariosTrim : null;
          await repos.fichaOperativa.crearVacia({
            reservaId: comando.reservaId,
            fichaCerrada: false,
            notasOperativas,
          });
        }

        // (e) AUDIT_LOG: transición pre_reserva → reserva_confirmada.
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          usuarioId: comando.usuarioId,
          entidad: 'RESERVA',
          entidadId: comando.reservaId,
          accion: 'transicion',
          datosAnteriores: { estado: 'pre_reserva' },
          datosNuevos: { estado: 'reserva_confirmada' },
        });

        return doc;
      },
    )) as DocumentoCreado;

    // Post-commit (FUERA de la tx crítica): presenta la factura de señal en borrador
    // (US-022) y genera los borradores de liquidación y fianza (US-027). Son efectos
    // INDEPENDIENTES; un fallo en cualquiera NO revierte la confirmación ya comprometida.
    await this.presentarFacturaPostCommit(comando);
    await this.generarBorradoresPostCommit(comando);

    return {
      reservaId: comando.reservaId,
      estado: 'reserva_confirmada',
      importeSenal,
      importeLiquidacion,
      documento,
    };
  }

  // -------------------------------------------------------------------------
  // Pasos privados
  // -------------------------------------------------------------------------

  /** Valida que se adjuntó el fichero; lo devuelve tipado si está presente. */
  private validarJustificantePresente(
    justificante: JustificanteSubido | null,
  ): JustificanteSubido {
    if (justificante === null || justificante === undefined) {
      throw new JustificanteRequeridoError();
    }
    return justificante;
  }

  /** Valida el formato (mime permitido) y el tamaño (≤ 10 MB) del justificante. */
  private validarFormatoYTamano(justificante: JustificanteSubido): void {
    if (!MIMES_PERMITIDOS.includes(justificante.mimeType)) {
      throw new FormatoNoPermitidoError(justificante.mimeType);
    }
    if (justificante.tamanoBytes > TAMANO_MAXIMO_BYTES) {
      throw new TamanoExcedidoError(justificante.tamanoBytes);
    }
  }

  /** Valida que `importe_total > 0`; devuelve el string validado. */
  private validarImporteTotal(importeTotal: string | null): string {
    if (importeTotal === null || Number(importeTotal) <= 0) {
      throw new ImporteTotalInvalidoError();
    }
    return importeTotal;
  }

  /** Lee los settings del tenant (nunca hardcodeados). */
  private async obtenerSettings(
    tenantId: string,
  ): Promise<TenantSettingsConfirmacion> {
    const settings = await this.deps.tenantSettings.obtener(tenantId);
    if (settings === null) {
      throw new Error(`No hay TENANT_SETTINGS configurado para el tenant ${tenantId}`);
    }
    return settings;
  }

  /** Presenta la factura de señal en borrador post-commit. Un fallo se traga. */
  private async presentarFacturaPostCommit(
    comando: ConfirmarPagoSenalComando,
  ): Promise<void> {
    try {
      await this.deps.presentarFacturaSenalBorrador({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
      });
    } catch {
      // El disparo de US-022 es POST-commit: su fallo no revierte la confirmación.
    }
  }

  /**
   * Genera los borradores de liquidación y fianza post-commit (US-027). Un fallo se traga: es
   * un efecto posterior al commit, reintentable por idempotencia; no revierte la confirmación.
   */
  private async generarBorradoresPostCommit(
    comando: ConfirmarPagoSenalComando,
  ): Promise<void> {
    try {
      await this.deps.generarBorradoresLiquidacionFianza({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
      });
    } catch {
      // El disparo de US-027 es POST-commit: su fallo no revierte la confirmación.
    }
  }
}
