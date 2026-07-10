/**
 * Adaptador del puerto `DispararE8Port` (US-035 / UC-26 FA-01, UC-27, §D-2/§D-3A) — email E8
 * (confirmación de recepción del IBAN + próximos pasos para la devolución de la fianza).
 *
 * Dispara E8 POST-COMMIT REUTILIZANDO el motor real de US-045
 * (`DespacharEmailService.despacharReenvio`): NO reinventa el envío ni el registro en
 * `COMUNICACION`. El motor selecciona la plantilla, envía por el transporte (fake en test/CI)
 * y promueve la fila a `enviado`/`fallido`, trazando el resultado en `AUDIT_LOG`.
 *
 * EXCEPCIÓN A LA IDEMPOTENCIA (D-3A): a diferencia de E5 (que se envía a lo sumo una vez y se
 * protege con el índice UNIQUE parcial), cada registro/CORRECCIÓN del IBAN debe reenviar E8.
 * Por eso se invoca `despacharReenvio`, que crea SIEMPRE una fila COMUNICACION NUEVA marcada
 * `es_reenvio = true` (fuera del índice `(reserva_id, codigo_email) WHERE es_reenvio = false`),
 * como excepción explícita y AUDITADA a la idempotencia (simétrica al reenvío de E4/US-028).
 * La excepción vive AQUÍ (adaptador) + en el motor, NO en el caso de uso.
 *
 * Tolerancia a fallo (D-2/FA-03): el motor centraliza el try/catch del proveedor y NO propaga
 * la excepción; un fallo deja `COMUNICACION.estado='fallido'` SIN revertir el IBAN ya guardado.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type {
  DispararE8Port,
  ResultadoDispararE8,
} from '../application/registrar-iban-devolucion.use-case';

@Injectable()
export class DispararE8Adapter implements DispararE8Port {
  constructor(
    private readonly motorEmail: DespacharEmailService,
    private readonly prisma: PrismaService,
  ) {}

  async disparar(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
  }): Promise<ResultadoDispararE8> {
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

    // Reenvío explícito (D-3A): crea una nueva COMUNICACION E8 saltándose la idempotencia.
    const resultado = await this.motorEmail.despacharReenvio({
      tenantId: params.tenantId,
      codigoEmail: 'E8',
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
      // El motor no llegó a crear COMUNICACION (p. ej. variable/plantilla nula): sin fila que
      // trazar; se reporta como fallido (el IBAN se mantiene guardado, FA-03).
      return { resultado: 'fallido', comunicacionId: null };
    }
    return {
      resultado: com.estado === 'enviado' ? 'enviado' : 'fallido',
      comunicacionId: com.idComunicacion,
    };
  }
}
