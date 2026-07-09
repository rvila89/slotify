/**
 * Adaptador del puerto `DispararE5Port` (US-034 / UC-25, §D-2) — email E5 (agradecimiento +
 * solicitud de IBAN para la devolución de fianza + enlace NPS).
 *
 * Dispara E5 POST-COMMIT REUTILIZANDO el motor real de US-045
 * (`DespacharEmailService.despachar`): NO reinventa el envío ni el registro en
 * `COMUNICACION`. El motor crea la fila `COMUNICACION` (`codigo_email='E5'`), envía por el
 * transporte (fake en test/CI) y la promueve a `enviado`/`fallido`, trazando el resultado en
 * `AUDIT_LOG`. La idempotencia ante doble disparo la garantiza el UNIQUE parcial
 * `(reserva_id, codigo_email)` del propio motor (D-8: E5 a lo sumo una vez).
 *
 * Tolerancia a fallo (D-2): el motor centraliza el try/catch del proveedor y NO propaga la
 * excepción; un fallo del proveedor deja `COMUNICACION.estado='fallido'` SIN revertir la
 * transición ya commiteada. El use-case, además, envuelve la llamada en un try/catch
 * tolerante por si fallara la carga de datos (post-commit, la transición ya está comprometida).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type {
  DispararE5Port,
  ResultadoDispararE5,
} from '../application/finalizar-evento.use-case';

@Injectable()
export class DispararE5Adapter implements DispararE5Port {
  constructor(
    private readonly motorEmail: DespacharEmailService,
    private readonly prisma: PrismaService,
  ) {}

  async disparar(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
  }): Promise<ResultadoDispararE5> {
    // Carga los datos mínimos de RESERVA + CLIENTE para el render del motor, bajo el
    // contexto RLS del tenant (multi-tenancy: cross-tenant invisible).
    const datos = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          codigo: true,
          cliente: {
            select: {
              idCliente: true,
              nombre: true,
              apellidos: true,
              email: true,
              telefono: true,
            },
          },
        },
      });
    });

    if (datos === null) {
      return { resultado: 'fallido', comunicacionId: null };
    }

    const resultado = await this.motorEmail.despachar({
      tenantId: params.tenantId,
      codigoEmail: 'E5',
      reserva: { idReserva: datos.idReserva, codigo: datos.codigo },
      cliente: {
        idCliente: datos.cliente.idCliente,
        nombre: datos.cliente.nombre,
        apellidos: datos.cliente.apellidos ?? '',
        email: datos.cliente.email,
        telefono: datos.cliente.telefono ?? '',
      },
    });

    const com = resultado.comunicacion;
    if (com === null) {
      // El motor no llegó a crear COMUNICACION (p. ej. variable/plantilla): sin fila que
      // trazar; se reporta como fallido (la transición se mantiene).
      return { resultado: 'fallido', comunicacionId: null };
    }
    return {
      resultado: com.estado === 'enviado' ? 'enviado' : 'fallido',
      comunicacionId: com.idComunicacion,
    };
  }
}
