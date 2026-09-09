import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Repository } from 'typeorm';
import { MetaMessagingService } from '../../src/meta/meta-messaging.service';
import { createFakeRepo, type FakeRepo } from '../fakes/fake-repo';
import type { Merchant } from '../../src/merchants/merchant.entity';

function fakeConfig(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as unknown as ConstructorParameters<typeof MetaMessagingService>[0];
}

describe('MetaMessagingService', () => {
  let merchantsRepo: FakeRepo<Merchant>;
  let service: MetaMessagingService;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    merchantsRepo = createFakeRepo<Merchant>();
    await merchantsRepo.save({ id: 'm1', metaPhoneNumberId: 'PN1' } as Merchant);
    service = new MetaMessagingService(
      fakeConfig({ META_GRAPH_VERSION: 'v21.0', META_ACCESS_TOKEN: 'token123' }),
      merchantsRepo as unknown as Repository<Merchant>,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sendText llama al endpoint de Meta con el phone_number_id del comercio', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;

    await service.sendText('m1', '+58911', 'hola');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v21.0/PN1/messages');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '+58911',
      type: 'text',
      text: { body: 'hola' },
    });
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer token123');
  });

  it('sendLocationRequest envía un mensaje interactivo location_request_message', async () => {
    const calls: { init: RequestInit }[] = [];
    globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      calls.push({ init: init! });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;

    await service.sendLocationRequest('m1', '+58911', 'Compartí tu ubicación');

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('location_request_message');
  });

  it('lanza un error si el comercio no tiene metaPhoneNumberId configurado', async () => {
    await merchantsRepo.save({ id: 'sin-meta', metaPhoneNumberId: null } as Merchant);
    await expect(service.sendText('sin-meta', '+58911', 'hola')).rejects.toThrow();
  });

  it('downloadMedia resuelve la url en Meta y después descarga el archivo', async () => {
    globalThis.fetch = mock(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr === 'https://graph.facebook.com/v21.0/media123') {
        return { ok: true, json: async () => ({ url: 'https://cdn.meta.test/file.jpg' }) } as Response;
      }
      if (urlStr === 'https://cdn.meta.test/file.jpg') {
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode('imagen').buffer,
          headers: new Headers({ 'content-type': 'image/jpeg' }),
        } as Response;
      }
      throw new Error(`url inesperada en el test: ${urlStr}`);
    }) as unknown as typeof fetch;

    const result = await service.downloadMedia('media123');

    expect(result.contentType).toBe('image/jpeg');
    expect(result.buffer.toString()).toBe('imagen');
  });
});
