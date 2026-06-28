/**
 * Guard de rate-limiting de `POST /auth/login` (US-001, decisión §3-A).
 *
 * Cuenta los intentos por clave `IP + email` en una ventana deslizante y responde
 * 429 (TooManyRequests) al superar `LOGIN_THROTTLE.limit`. El almacén es en memoria
 * del proceso (sin dependencias externas ni locks distribuidos): suficiente para la
 * defensa anti brute-force del MVP. La frontera (cookie/HTTP) vive en esta capa, no
 * en el dominio.
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { LOGIN_THROTTLE, claveThrottleLogin } from '../auth.throttle';

interface Contador {
  conteo: number;
  expiraEn: number;
}

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly contadores = new Map<string, Contador>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'desconocida';
    const email = (request.body as { email?: string } | undefined)?.email ?? 'anonimo';
    const clave = claveThrottleLogin(ip, email);

    const ahora = Date.now();
    const actual = this.contadores.get(clave);

    if (actual === undefined || actual.expiraEn <= ahora) {
      this.contadores.set(clave, { conteo: 1, expiraEn: ahora + LOGIN_THROTTLE.ttl });
      return true;
    }

    if (actual.conteo >= LOGIN_THROTTLE.limit) {
      throw new HttpException(
        'Demasiados intentos de inicio de sesión. Inténtalo de nuevo más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    actual.conteo += 1;
    return true;
  }
}
