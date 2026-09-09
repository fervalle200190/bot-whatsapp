import { Injectable } from '@nestjs/common';

export type InboundMessageType = 'text' | 'image' | 'location' | 'unknown';

export interface ParsedInboundMessage {
  messageId: string;
  from: string;
  type: InboundMessageType;
  text?: string;
  mediaId?: string;
  latitude?: number;
  longitude?: number;
}

export interface ParsedWebhookEvent {
  phoneNumberId: string;
  messages: ParsedInboundMessage[];
}

/** Traduce `entry[].changes[].value` del payload de Meta a un formato propio. Ignora `statuses`. */
@Injectable()
export class MetaPayloadParser {
  parse(payload: unknown): ParsedWebhookEvent[] {
    const events: ParsedWebhookEvent[] = [];
    const entries = isRecord(payload) ? payload['entry'] : undefined;
    if (!Array.isArray(entries)) return events;

    for (const entry of entries) {
      const changes = isRecord(entry) ? entry['changes'] : undefined;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        const value = isRecord(change) ? change['value'] : undefined;
        if (!isRecord(value)) continue;

        const metadata = value['metadata'];
        const phoneNumberId = isRecord(metadata) ? metadata['phone_number_id'] : undefined;
        const rawMessages = value['messages'];

        // Sin `messages` (p. ej. solo `statuses` de entrega/lectura): se ignora.
        if (typeof phoneNumberId !== 'string' || !Array.isArray(rawMessages)) continue;

        const messages = rawMessages.map((raw) => this.parseMessage(raw)).filter((m): m is ParsedInboundMessage => m !== null);

        if (messages.length > 0) {
          events.push({ phoneNumberId, messages });
        }
      }
    }

    return events;
  }

  private parseMessage(raw: unknown): ParsedInboundMessage | null {
    if (!isRecord(raw)) return null;

    const messageId = raw['id'];
    const from = raw['from'];
    const type = raw['type'];
    if (typeof messageId !== 'string' || typeof from !== 'string' || typeof type !== 'string') return null;

    if (type === 'text') {
      const text = isRecord(raw['text']) ? raw['text']['body'] : undefined;
      return { messageId, from, type: 'text', text: typeof text === 'string' ? text : undefined };
    }

    if (type === 'image') {
      const mediaId = isRecord(raw['image']) ? raw['image']['id'] : undefined;
      return { messageId, from, type: 'image', mediaId: typeof mediaId === 'string' ? mediaId : undefined };
    }

    if (type === 'location') {
      const location = raw['location'];
      const latitude = isRecord(location) ? location['latitude'] : undefined;
      const longitude = isRecord(location) ? location['longitude'] : undefined;
      return {
        messageId,
        from,
        type: 'location',
        latitude: typeof latitude === 'number' ? latitude : undefined,
        longitude: typeof longitude === 'number' ? longitude : undefined,
      };
    }

    return { messageId, from, type: 'unknown' };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
