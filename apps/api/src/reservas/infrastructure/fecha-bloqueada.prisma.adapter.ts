/**
 * Adaptador Prisma del puerto `FechaBloqueadaRepositoryPort` (US-040 / UC-30).
 *
 * Implementa la transacción atómica del bloqueo de fecha (design.md §D-1):
 * dentro de un `$transaction`, fija el contexto RLS (`SET LOCAL app.tenant_id`),
 * serializa la fila objetivo con `SELECT … FOR UPDATE` (vía `$queryRaw`, ya que
 * Prisma no expone `FOR UPDATE` en su API de alto nivel) y aplica el
 * insert/extend/upgrade según el plan. La garantía última de no-doble-reserva es
 * el `UNIQUE(tenant_id, fecha)` del motor: un `INSERT` que choca recibe `P2002`,
 * traducido a `FechaYaBloqueadaError` (§D-4).
 *
 * REGLA CRÍTICA: el bloqueo es EXCLUSIVAMENTE de base de datos (guardrail
 * atomic-date-lock); la exclusión mutua vive solo en el motor PostgreSQL.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, TipoBloqueo } from '@prisma/client';
import {
  ExtensionSobreBloqueoFirmeError,
  FechaBloqueadaRepositoryPort,
  FechaBloqueadaResultado,
  FechaYaBloqueadaError,
  PlanBloqueo,
  ReservaYaTieneBloqueoError,
  TipoBloqueoDominio,
} from '../domain/bloquear-fecha.service';
import {
  BloqueoActual,
  FechaBloqueadaLiberacionPort,
  ResultadoLiberacionFila,
} from '../domain/liberar-fecha.service';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Cliente Prisma o cualquier extensión suya (p. ej. `PrismaService`). */
type ClientePrisma = Pick<PrismaClient, '$transaction'>;

/** Fila bloqueada con `SELECT … FOR UPDATE` (columnas snake_case crudas). */
interface FilaBloqueada {
  id_bloqueo: string;
  reserva_id: string;
  tipo_bloqueo: TipoBloqueoDominio;
  ttl_expiracion: Date | null;
}

