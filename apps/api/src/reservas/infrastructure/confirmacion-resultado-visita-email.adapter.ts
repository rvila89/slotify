/**
 * Adaptador del puerto `EnviarConfirmacionResultadoVisitaPort` (US-009 / §D-4) — email
 * E7 (confirmación de bloqueo post-visita, plazo para decidir).
 *
 * Dispara E7 POST-COMMIT REUTILIZANDO el motor real de US-045
 * (`DespacharEmailService.despachar`): NO se reinventa el envío ni el registro en
 * `COMUNICACION`. El motor crea la fila `COMUNICACION` (`codigo_email='E7'`), envía por
 * el transporte (fake en test/CI) y la promueve a `enviado`/`fallido`, trazando el
 * resultado en `AUDIT_LOG`. La idempotencia ante doble disparo la garantiza el UNIQUE
 * parcial `(reserva_id, codigo_email)` del propio motor.
 *
 * Tolerancia a fallo: el motor centraliza el try/catch del proveedor y NO propaga la
 * excepción; si aun así fallara la carga de datos, el use-case envuelve la llamada en un
 * try/catch tolerante (post-commit, la transición ya está comprometida).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type {
  EnviarConfirmacionResultadoVisitaParams,
  EnviarConfirmacionResultadoVisitaPort,
  EnviarConfirmacionResultadoVisitaResultado,
} from '../application/registrar-resultado-visita.use-case';

@Injectable()
export class ConfirmacionResultadoVisitaEmailAdapter
  implements EnviarConfirmacionResultadoVisitaPort
{
  constructor(
    private readonly motorEmail: DespacharEmailService,
    private readonly prisma: PrismaService,
  ) {}

  async enviar(
    params: EnviarConfirmacionResultadoVisitaParams,
  ): Promise<EnviarConfirmacionResultadoVisitaResultado> {
    // Carga los datos mínimos de RESERVA + CLIENTE para el render del motor, bajo el
    // contexto RLS del tenant (multi-tenancy: cross-tenant invisible).
    const datos = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const reserva = await tx.reserva.findFirst({
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
      return reserva;
    });

    if (datos === null) {
      return { estado: 'fallido', fechaEnvio: null };
    }

    const resultado = await this.motorEmail.despachar({
      tenantId: params.tenantId,
      codigoEmail: params.codigoEmail,
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
    const estado = com?.estado === 'enviado' ? 'enviado' : 'fallido';
    return { estado, fechaEnvio: com?.fechaEnvio ?? null };
  }
}
