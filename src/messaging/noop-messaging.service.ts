import { Injectable, Logger } from '@nestjs/common';
import { MessagingPort } from './messaging.port';

/** Implementación de este spec: loguea y no envía nada. El SPEC 03 la reemplaza por Meta. */
@Injectable()
export class NoopMessagingService implements MessagingPort {
  private readonly logger = new Logger(NoopMessagingService.name);

  async sendText(merchantId: string, to: string, text: string): Promise<void> {
    this.logger.log(`[noop] sendText merchantId=${merchantId} to=${to} text=${text}`);
  }

  async sendLocationRequest(merchantId: string, to: string, text: string): Promise<void> {
    this.logger.log(`[noop] sendLocationRequest merchantId=${merchantId} to=${to} text=${text}`);
  }
}
