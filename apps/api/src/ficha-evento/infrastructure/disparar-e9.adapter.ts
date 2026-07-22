/**
 * Adaptador del puerto `DispararE9Port` (change `reserva-viva-edicion-recalculo-ficha` §D-6):
 * dispara el email E9 «modificación de reserva» POST-COMMIT reutilizando el motor de email
 * US-045 (`DespacharEmailService`).
 *
 * Es un efecto POST-COMMIT: su fallo NO revierte el recálculo ya comprometido (la
 * COMUNICACION queda en `fallido` reintentable, patrón existente). Carga la RESERVA + CLIENTE
 * scoped por tenant (RLS) para construir el comando de despacho; sin cliente/email el motor
 * degrada a `variable_nula` sin excepción.
 *
 * TODO: adjuntar PDF del presupuesto de modificación (épico PDF §6.x). El MVP envía el E9 SIN
 * adjunto (la plantilla E9 declara `adjuntosRequeridos: []`); cuando exista el generador de PDF
 * de modificación (react-pdf), pasar `adjuntos: [{ clave: 'presupuesto', pdfUrl }]` a
 * `motor.despachar(...)` y restaurar `adjuntosRequeridos: ['presupuesto']` en el catálogo.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type { DispararE9Port } from '../application/recalcular-reserva-viva.use-case';

@Injectable()
export class DispararE9Adapter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly motor: DespacharEmailService,
  ) {}

  /** Implementa `DispararE9Port` (función invocable). */
  readonly disparar: DispararE9Port = async ({
    tenantId,
    reservaId,
    idioma,
    cambio,
    liquidacionRestante,
  }) => {
    const reserva = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: reservaId, tenantId },
        include: { cliente: true },
      });
    });
    if (reserva === null) {
      return;
    }
    await this.motor.despachar({
      tenantId,
      codigoEmail: 'E9',
      idioma,
      reserva: { idReserva: reserva.idReserva, codigo: reserva.codigo },
      cliente: {
        idCliente: reserva.cliente.idCliente,
        nombre: reserva.cliente.nombre,
        apellidos: reserva.cliente.apellidos ?? '',
        email: reserva.cliente.email,
        telefono: reserva.cliente.telefono ?? '',
      },
      // Variables adicionales para el render de E9 (propagadas al catálogo).
      variablesExtra: { cambio, liquidacionRestante },
    });
  };
}
