/**
 * `CronTokenGuard` — autenticación SERVICE-TO-SERVICE del endpoint interno de barrido
 * (US-012 / UC-09, §D-2).
 *
 * Compara la cabecera `X-Cron-Token` de la petición con `CRON_TOKEN` del entorno
 * (`ConfigService`). Es un guard DEDICADO, NO el `JwtAuthGuard`/`RolesGuard` de
 * usuario: el endpoint de cron NO se autentica con JWT (un `Authorization: Bearer …`
 * sin la cabecera de cron NO autoriza). Sin la cabecera, con valor incorrecto o si
 * `CRON_TOKEN` no está configurado → 401 `UnauthorizedException`. El despliegue
 * restringe además el endpoint a la red interna si aplica.
 *
 * La comparación es de valor exacto; se usa `timingSafeEqual` para no filtrar por
 * temporización si los tamaños coinciden (defensa en profundidad, sin coste relevante).
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

const CABECERA_CRON = 'x-cron-token';

/** Comparación en tiempo constante de dos cadenas (evita fugas por temporización). */
const compararSeguro = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
};

@Injectable()
export class CronTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const tokenRecibido = request.headers[CABECERA_CRON];
    const tokenEsperado = this.configService.get<string>('CRON_TOKEN');

    if (
      typeof tokenRecibido !== 'string' ||
      tokenRecibido.length === 0 ||
      typeof tokenEsperado !== 'string' ||
      tokenEsperado.length === 0 ||
      !compararSeguro(tokenRecibido, tokenEsperado)
    ) {
      throw new UnauthorizedException(
        'No autorizado: cabecera X-Cron-Token ausente o inválida',
      );
    }
    return true;
  }
}
