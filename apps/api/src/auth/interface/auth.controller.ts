/**
 * Controlador HTTP de `auth` (US-001). Traduce HTTP ↔ casos de uso y gestiona la
 * cookie de refresh, que es responsabilidad de la CAPA DE FRAMEWORK (nunca del
 * dominio): se setea en `login` y se limpia en `logout` y ante un refresh inválido.
 *
 * - `POST /auth/login` (público, con throttling IP+email): emite access en el body
 *   y refresh en cookie `httpOnly + Secure + SameSite`.
 * - `POST /auth/refresh` (público; se autentica por la cookie de refresh): renueva
 *   el access; si el refresh es inválido/expirado → 401 + limpia la cookie.
 * - `POST /auth/logout` (autenticado): 204 + limpia la cookie de refresh.
 * - `GET /auth/me` (autenticado): resuelve el USUARIO REAL (deja de ser stub).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Public } from '../../shared/auth/public.decorator';
import { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  CredencialesInvalidasError,
  LoginUseCase,
  type UsuarioPublico,
} from '../application/login.use-case';
import { RefreshInvalidoError, RefreshUseCase } from '../application/refresh.use-case';
import { LogoutUseCase } from '../application/logout.use-case';
import { ObtenerUsuarioActualUseCase } from '../application/obtener-usuario-actual.use-case';
import {
  LOGIN_USE_CASE,
  LOGOUT_USE_CASE,
  OBTENER_USUARIO_ACTUAL_USE_CASE,
  REFRESH_USE_CASE,
} from '../auth.tokens';
import { LoginDto } from './login.dto';
import { LoginThrottleGuard } from './login-throttle.guard';

/** Nombre de la cookie httpOnly que transporta el refresh token. */
const COOKIE_REFRESH = 'refresh_token';

/** ~7 días en milisegundos para el `maxAge` de la cookie de refresh. */
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const esProduccion = (): boolean => process.env.NODE_ENV === 'production';

/**
 * Reconoce el error de DOMINIO de refresh inválido/expirado para traducirlo a 401.
 * Acepta tanto la instancia real (`instanceof`) como un `Error` cuyo `name` sea
 * `RefreshInvalidoError` (caso de los dobles de test que no extienden la clase),
 * y NUNCA un fallo de infraestructura genérico (`Error` con `name === 'Error'`),
 * que debe propagarse a 500 sin tocar la cookie.
 */
const esRefreshInvalido = (error: unknown): boolean =>
  error instanceof RefreshInvalidoError ||
  (error instanceof Error && error.name === 'RefreshInvalidoError');

/** Opciones base de la cookie de refresh (sin `maxAge`), compartidas set/clear. */
const opcionesBaseCookie = (): CookieOptions => ({
  httpOnly: true,
  secure: esProduccion(),
  sameSite: esProduccion() ? 'none' : 'lax',
  path: '/api/auth',
});

const opcionesCookieRefresh = (): CookieOptions => ({
  ...opcionesBaseCookie(),
  maxAge: REFRESH_MAX_AGE_MS,
});

/** Lee el refresh token de la cookie, con o sin `cookie-parser` (parsea el header). */
const leerCookieRefresh = (req: Request): string | undefined => {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[COOKIE_REFRESH] === 'string') {
    return cookies[COOKIE_REFRESH];
  }
  const header = req.headers?.cookie;
  if (typeof header !== 'string') {
    return undefined;
  }
  const par = header
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE_REFRESH}=`));
  return par === undefined ? undefined : decodeURIComponent(par.slice(COOKIE_REFRESH.length + 1));
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(LOGIN_USE_CASE) private readonly loginUseCase: LoginUseCase,
    @Inject(REFRESH_USE_CASE) private readonly refreshUseCase: RefreshUseCase,
    @Inject(LOGOUT_USE_CASE) private readonly logoutUseCase: LogoutUseCase,
    @Inject(OBTENER_USUARIO_ACTUAL_USE_CASE)
    private readonly obtenerUsuarioActualUseCase: ObtenerUsuarioActualUseCase,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoginThrottleGuard)
  @ApiOperation({ summary: 'Inicia sesión y emite tokens (access en body, refresh en cookie)' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; usuario: UsuarioPublico }> {
    try {
      const { accessToken, refreshToken, usuario } = await this.loginUseCase.ejecutar({
        email: dto.email,
        password: dto.password,
      });
      res.cookie(COOKIE_REFRESH, refreshToken, opcionesCookieRefresh());
      return { accessToken, usuario };
    } catch (error) {
      // Solo los fallos de DOMINIO se traducen a 401. Anti-enumeration (OWASP A01):
      // credenciales inválidas Y cuenta inactiva comparten un 401 idéntico (mismo
      // status y cuerpo genérico) porque el caso de uso lanza el MISMO
      // `CredencialesInvalidasError`, sin revelar si la cuenta existe o está
      // deshabilitada. Cualquier OTRO error (p. ej. BD caída) se re-lanza para que
      // el filtro global lo mapee a 500, en vez de enmascararlo como credenciales.
      if (error instanceof CredencialesInvalidasError) {
        throw new UnauthorizedException('Credenciales incorrectas');
      }
      throw error;
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renueva el access token a partir de la cookie de refresh' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; usuario: UsuarioPublico }> {
    const refreshToken = leerCookieRefresh(req) ?? '';
    try {
      return await this.refreshUseCase.ejecutar({ refreshToken });
    } catch (error) {
      // Solo un refresh inválido/expirado (error de DOMINIO) cierra la sesión: se
      // limpia la cookie y se devuelve 401. El caso de cuenta inexistente/inactiva
      // ya viene plegado en `RefreshInvalidoError` por el propio caso de uso, así
      // que aquí basta con ese instanceof. Cualquier OTRO error (p. ej. BD caída)
      // se re-lanza tal cual —sin limpiar la cookie— para que el filtro global lo
      // mapee a 500, en vez de enmascararlo como sesión expirada.
      if (esRefreshInvalido(error)) {
        res.clearCookie(COOKIE_REFRESH, opcionesBaseCookie());
        throw new UnauthorizedException('Sesión expirada o inválida');
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cierra la sesión y limpia la cookie de refresh' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const usuario = (req as Request & { user?: UsuarioAutenticado }).user;
    if (usuario?.sub && usuario?.tenantId) {
      await this.logoutUseCase.ejecutar({
        tenantId: usuario.tenantId,
        idUsuario: usuario.sub,
      });
    }
    res.clearCookie(COOKIE_REFRESH, opcionesBaseCookie());
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Devuelve los datos del usuario autenticado (usuario real)' })
  async me(@CurrentUser() usuario: UsuarioAutenticado): Promise<UsuarioPublico> {
    return this.obtenerUsuarioActualUseCase.ejecutar({
      idUsuario: usuario.sub,
      tenantId: usuario.tenantId,
    });
  }
}
