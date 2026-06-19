/**
 * Guard de autorización por rol. Lee los roles requeridos de `@Roles()` y los
 * compara con el rol del usuario autenticado. 403 si no coincide.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import { UsuarioAutenticado } from './usuario-autenticado';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rolesRequeridos = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!rolesRequeridos || rolesRequeridos.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const usuario = request.user as UsuarioAutenticado | undefined;
    if (!usuario || !rolesRequeridos.includes(usuario.rol)) {
      throw new ForbiddenException('No tiene permisos para esta acción');
    }
    return true;
  }
}
