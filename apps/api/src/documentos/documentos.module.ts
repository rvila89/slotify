/**
 * Módulo documentos (épico #6, rebanada 6.1a, hexagonal). Enlaza los puertos a
 * sus adaptadores por token (Symbol):
 *
 * - `ALMACEN_DOCUMENTOS_PORT` → adaptador seleccionado por env
 *   `ALMACEN_PROVIDER` (decisión B1: solo `local` implementado ahora; `s3` se
 *   añadirá como adaptador hermano cuando haya credenciales/bucket).
 * - `CONFIGURACION_DOCUMENTO_REPOSITORY_PORT` → adaptador Prisma de lectura.
 *
 * Provee `ObtenerConfiguracionDocumentoService` (dominio de aplicación puro) vía
 * factory, inyectando su puerto de repositorio. Sin endpoint HTTP en 6.1a.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../shared/prisma/prisma.module';
import type { AlmacenDocumentosPort } from './domain/almacen-documentos.port';
import type { ConfiguracionDocumentoRepositoryPort } from './domain/configuracion-documento.repository.port';
import { AlmacenDocumentosLocalAdapter } from './infrastructure/almacen-documentos-local.adapter';
import { ConfiguracionDocumentoPrismaAdapter } from './infrastructure/configuracion-documento.prisma.adapter';
import { ObtenerConfiguracionDocumentoService } from './application/obtener-configuracion-documento.service';
import {
  ALMACEN_DOCUMENTOS_PORT,
  CONFIGURACION_DOCUMENTO_REPOSITORY_PORT,
} from './documentos.tokens';

/**
 * Selecciona el adaptador de almacén por env. Decisión B1: en 6.1a solo hay
 * `local`; `s3` no está implementado todavía y falla explícito si se pide.
 */
const crearAlmacenDocumentos = (config: ConfigService): AlmacenDocumentosPort => {
  const proveedor = config.get<string>('ALMACEN_PROVIDER', 'local');
  if (proveedor === 'local') {
    const baseUrl = config.get<string>(
      'ALMACEN_LOCAL_BASE_URL',
      'http://localhost:3000/almacen',
    );
    return new AlmacenDocumentosLocalAdapter(baseUrl);
  }
  throw new Error(
    `ALMACEN_PROVIDER="${proveedor}" no está implementado en 6.1a (solo "local").`,
  );
};

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: ALMACEN_DOCUMENTOS_PORT,
      inject: [ConfigService],
      useFactory: crearAlmacenDocumentos,
    },
    {
      provide: CONFIGURACION_DOCUMENTO_REPOSITORY_PORT,
      useClass: ConfiguracionDocumentoPrismaAdapter,
    },
    {
      provide: ObtenerConfiguracionDocumentoService,
      inject: [CONFIGURACION_DOCUMENTO_REPOSITORY_PORT],
      useFactory: (repo: ConfiguracionDocumentoRepositoryPort) =>
        new ObtenerConfiguracionDocumentoService(repo),
    },
  ],
  exports: [
    ALMACEN_DOCUMENTOS_PORT,
    CONFIGURACION_DOCUMENTO_REPOSITORY_PORT,
    ObtenerConfiguracionDocumentoService,
  ],
})
export class DocumentosModule {}
