import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { safeSend } from '../common/safe-send';
import { MessagingPort } from '../messaging/messaging.port';
import { Order, OrderStatus } from './order.entity';
import { PaymentProof, ProofDecision } from './payment-proof.entity';

export type DecideOrderResultado =
  | { error: 'no_encontrada' }
  | { error: 'estado_invalido' }
  | { decidida: true; order: Order; proof: PaymentProof | null };

/**
 * Una sola decisión, después del pago, que cubre orden y comprobante.
 * Función pura reutilizable (sin acoplarse a HTTP): la usa `PanelController`.
 */
@Injectable()
export class OrderDecisionService {
  private readonly logger = new Logger(OrderDecisionService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(PaymentProof) private readonly paymentProofs: Repository<PaymentProof>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly messaging: MessagingPort,
  ) {}

  async decideOrder(orderId: string, merchantId: string, approved: boolean): Promise<DecideOrderResultado> {
    const order = await this.orders.findOne({ where: { id: orderId, merchantId } });
    if (!order) return { error: 'no_encontrada' };
    if (order.status !== OrderStatus.PAGO_EN_REVISION) return { error: 'estado_invalido' };

    const newOrderStatus = approved ? OrderStatus.APROBADA : OrderStatus.RECHAZADA;
    const newProofDecision = approved ? ProofDecision.APROBADO : ProofDecision.RECHAZADO;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Order, { id: order.id }, { status: newOrderStatus });

      const lastProof = await manager.findOne(PaymentProof, {
        where: { orderId: order.id },
        order: { createdAt: 'DESC' },
      });
      if (lastProof) {
        await manager.update(PaymentProof, { id: lastProof.id }, { decision: newProofDecision, decidedAt: new Date() });
      }
    });

    const message = approved
      ? 'Tu pago fue aprobado. ¡Gracias por tu compra! Ya estamos preparando tu pedido. 🎉'
      : 'No pudimos validar tu comprobante de pago. Por favor, contactanos para resolverlo.';

    await safeSend(() => this.messaging.sendText(merchantId, order.buyerPhone, message), this.logger, `decideOrder ${order.id}`);

    const updatedOrder = await this.orders.findOneOrFail({ where: { id: order.id }, relations: { items: true } });
    const updatedProof = await this.paymentProofs.findOne({ where: { orderId: order.id }, order: { createdAt: 'DESC' } });

    return { decidida: true, order: updatedOrder, proof: updatedProof };
  }
}
