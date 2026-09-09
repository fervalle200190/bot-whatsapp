import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../config/env.validation';

export interface AskInput {
  merchantId: string;
  contactPhone: string;
  text: string;
  systemPrompt: string;
}

/** Delega la conversación de venta al workflow de n8n: `mensaje → respuesta`. */
@Injectable()
export class N8nAgentService {
  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  async ask(input: AskInput): Promise<string> {
    const base = this.config.get('N8N_WEBHOOK_BASE_URL', { infer: true });
    const secret = this.config.get('N8N_WEBHOOK_SECRET', { infer: true });

    const res = await fetch(`${base}/agente-vendedor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-N8N-Secret': secret },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      throw new Error(`n8n respondió ${res.status} para merchantId=${input.merchantId}`);
    }

    const data = (await res.json()) as { reply: string };
    return data.reply;
  }
}
