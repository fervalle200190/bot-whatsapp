import { describe, expect, it, mock } from 'bun:test';
import { VendorInboundService } from '../../src/messaging/vendor-inbound.service';
import type { N8nAgentService } from '../../src/n8n/n8n-agent.service';
import type { MessagingPort } from '../../src/messaging/messaging.port';
import type { OrdersService } from '../../src/orders/orders.service';
import type { Merchant } from '../../src/merchants/merchant.entity';

const merchant = { id: 'm1', name: 'Comercio Test' } as Merchant;

function buildDeps(overrides: { registrarComprobante?: () => unknown } = {}) {
  const n8n = { ask: mock(async () => 'Respuesta del agente') };
  const messaging = { sendText: mock(async () => {}), sendLocationRequest: mock(async () => {}) };
  const orders = {
    guardarUbicacion: mock(async () => {}),
    registrarComprobante: mock(overrides.registrarComprobante ?? (async () => ({ registrado: true }))),
  };

  const service = new VendorInboundService(
    n8n as unknown as N8nAgentService,
    messaging as unknown as MessagingPort,
    orders as unknown as OrdersService,
  );

  return { service, n8n, messaging, orders };
}

describe('VendorInboundService', () => {
  it('texto: consulta a n8n y responde por MessagingPort desde el número del comercio', async () => {
    const { service, n8n, messaging } = buildDeps();

    await service.handle(merchant, { messageId: 'm', from: '+58911', type: 'text', text: 'hola' });

    expect(n8n.ask).toHaveBeenCalledTimes(1);
    expect(messaging.sendText).toHaveBeenCalledWith('m1', '+58911', 'Respuesta del agente');
  });

  it('texto sin body: no llama a n8n', async () => {
    const { service, n8n } = buildDeps();
    await service.handle(merchant, { messageId: 'm', from: '+58911', type: 'text' });
    expect(n8n.ask).not.toHaveBeenCalled();
  });

  it('ubicación: guarda lat/lng en la orden y no llama a n8n', async () => {
    const { service, n8n, orders } = buildDeps();

    await service.handle(merchant, { messageId: 'm', from: '+58911', type: 'location', latitude: 10, longitude: -66 });

    expect(orders.guardarUbicacion).toHaveBeenCalledWith('m1', '+58911', 10, -66);
    expect(n8n.ask).not.toHaveBeenCalled();
  });

  it('imagen con orden ESPERANDO_PAGO: crea el comprobante y acusa recibo (nadie más recibe aviso)', async () => {
    const { service, orders, messaging } = buildDeps();

    await service.handle(merchant, { messageId: 'm', from: '+58911', type: 'image', mediaId: 'media1' });

    expect(orders.registrarComprobante).toHaveBeenCalledWith('m1', '+58911', 'media1', 'm');
    expect(messaging.sendText).toHaveBeenCalledTimes(1);
  });

  it('imagen sin orden ESPERANDO_PAGO: no envía ningún acuse', async () => {
    const { service, messaging } = buildDeps({
      registrarComprobante: () => ({ error: 'no_hay_orden_esperando_pago' }),
    });

    await service.handle(merchant, { messageId: 'm', from: '+58911', type: 'image', mediaId: 'media1' });

    expect(messaging.sendText).not.toHaveBeenCalled();
  });
});
