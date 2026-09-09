import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EnvVars } from '../config/env.validation';
import { Merchant } from '../merchants/merchant.entity';
import { MessagingPort } from '../messaging/messaging.port';

export interface DownloadedMedia {
  buffer: Buffer;
  contentType: string;
}

/** Implementación de `MessagingPort` con la Cloud API de Meta (una sola WABA nuestra). */
@Injectable()
export class MetaMessagingService implements MessagingPort {
  private readonly logger = new Logger(MetaMessagingService.name);

  constructor(
    private readonly config: ConfigService<EnvVars, true>,
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
  ) {}

  private graphBase(): string {
    return `https://graph.facebook.com/${this.config.get('META_GRAPH_VERSION', { infer: true })}`;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.get('META_ACCESS_TOKEN', { infer: true })}`,
      'Content-Type': 'application/json',
    };
  }

  private async resolvePhoneNumberId(merchantId: string): Promise<string> {
    const merchant = await this.merchants.findOne({ where: { id: merchantId } });
    if (!merchant?.metaPhoneNumberId) {
      throw new Error(`El comercio ${merchantId} no tiene metaPhoneNumberId configurado`);
    }
    return merchant.metaPhoneNumberId;
  }

  private async postMessage(phoneNumberId: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.graphBase()}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });

    if (!res.ok) {
      this.logger.error(`Meta respondió ${res.status} al enviar un mensaje (phoneNumberId=${phoneNumberId})`);
    }
  }

  async sendText(merchantId: string, to: string, text: string): Promise<void> {
    const phoneNumberId = await this.resolvePhoneNumberId(merchantId);
    await this.postMessage(phoneNumberId, { to, type: 'text', text: { body: text } });
  }

  async sendLocationRequest(merchantId: string, to: string, text: string): Promise<void> {
    const phoneNumberId = await this.resolvePhoneNumberId(merchantId);
    await this.postMessage(phoneNumberId, {
      to,
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text },
        action: { name: 'send_location' },
      },
    });
  }

  /** Resuelve y descarga una media de Meta por su id. Las URLs de Meta expiran: siempre se resuelve al momento. */
  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    const token = this.config.get('META_ACCESS_TOKEN', { infer: true });

    const metaRes = await fetch(`${this.graphBase()}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      throw new Error(`No se pudo resolver la media ${mediaId} (${metaRes.status})`);
    }
    const { url } = (await metaRes.json()) as { url: string };

    const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileRes.ok) {
      throw new Error(`No se pudo descargar la media ${mediaId} (${fileRes.status})`);
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const contentType = fileRes.headers.get('content-type') ?? 'application/octet-stream';
    return { buffer, contentType };
  }
}
