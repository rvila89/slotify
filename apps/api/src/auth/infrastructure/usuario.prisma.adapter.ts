/**
 * Adaptador Prisma del `UsuarioRepositoryPort` (US-001).
 *
 * `buscarPorEmail` resuelve el login (pre-autenticación, sin tenant todavía): el
 * email es único globalmente. `buscarPorId` resuelve `/auth/me` ya autenticado y
 * FILTRA por `tenant_id` (derivado del token, nunca del path/body) fijando el
 * contexto RLS dentro de la transacción, de modo que un usuario solo pueda
 * resolverse dentro de su propio tenant.
 */
import { Injectable } from '@nestjs/common';
import type { Usuario } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  Rol,
  UsuarioAutenticable,
  UsuarioRepositoryPort,
} from '../application/login.use-case';

const aUsuarioAutenticable = (usuario: Usuario): UsuarioAutenticable => ({
  idUsuario: usuario.idUsuario,
  tenantId: usuario.tenantId,
  email: usuario.email,
  passwordHash: usuario.passwordHash,
  nombre: usuario.nombre,
  apellidos: usuario.apellidos,
  rol: usuario.rol as Rol,
  activo: usuario.activo,
});

@Injectable()
export class UsuarioPrismaAdapter implements UsuarioRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorEmail(email: string): Promise<UsuarioAutenticable | null> {
    const usuario = await this.prisma.usuario.findUnique({ where: { email } });
    return usuario === null ? null : aUsuarioAutenticable(usuario);
  }

  async buscarPorId(idUsuario: string, tenantId?: string): Promise<UsuarioAutenticable | null> {
    const usuario = await this.prisma.$transaction(async (tx) => {
      if (tenantId !== undefined) {
        await this.prisma.fijarTenant(tx, tenantId);
      }
      return tx.usuario.findFirst({
        where: { idUsuario, ...(tenantId !== undefined ? { tenantId } : {}) },
      });
    });
    return usuario === null ? null : aUsuarioAutenticable(usuario);
  }
}
