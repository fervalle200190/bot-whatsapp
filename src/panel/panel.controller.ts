import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Response } from 'express';
import { Merchant } from '../merchants/merchant.entity';
import { MerchantsService } from '../merchants/merchants.service';
import { Order, OrderStatus } from '../orders/order.entity';
import { PaymentProof } from '../orders/payment-proof.entity';
import { OrderDecisionService } from '../orders/order-decision.service';
import { MetaMessagingService } from '../meta/meta-messaging.service';
import { PanelTokenGuard } from './panel-token.guard';
import { PanelTokenService } from './panel-token.service';
import { CurrentMerchant } from './current-merchant.decorator';
import { serializeOrder } from './order.serializer';
import { ActualizarTasaDto } from './dto/actualizar-tasa.dto';
import { ActualizarCobroDto } from './dto/actualizar-cobro.dto';
import { OrdenesQueryDto } from './dto/ordenes-query.dto';

const ESTADOS_VISIBLES = [OrderStatus.PAGO_EN_REVISION, OrderStatus.APROBADA, OrderStatus.RECHAZADA];

@ApiTags('panel')
@ApiBearerAuth('panel-token')
@UseGuards(PanelTokenGuard)
@Controller('api')
export class PanelController {
  constructor(
    private readonly merchants: MerchantsService,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(PaymentProof) private readonly paymentProofs: Repository<PaymentProof>,
    private readonly panelTokens: PanelTokenService,
    private readonly decision: OrderDecisionService,
    private readonly metaMessaging: MetaMessagingService,
  ) {}

  @Get('me')
  me(@CurrentMerchant() merchant: Merchant) {
    return {
      id: merchant.id,
      name: merchant.name,
      metaDisplayPhone: merchant.metaDisplayPhone,
      vesRate: merchant.vesRate,
      payoutInstructions: merchant.payoutInstructions,
    };
  }

  @Get('ordenes')
  async ordenes(@CurrentMerchant() merchant: Merchant, @Query() query: OrdenesQueryDto) {
    return this.listarOrdenes(merchant.id, query.desde);
  }

  private async listarOrdenes(merchantId: string, desde?: string) {
    const orders = await this.orders
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .where('order.merchantId = :merchantId', { merchantId })
      .andWhere('order.status IN (:...estados)', { estados: ESTADOS_VISIBLES })
      .andWhere(desde ? 'order.updatedAt > :desde' : '1=1', desde ? { desde: new Date(desde) } : {})
      .orderBy('order.updatedAt', 'DESC')
      .getMany();

    const ordenes = await Promise.all(
      orders.map(async (order) => {
        const lastProof = await this.paymentProofs.findOne({
          where: { orderId: order.id },
          order: { createdAt: 'DESC' },
        });
        return serializeOrder(order, lastProof);
      }),
    );

    return { ordenes, ahora: new Date().toISOString() };
  }

  @Get('ordenes/:id/comprobante')
  async comprobante(@CurrentMerchant() merchant: Merchant, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const order = await this.orders.findOne({ where: { id, merchantId: merchant.id } });
    if (!order) throw new NotFoundException();

    const lastProof = await this.paymentProofs.findOne({ where: { orderId: order.id }, order: { createdAt: 'DESC' } });
    if (!lastProof) throw new NotFoundException();

    const media = await this.metaMessaging.downloadMedia(lastProof.mediaId);
    res.set('Content-Type', media.contentType).send(media.buffer);
  }

  @Post('ordenes/:id/aceptar')
  async aceptar(@CurrentMerchant() merchant: Merchant, @Param('id') id: string) {
    return this.decidir(merchant.id, id, true);
  }

  @Post('ordenes/:id/rechazar')
  async rechazar(@CurrentMerchant() merchant: Merchant, @Param('id') id: string) {
    return this.decidir(merchant.id, id, false);
  }

  private async decidir(merchantId: string, orderId: string, approved: boolean) {
    const result = await this.decision.decideOrder(orderId, merchantId, approved);

    if ('error' in result) {
      if (result.error === 'no_encontrada') throw new NotFoundException();
      throw new ConflictException();
    }

    return { orden: serializeOrder(result.order, result.proof) };
  }

  @Put('tasa')
  async tasa(@CurrentMerchant() merchant: Merchant, @Body() body: ActualizarTasaDto) {
    await this.merchants.actualizarTasa(merchant.id, body.tasaBsPorUsd);
    return { vesRate: body.tasaBsPorUsd };
  }

  @Put('cobro')
  async cobro(@CurrentMerchant() merchant: Merchant, @Body() body: ActualizarCobroDto) {
    await this.merchants.actualizarCobro(merchant.id, body.datosCobro);
    return { payoutInstructions: body.datosCobro };
  }

  @Post('token/regenerar')
  async regenerarToken(@CurrentMerchant() merchant: Merchant) {
    const panelToken = this.panelTokens.generate();
    await this.merchants.regenerarPanelToken(merchant.id, panelToken);
    return { panelToken };
  }
}
