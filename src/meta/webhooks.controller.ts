import { Body, Controller, Get, HttpCode, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import type { EnvVars } from '../config/env.validation';
import { MerchantsService } from '../merchants/merchants.service';
import { VendorInboundService } from '../messaging/vendor-inbound.service';
import { DedupeService } from '../messaging/dedupe.service';
import { MetaSignatureGuard } from './meta-signature.guard';
import { MetaPayloadParser, type ParsedInboundMessage } from './meta-payload.parser';

/** Webhooks internos de Meta: no forman parte del contrato público del panel/n8n. */
@ApiExcludeController()
@Controller('webhooks/meta')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly config: ConfigService<EnvVars, true>,
    private readonly parser: MetaPayloadParser,
    private readonly dedupe: DedupeService,
    private readonly merchants: MerchantsService,
    private readonly vendorInbound: VendorInboundService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const expected = this.config.get('META_VERIFY_TOKEN', { infer: true });
    if (mode === 'subscribe' && token === expected && challenge) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.status(403).send();
  }

  /**
   * `200` inmediato tras verificar la firma (el guard ya corrió); el
   * despacho a `VendorInboundService` sigue en segundo plano. El dedupe se
   * chequea y marca de forma síncrona acá mismo, antes de disparar nada
   * asíncrono, para que dos requests casi simultáneas con el mismo
   * `messageId` no se procesen ambas.
   */
  @Post()
  @UseGuards(MetaSignatureGuard)
  @HttpCode(200)
  receive(@Body() payload: unknown): { received: true } {
    const events = this.parser.parse(payload);

    for (const event of events) {
      for (const message of event.messages) {
        if (!this.dedupe.shouldProcess(message.messageId)) continue;
        // Despacho asíncrono a propósito: no se espera acá para responder 200 ya mismo.
        void this.dispatch(event.phoneNumberId, message);
      }
    }

    return { received: true };
  }

  private async dispatch(phoneNumberId: string, message: ParsedInboundMessage): Promise<void> {
    const merchant = await this.merchants.findByMetaPhoneNumberId(phoneNumberId);
    if (!merchant) return; // phone_number_id desconocido: se ignora

    try {
      await this.vendorInbound.handle(merchant, message);
    } catch (err) {
      this.logger.error(err, `Error procesando mensaje ${message.messageId} de ${phoneNumberId}`);
    }
  }
}
