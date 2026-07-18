/**
 * Adaptador de LECTURA de una `COMUNICACION` para la acción manual del Gestor
 * (US-046 / UC-36; enviar/descartar borrador).
 *
 * INFRAESTRUCTURA: carga la proyección `ComunicacionContexto` (id, estado, asunto,
 * cuerpo, código, destinatario heredado del cliente) bajo el contexto RLS del tenant del
 * JWT (`app.tenant_id` fijado en la transacción de lectura): una `COMUNICACION` de otro
 * tenant es INVISIBLE (→ `null` → 404). Filtra además por `reservaId` (sub-recurso de la
 * ficha). Lectura previa a la acción; no muta nada.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { CodigoEmail, EstadoComunicacion } from '../domain/codigo-email';
import type {
  CargarComunicacionParams,
  CargarComunicacionPort,
  ComunicacionContexto,
} from '../application/enviar-borrador.use-case';

@Injectable()
export class CargarComunicacionPrismaAdapter implements CargarComunicacionPort {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    params: CargarComunicacionParams,
  ): Promise<ComunicacionContexto | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const fila = await tx.comunicacion.findFirst({
        where: {
          idComunicacion: params.idComunicacion,
          reservaId: params.reservaId,
          tenantId: params.tenantId,
        },
        select: {
          idComunicacion: true,
          tenantId: true,
          reservaId: true,
          clienteId: true,
          codigoEmail: true,
          estado: true,
          asunto: true,
          cuerpo: true,
          destinatarioEmail: true,
          fechaEnvio: true,
          // Idioma de la RESERVA vinculada (US-047 D-2): determina el dossier E1 a
          // adjuntar al enviar el borrador (`Dossier-Masia-Encis-{idioma}.pdf`).
          reserva: { select: { idioma: true } },
        },
      });
      if (fila === null || fila.reservaId === null) {
        return null;
      }
      return {
        idComunicacion: fila.idComunicacion,
        tenantId: fila.tenantId,
        reservaId: fila.reservaId,
        clienteId: fila.clienteId,
        codigoEmail: fila.codigoEmail as CodigoEmail,
        estado: fila.estado as EstadoComunicacion,
        asunto: fila.asunto,
        cuerpo: fila.cuerpo ?? '',
        destinatarioEmail: fila.destinatarioEmail,
        fechaEnvio: fila.fechaEnvio,
        idioma: fila.reserva?.idioma ?? null,
      };
    });
  }
}
