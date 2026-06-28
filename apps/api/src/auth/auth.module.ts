/**
 * Módulo `auth` (US-001, hexagonal). Registra la estrategia JWT (Passport) y el
 * módulo JWT, enlaza los PUERTOS de la capability (repositorio de usuarios, hasher
 * argon2, emisor de tokens, auditoría compartida) a sus adaptadores por token
 * (Symbol) y compone los casos de uso (puros) vía factory inyectando los puertos.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../shared/auth/jwt.strategy';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import type { AuditLogPort } from '../shared/audit/audit-log.port';
import { AuditLogPrismaAdapter } from '../shared/audit/audit-log.prisma.adapter';
import {
  LoginUseCase,
  type PasswordHasherPort,
  type TokenEmitterPort,
  type UsuarioRepositoryPort,
} from './application/login.use-case';
import { RefreshUseCase } from './application/refresh.use-case';
import { LogoutUseCase } from './application/logout.use-case';
import { ObtenerUsuarioActualUseCase } from './application/obtener-usuario-actual.use-case';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.adapter';
import { JwtTokenEmitter } from './infrastructure/jwt-token-emitter.adapter';
import { UsuarioPrismaAdapter } from './infrastructure/usuario.prisma.adapter';
import { AuthController } from './interface/auth.controller';
import { LoginThrottleGuard } from './interface/login-throttle.guard';
import {
  AUTH_AUDIT_LOG_PORT,
  LOGIN_USE_CASE,
  LOGOUT_USE_CASE,
  OBTENER_USUARIO_ACTUAL_USE_CASE,
  PASSWORD_HASHER_PORT,
  REFRESH_USE_CASE,
  TOKEN_EMITTER_PORT,
  USUARIO_REPOSITORY_PORT,
} from './auth.tokens';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    LoginThrottleGuard,
    // --- Puertos → adaptadores ---
    {
      provide: USUARIO_REPOSITORY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new UsuarioPrismaAdapter(prisma),
    },
    { provide: PASSWORD_HASHER_PORT, useClass: Argon2PasswordHasher },
    {
      provide: TOKEN_EMITTER_PORT,
      inject: [JwtService, ConfigService],
      useFactory: (jwt: JwtService, config: ConfigService) => new JwtTokenEmitter(jwt, config),
    },
    {
      provide: AUTH_AUDIT_LOG_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new AuditLogPrismaAdapter(prisma),
    },
    // --- Casos de uso (dominio puro) compuestos vía factory ---
    {
      provide: LOGIN_USE_CASE,
      inject: [USUARIO_REPOSITORY_PORT, PASSWORD_HASHER_PORT, TOKEN_EMITTER_PORT, AUTH_AUDIT_LOG_PORT],
      useFactory: (
        usuarios: UsuarioRepositoryPort,
        passwordHasher: PasswordHasherPort,
        tokenEmitter: TokenEmitterPort,
        auditoria: AuditLogPort,
      ) => new LoginUseCase({ usuarios, passwordHasher, tokenEmitter, auditoria }),
    },
    {
      provide: REFRESH_USE_CASE,
      inject: [TOKEN_EMITTER_PORT, USUARIO_REPOSITORY_PORT],
      useFactory: (tokenEmitter: TokenEmitterPort, usuarios: UsuarioRepositoryPort) =>
        new RefreshUseCase({ tokenEmitter, usuarios }),
    },
    {
      provide: LOGOUT_USE_CASE,
      inject: [AUTH_AUDIT_LOG_PORT],
      useFactory: (auditoria: AuditLogPort) => new LogoutUseCase({ auditoria }),
    },
    {
      provide: OBTENER_USUARIO_ACTUAL_USE_CASE,
      inject: [USUARIO_REPOSITORY_PORT],
      useFactory: (usuarios: UsuarioRepositoryPort) =>
        new ObtenerUsuarioActualUseCase({ usuarios }),
    },
  ],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}
