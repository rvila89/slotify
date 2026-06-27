/**
 * Adaptador de infraestructura: cliente Prisma como servicio inyectable.
 *
 * Vive en `shared/` porque lo consumen todos los módulos. Expone un helper para
 * fijar el contexto de RLS (`SET LOCAL app.tenant_id`) dentro de una transacción,
 * de modo que las políticas Row-Level Security de PostgreSQL filtren por tenant.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Fija el `tenant_id` del contexto RLS para la transacción dada. Debe llamarse
   * con el cliente transaccional (`tx`) dentro de un `$transaction`, ya que el
   * ámbito LOCAL solo aplica a la transacción en curso. Usa
   * `set_config(..., true)` (equivalente a `SET LOCAL`) con binding
   * parametrizado vía `$executeRaw`, sin interpolar ni escapar el valor a mano.
   */
  async fijarTenant(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  }
}
