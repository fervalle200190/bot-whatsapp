import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Merchant } from '../merchants/merchant.entity';
import { MetaMessagingService } from './meta-messaging.service';

@Module({
  imports: [TypeOrmModule.forFeature([Merchant])],
  providers: [MetaMessagingService],
  exports: [MetaMessagingService],
})
export class MetaMessagingModule {}
