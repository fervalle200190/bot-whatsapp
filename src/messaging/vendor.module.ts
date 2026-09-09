import { Module } from '@nestjs/common';
import { N8nModule } from '../n8n/n8n.module';
import { OrdersModule } from '../orders/orders.module';
import { MessagingModule } from './messaging.module';
import { VendorInboundService } from './vendor-inbound.service';
import { DedupeService } from './dedupe.service';

@Module({
  imports: [N8nModule, MessagingModule, OrdersModule],
  providers: [VendorInboundService, DedupeService],
  exports: [VendorInboundService, DedupeService],
})
export class VendorModule {}
