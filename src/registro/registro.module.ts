import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { RegistroController } from './registro.controller';

@Module({
  imports: [MerchantsModule],
  controllers: [RegistroController],
})
export class RegistroModule {}
