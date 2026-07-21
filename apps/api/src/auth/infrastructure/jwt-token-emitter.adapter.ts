/**
 * Adaptador del `TokenEmitterPort` con `@nestjs/jwt` (US-001).
 *
 * - Access token: firmado con `JWT_ACCESS_SECRET` y expiración corta
 *   (`JWT_ACCESS_EXPIRES_IN`, ~5 min); su payload firmado transporta
 *   `{sub, tenantId, rol, email}` (aislamiento multi-tenant desde el token).
 * - Refresh token: firmado con `JWT_REFRESH_SECRET` (secreto distinto) y expiración
 *   larga (`JWT_REFRESH_EXPIRES_IN`, ~7 días); viaja en cookie httpOnly.
 *
 * STATELESS: la verificación del refresh no consulta estado en BD; un refresh
 * caducado/alterado hace fallar `verifyAsync` y el caso de uso cierra la sesión.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload, TokenEmitterPort } from '../application/login.use-case';

@Injectable()
export class JwtTokenEmitter implements TokenEmitterPort {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async emitirAccessToken(payload: AccessTokenPayload): Promise<string> {
    // Usa el secreto/expiración por defecto registrados en `JwtModule` (access).
    return this.jwt.signAsync({ ...payload });
  }

  async emitirRefreshToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(
      { ...payload },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
      },
    );
  }

  async verificarRefreshToken(token: string): Promise<AccessTokenPayload> {
    const payload = await this.jwt.verifyAsync<{
      sub: string;
      tenantId: string;
      rol: string;
      email: string;
    }>(token, { secret: this.config.get<string>('JWT_REFRESH_SECRET') });
    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      rol: payload.rol,
      email: payload.email,
    };
  }
}
