/**
 * Inyecta el `tenant_id` del usuario autenticado. El tenant SIEMPRE deriva del
 * JWT, nunca del path ni del body (regla de multi-tenancy).
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { UsuarioAutenticado } from '../auth/usuario-autenticado';

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const usuario = request.user as UsuarioAutenticado | undefined;
    return usuario?.tenantId ?? '';
  },
);
