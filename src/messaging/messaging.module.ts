import { Module } from '@nestjs/common';
import { MetaMessagingModule } from '../meta/meta-messaging.module';
import { MetaMessagingService } from '../meta/meta-messaging.service';
import { MessagingPort } from './messaging.port';

/**
 * `NoopMessagingService` del SPEC 02 se reemplaza como implementación de
 * `MessagingPort` por `MetaMessagingService`; queda disponible para tests
 * (se usa directamente vía `useValue` en los tests unitarios).
 */
@Module({
  imports: [MetaMessagingModule],
  providers: [{ provide: MessagingPort, useExisting: MetaMessagingService }],
  exports: [MessagingPort],
})
export class MessagingModule {}
