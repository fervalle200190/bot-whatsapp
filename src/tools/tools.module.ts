import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersModule } from '../orders/orders.module';
import { ToolsController } from './tools.controller';
import { ToolsSecretGuard } from './tools-secret.guard';

@Module({
  imports: [CatalogModule, OrdersModule],
  controllers: [ToolsController],
  providers: [ToolsSecretGuard],
})
export class ToolsModule {}
