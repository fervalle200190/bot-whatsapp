import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagingModule } from '../messaging/messaging.module';
import { Merchant } from '../merchants/merchant.entity';
import { Order } from './order.entity';
import { OrderItem } from './order-item.entity';
import { PaymentProof } from './payment-proof.entity';
import { CartService } from './cart.service';
import { OrdersService } from './orders.service';
import { OrderDecisionService } from './order-decision.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem, PaymentProof, Merchant]), MessagingModule],
  providers: [CartService, OrdersService, OrderDecisionService],
  exports: [CartService, OrdersService, OrderDecisionService],
})
export class OrdersModule {}
