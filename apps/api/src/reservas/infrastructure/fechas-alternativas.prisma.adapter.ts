/**
 * Adapter de `FechasAlternativasPort` (Caso 3 de E1): comprueba disponibilidad en
 * las fechas adyacentes (±1 día) si son sábado o domingo.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { FechasAlternativas, FechasAlternativasPort } from '../application/alta-consulta.use-case';

const esFindeSemana = (fecha: Date): boolean => {
  const dia = fecha.getDay();
  return dia === 0 || dia === 6; // 0=domingo, 6=sábado
};

const addDias = (fecha: Date, dias: number): Date => {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d;
};

@Injectable()
export class FechasAlternativasPrismaAdapter implements FechasAlternativasPort {
  constructor(private readonly prisma: PrismaService) {}

  async leerAlternativas(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<FechasAlternativas> {
    const anterior = addDias(params.fecha, -1);
    const posterior = addDias(params.fecha, 1);

    const candidatas: Array<{ fecha: Date; key: 'anterior' | 'posterior' }> = [
      ...(esFindeSemana(anterior) ? [{ fecha: anterior, key: 'anterior' as const }] : []),
      ...(esFindeSemana(posterior) ? [{ fecha: posterior, key: 'posterior' as const }] : []),
    ];

    const resultado: FechasAlternativas = { anterior: null, posterior: null };
    for (const candidata of candidatas) {
      const bloqueada = await this.prisma.fechaBloqueada.findFirst({
        where: { tenantId: params.tenantId, fecha: candidata.fecha },
        select: { idBloqueo: true },
      });
      if (bloqueada === null) {
        resultado[candidata.key] = candidata.fecha;
      }
    }
    return resultado;
  }
}
