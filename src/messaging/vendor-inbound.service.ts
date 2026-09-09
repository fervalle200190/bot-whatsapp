import { Injectable, Logger } from '@nestjs/common';
import type { ParsedInboundMessage } from '../meta/meta-payload.parser';
import type { Merchant } from '../merchants/merchant.entity';
import { OrdersService } from '../orders/orders.service';
import { N8nAgentService } from '../n8n/n8n-agent.service';
import { MessagingPort } from './messaging.port';
import { buildVendorSystemPrompt } from './prompts';

/**
 * Resuelve el mensaje entrante del comprador: texto → n8n → respuesta;
 * ubicación → orden BORRADOR con DELIVERY; imagen con orden ESPERANDO_PAGO
 * → comprobante + acuse. Nadie más recibe aviso.
 */
@Injectable()
export class VendorInboundService {
  private readonly logger = new Logger(VendorInboundService.name);

  constructor(
    private readonly n8n: N8nAgentService,
    private readonly messaging: MessagingPort,
    private readonly orders: OrdersService,
  ) {}

  async handle(merchant: Merchant, message: ParsedInboundMessage): Promise<void> {
    switch (message.type) {
      case 'text':
        await this.handleText(merchant, message);
        return;
      case 'location':
        await this.handleLocation(merchant, message);
        return;
      case 'image':
        await this.handleImage(merchant, message);
        return;
      default:
        this.logger.warn(`Tipo de mensaje no manejado: ${message.type} (merchantId=${merchant.id})`);
    }
  }

  private async handleText(merchant: Merchant, message: ParsedInboundMessage): Promise<void> {
    if (!message.text) return;

    const reply = await this.n8n.ask({
      merchantId: merchant.id,
      contactPhone: message.from,
      text: message.text,
      systemPrompt: buildVendorSystemPrompt(merchant),
    });

    await this.messaging.sendText(merchant.id, message.from, reply);
  }

  private async handleLocation(merchant: Merchant, message: ParsedInboundMessage): Promise<void> {
    if (message.latitude === undefined || message.longitude === undefined) return;
    await this.orders.guardarUbicacion(merchant.id, message.from, message.latitude, message.longitude);
  }

  private async handleImage(merchant: Merchant, message: ParsedInboundMessage): Promise<void> {
    if (!message.mediaId) return;

    const result = await this.orders.registrarComprobante(merchant.id, message.from, message.mediaId, message.messageId);
    if ('registrado' in result) {
      await this.messaging.sendText(
        merchant.id,
        message.from,
        'Recibimos tu comprobante, en breve lo revisamos. ¡Gracias! 🙌',
      );
    }
  }
}
