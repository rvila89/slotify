/**
 * Bootstrap de la API NestJS de Slotify.
 *
 * - Prefijo global `/api`.
 * - CORS restringido al origen de la SPA (`WEB_URL`).
 * - `ValidationPipe` global (whitelist + transform).
 * - `HttpExceptionFilter` global (formato de error estándar + P2002 -> 409).
 * - Swagger en `/api/docs` (UI) y `/api/docs-json` (JSON OpenAPI).
 */
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: config.get<string>('WEB_URL') ?? 'http://localhost:5173',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Slotify API')
    .setDescription('API de gestión de reservas de espacios para eventos')
    .setVersion('0.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // UI en /api/docs y JSON en /api/docs-json (jsonDocumentUrl).
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });

  const puerto = config.get<number>('API_PORT') ?? 3000;
  await app.listen(puerto);
};

void bootstrap();
