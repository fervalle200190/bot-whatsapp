import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantsModule } from '../merchants/merchants.module';
import { OrdersModule } from '../orders/orders.module';
import { MetaMessagingModule } from '../meta/meta-messaging.module';
import { Order } from '../orders/order.entity';
import { PaymentProof } from '../orders/payment-proof.entity';
import { PanelController } from './panel.controller';
import { PanelTokenGuard } from './panel-token.guard';
import { PanelTokenService } from './panel-token.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, PaymentProof]), MerchantsModule, OrdersModule, MetaMessagingModule],
  controllers: [PanelController],
  providers: [PanelTokenGuard, PanelTokenService],
})
export class PanelModule {}
