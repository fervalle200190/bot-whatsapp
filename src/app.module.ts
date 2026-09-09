import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MerchantsModule } from './merchants/merchants.module';
import { CatalogModule } from './catalog/catalog.module';
import { OrdersModule } from './orders/orders.module';
import { MessagingModule } from './messaging/messaging.module';
import { ToolsModule } from './tools/tools.module';
import { RegistroModule } from './registro/registro.module';
import { WebhooksModule } from './meta/webhooks.module';
import { PanelModule } from './panel/panel.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    HealthModule,
    MerchantsModule,
    CatalogModule,
    OrdersModule,
    MessagingModule,
    ToolsModule,
    RegistroModule,
    WebhooksModule,
    PanelModule,
  ],
})
export class AppModule {}
