/** Inyecta el `UsuarioAutenticado` (payload del JWT) en el handler. */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { UsuarioAutenticado } from '../auth/usuario-autenticado';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioAutenticado => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as UsuarioAutenticado;
  },
);
