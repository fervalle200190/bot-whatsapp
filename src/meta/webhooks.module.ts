import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { VendorModule } from '../messaging/vendor.module';
import { WebhooksController } from './webhooks.controller';
import { MetaSignatureGuard } from './meta-signature.guard';
import { MetaPayloadParser } from './meta-payload.parser';

@Module({
  imports: [MerchantsModule, VendorModule],
  controllers: [WebhooksController],
  providers: [MetaSignatureGuard, MetaPayloadParser],
})
export class WebhooksModule {}