@Injectable()
export class FechaBloqueadaPrismaAdapter
  implements FechaBloqueadaRepositoryPort, FechaBloqueadaLiberacionPort
{
  constructor(private readonly prisma: ClientePrisma) {}

  /**
   * Lee el bloqueo vigente de `(tenant_id, fecha)` para resolver la guarda firme
   * (US-041 §D-5). Lectura pura dentro de su propia transacción con contexto RLS;
   * `null` si no hay bloqueo.
   */
  async consultarBloqueo(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<BloqueoActual | null> {
    const { tenantId, fecha } = params;
    const fechaIso = this.formatearFecha(fecha);
    return this.prisma.$transaction(async (tx) => {
      await this.fijarTenant(tx, tenantId);
      const filas = await tx.$queryRaw<FilaBloqueada[]>(Prisma.sql`
        SELECT id_bloqueo, reserva_id, tipo_bloqueo, ttl_expiracion
        FROM fecha_bloqueada
        WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
      `);
      if (filas.length === 0) {
        return null;
      }
      return {
        reservaId: filas[0].reserva_id,
        tipoBloqueo: filas[0].tipo_bloqueo as TipoBloqueoDominio,
      };
    });
  }

  /**
   * Liberación atómica de `(tenant_id, fecha)` (US-041 §D-1, §D-4). Dentro de un
   * `$transaction`: fija el contexto RLS, serializa la fila con `SELECT … FOR
   * UPDATE` (capturando `reserva_id`/`tipo_bloqueo` antes de borrarla) y ejecuta el
   * `DELETE` devolviendo rows-affected como primitiva. Ante dos liberaciones
   * concurrentes, el motor serializa: una obtiene 1 fila, la otra 0 (idempotencia).
   * El bloqueo es EXCLUSIVAMENTE de base de datos (guardrail atomic-date-lock).
   */
  async liberar(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<ResultadoLiberacionFila> {
    const { tenantId, fecha } = params;
    const fechaIso = this.formatearFecha(fecha);
    return this.prisma.$transaction(async (tx) => {
      await this.fijarTenant(tx, tenantId);
      const filas = await tx.$queryRaw<FilaBloqueada[]>(Prisma.sql`
        SELECT id_bloqueo, reserva_id, tipo_bloqueo, ttl_expiracion
        FROM fecha_bloqueada
        WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
        FOR UPDATE
      `);
      const fila = filas.length > 0 ? filas[0] : null;
      const filasAfectadas = await tx.$executeRaw(Prisma.sql`
        DELETE FROM fecha_bloqueada
        WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
      `);
      const eliminada = filasAfectadas > 0 && fila !== null;
      return {
        filasAfectadas,
        reservaIdLiberada: eliminada ? fila.reserva_id : null,
        tipoBloqueo: eliminada ? (fila.tipo_bloqueo as TipoBloqueoDominio) : null,
      };
    });
  }

  /**
   * Operación de bloqueo de US-040 (contrato público, sin cambios): abre SU PROPIA
   * `$transaction` con contexto RLS, delega el núcleo atómico en `bloquearEnTx` y
   * traduce el `P2002` a los errores de dominio (`FechaYaBloqueadaError` /
   * `ReservaYaTieneBloqueoError`). El comportamiento observable de US-040 es
   * idéntico al de antes de extraer `bloquearEnTx` (regresión cero).
   */
  async bloquear(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    plan: PlanBloqueo;
  }): Promise<FechaBloqueadaResultado> {
    const { tenantId, fecha, reservaId, plan } = params;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.fijarTenant(tx, tenantId);
        return this.bloquearEnTx(tx, { tenantId, fecha, reservaId, plan });
      });
    } catch (error) {
      throw this.traducirError(error, tenantId, fecha, reservaId);
    }
  }

  /**
   * NÚCLEO atómico del bloqueo, ejecutado DENTRO de una transacción ya abierta y con
   * el contexto RLS ya fijado (US-004 §D-2). Serializa la fila objetivo con `SELECT
   * … FOR UPDATE` y aplica el insert/extend/upgrade del plan. NO traduce el `P2002`:
   * deja propagar el error crudo para que la unidad de trabajo del alta lo reconozca
   * como colisión reintentable (UNIQUE `(tenant_id, fecha)`) y re-derive a `2.d`. La
   * traducción a errores de dominio la hace el wrapper público `bloquear()`.
   */
  async bloquearEnTx(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      fecha: Date;
      reservaId: string;
      plan: PlanBloqueo;
    },
  ): Promise<FechaBloqueadaResultado> {
    const { tenantId, fecha, reservaId, plan } = params;

    // Serializa la fila objetivo (puede no existir todavía). Si dos
    // transacciones pasan el SELECT, el INSERT lo resuelve el UNIQUE.
    const existente = await this.seleccionarParaActualizar(tx, tenantId, fecha);

    switch (plan.modo) {
      case 'insert':
        return this.insertar(tx, tenantId, fecha, reservaId, plan);
      case 'upgrade':
        return this.aplicarUpgrade(tx, tenantId, fecha, reservaId, existente);
      case 'extend':
        return this.aplicarExtension(tx, tenantId, fecha, reservaId, plan, existente);
      default:
        throw new Error(`Modo de bloqueo no soportado: ${String(plan.modo)}`);
    }
  }

  /**
   * Fija el `tenant_id` del contexto RLS para la transacción. Usa
   * `set_config(..., true)` (equivalente a `SET LOCAL`, ámbito transaccional)
   * con binding parametrizado vía `$executeRaw`, evitando interpolar/escapar el
   * valor a mano.
   */
  private async fijarTenant(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  }

  /** `SELECT … FOR UPDATE` de la fila `(tenant_id, fecha)`; null si no existe. */
  private async seleccionarParaActualizar(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fecha: Date,
  ): Promise<FilaBloqueada | null> {
    const fechaIso = this.formatearFecha(fecha);
    const filas = await tx.$queryRaw<FilaBloqueada[]>(Prisma.sql`
      SELECT id_bloqueo, reserva_id, tipo_bloqueo, ttl_expiracion
      FROM fecha_bloqueada
      WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
      FOR UPDATE
    `);
    return filas.length > 0 ? filas[0] : null;
  }

  /** Crea una nueva fila de bloqueo (modo insert). El UNIQUE rechaza colisiones. */
  private async insertar(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fecha: Date,
    reservaId: string,
    plan: PlanBloqueo,
  ): Promise<FechaBloqueadaResultado> {
    const fila = await tx.fechaBloqueada.create({
      data: {
        tenantId,
        fecha,
        reservaId,
        tipoBloqueo: this.aTipoPrisma(plan.tipo),
        ttlExpiracion: plan.ttl,
      },
    });
    return this.aResultado(fila);
  }

  /**
   * Promueve el bloqueo a firme (modo upgrade). UPDATE de la fila existente de la
   * MISMA reserva (nunca DELETE+INSERT). Sin fila previa → INSERT firme. Fila de
   * OTRA reserva → rechazo (`FechaYaBloqueadaError`).
   */
  private async aplicarUpgrade(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fecha: Date,
    reservaId: string,
    existente: FilaBloqueada | null,
  ): Promise<FechaBloqueadaResultado> {
    if (existente === null) {
      const fila = await tx.fechaBloqueada.create({
        data: {
          tenantId,
          fecha,
          reservaId,
          tipoBloqueo: TipoBloqueo.firme,
          ttlExpiracion: null,
        },
      });
      return this.aResultado(fila);
    }
    if (existente.reserva_id !== reservaId) {
      throw new FechaYaBloqueadaError(tenantId, fecha, existente.reserva_id);
    }
    const fila = await tx.fechaBloqueada.update({
      where: { idBloqueo: existente.id_bloqueo },
      data: { tipoBloqueo: TipoBloqueo.firme, ttlExpiracion: null },
    });
    return this.aResultado(fila);
  }

  /**
   * Extiende el TTL del bloqueo blando existente (modo extend) sin cambiar el
   * tipo: `ttl = ttl_actual + ttlDeltaDias`. Fila de OTRA reserva → rechazo.
   */
  private async aplicarExtension(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fecha: Date,
    reservaId: string,
    plan: PlanBloqueo,
    existente: FilaBloqueada | null,
  ): Promise<FechaBloqueadaResultado> {
    const deltaDias = plan.ttlDeltaDias ?? 0;
    if (existente !== null && existente.reserva_id !== reservaId) {
      throw new FechaYaBloqueadaError(tenantId, fecha, existente.reserva_id);
    }
    // Guard de defensa en profundidad: extender una fila ya `firme` la
    // degradaría a `blando` con TTL finito (`ttl_expiracion` null → now()+delta).
    // La máquina de estados no admite ese degradado; se rechaza explícitamente.
    if (existente !== null && existente.tipo_bloqueo === 'firme') {
      throw new ExtensionSobreBloqueoFirmeError(tenantId, fecha, existente.reserva_id);
    }
    const ttlBase = existente?.ttl_expiracion ?? new Date();
    const nuevaTtl = new Date(ttlBase.getTime() + deltaDias * DIA_MS);

    if (existente === null) {
      const fila = await tx.fechaBloqueada.create({
        data: {
          tenantId,
          fecha,
          reservaId,
          tipoBloqueo: TipoBloqueo.blando,
          ttlExpiracion: nuevaTtl,
        },
      });
      return this.aResultado(fila);
    }
    const fila = await tx.fechaBloqueada.update({
      where: { idBloqueo: existente.id_bloqueo },
      data: { tipoBloqueo: TipoBloqueo.blando, ttlExpiracion: nuevaTtl },
    });
    return this.aResultado(fila);
  }

  /**
   * Traduce el `P2002` de Prisma discriminando por `meta.target`:
   *   - colisión del UNIQUE `(tenant_id, fecha)` → `FechaYaBloqueadaError`.
   *   - colisión del UNIQUE `reserva_id` → `ReservaYaTieneBloqueoError`
   *     (la reserva ya bloquea otra fecha; NO es "fecha ya bloqueada").
   *   - cualquier otro `P2002` o error → se propaga sin traducir (no engañar).
   */
  private traducirError(
    error: unknown,
    tenantId: string,
    fecha: Date,
    reservaId: string,
  ): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const objetivo = this.objetivoP2002(error);
      // `reserva_id` primero: el nombre del índice `(tenant_id, fecha)` también
      // contiene "fecha", pero solo el de la reserva contiene "reserva_id".
      if (objetivo.includes('reserva_id')) {
        return new ReservaYaTieneBloqueoError(tenantId, reservaId);
      }
      if (objetivo.includes('fecha') || objetivo.includes('tenant_id')) {
        return new FechaYaBloqueadaError(tenantId, fecha, null);
      }
    }
    return error;
  }

  /** Normaliza `error.meta.target` (string o string[]) a texto en minúsculas. */
  private objetivoP2002(error: Prisma.PrismaClientKnownRequestError): string {
    const target = error.meta?.target;
    const texto = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return texto.toLowerCase();
  }

  private aTipoPrisma(tipo: TipoBloqueoDominio): TipoBloqueo {
    return tipo === 'firme' ? TipoBloqueo.firme : TipoBloqueo.blando;
  }

  private formatearFecha(fecha: Date): string {
    return fecha.toISOString().slice(0, 10);
  }

  private aResultado(fila: {
    idBloqueo: string;
    tenantId: string;
    fecha: Date;
    reservaId: string;
    tipoBloqueo: TipoBloqueo;
    ttlExpiracion: Date | null;
  }): FechaBloqueadaResultado {
    return {
      idBloqueo: fila.idBloqueo,
      tenantId: fila.tenantId,
      fecha: fila.fecha,
      reservaId: fila.reservaId,
      tipoBloqueo: fila.tipoBloqueo as TipoBloqueoDominio,
      ttlExpiracion: fila.ttlExpiracion,
    };
  }
}
