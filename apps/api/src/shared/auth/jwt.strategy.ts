/**
 * Estrategia Passport `jwt`: valida el access token y proyecta el payload a
 * `UsuarioAutenticado`. El `tenant_id` y el `rol` viajan firmados en el token.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsuarioAutenticado } from './usuario-autenticado';

interface JwtPayload {
  sub: string;
  tenantId: string;
  rol: string;
  email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? '',
    });
  }

  validate(payload: JwtPayload): UsuarioAutenticado {
    if (!payload?.sub || !payload?.tenantId) {
      throw new UnauthorizedException('Token sin contexto de usuario o tenant');
    }
    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      rol: payload.rol,
      email: payload.email,
    };
  }
}
