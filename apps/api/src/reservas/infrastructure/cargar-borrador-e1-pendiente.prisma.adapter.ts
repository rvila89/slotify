/**
 * Adaptador de LECTURA del borrador E1 pendiente de una RESERVA
 * (change `consulta-fecha-borrador-fix`, design.md §D-3).
 *
 * INFRAESTRUCTURA: devuelve la referencia (`idComunicacion`) de la `COMUNICACION` con
 * `codigo_email='E1'` y `estado='borrador'` de la RESERVA, bajo el contexto RLS del tenant
 * del JWT (`app.tenant_id` fijado en la transacción de lectura): una fila de otro tenant es
 * INVISIBLE (→ `null`). Si el E1 ya está `enviado`/`fallido` o no existe → `null` (no hay
 * borrador que regenerar). Lectura previa/posterior a la escritura; no muta nada.
 */
import { Injectable } from '@nestjs/common';
import {
  CodigoEmail as CodigoEmailPrisma,
  EstadoComunicacion as EstadoComunicacionPrisma,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  BorradorE1Pendiente,
  CargarBorradorE1PendienteParams,
  CargarBorradorE1PendientePort,
} from '../application/actualizar-reserva.use-case';

@Injectable()
export class CargarBorradorE1PendientePrismaAdapter
  implements CargarBorradorE1PendientePort
{
  constructor(private readonly prisma: PrismaService) {}

  async cargarBorradorE1Pendiente(
    params: CargarBorradorE1PendienteParams,
  ): Promise<BorradorE1Pendiente | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const fila = await tx.comunicacion.findFirst({
        where: {
          reservaId: params.reservaId,
          tenantId: params.tenantId,
          codigoEmail: 'E1' as CodigoEmailPrisma,
          estado: 'borrador' as EstadoComunicacionPrisma,
        },
        select: { idComunicacion: true },
      });
      if (fila === null) {
        return null;
      }
      return { idComunicacion: fila.idComunicacion };
    });
  }
}
