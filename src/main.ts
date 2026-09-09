import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import type { EnvVars } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
    // Necesario para `MetaSignatureGuard`: verifica `X-Hub-Signature-256`
    // contra el body crudo, antes de que nada lo parsee.
    rawBody: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = app.get(ConfigService<EnvVars, true>);

  // CORS restringido al origen exacto del SPA del panel (repo separado).
  app.enableCors({ origin: config.get('PANEL_ORIGIN', { infer: true }) });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Backend WhatsApp multi-tenant')
    .setDescription(
      'Tools de venta para el agente vendedor, registro de comercios, salud del servicio y API del panel del comercio.',
    )
    .setVersion('0.4.0')
    .addApiKey({ type: 'apiKey', name: 'X-Tools-Secret', in: 'header' }, 'tools-secret')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'panelToken del comercio' }, 'panel-token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Servidor escuchando en el puerto ${port}`);
}

bootstrap();
