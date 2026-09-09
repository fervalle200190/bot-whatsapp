import { afterEach, describe, expect, it, mock } from 'bun:test';
import { N8nAgentService } from '../../src/n8n/n8n-agent.service';

function fakeConfig(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as unknown as ConstructorParameters<typeof N8nAgentService>[0];
}

describe('N8nAgentService', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('ask() llama al webhook de n8n con el header X-N8N-Secret y devuelve el reply', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return { ok: true, json: async () => ({ reply: 'Tenemos arepas' }) } as Response;
    }) as unknown as typeof fetch;

    const service = new N8nAgentService(
      fakeConfig({ N8N_WEBHOOK_BASE_URL: 'http://localhost:5678/webhook', N8N_WEBHOOK_SECRET: 'secreto' }),
    );

    const reply = await service.ask({
      merchantId: 'm1',
      contactPhone: '+58911',
      text: 'hola',
      systemPrompt: 'sos un vendedor',
    });

    expect(reply).toBe('Tenemos arepas');
    expect(capturedUrl).toBe('http://localhost:5678/webhook/agente-vendedor');
    expect((capturedInit!.headers as Record<string, string>)['X-N8N-Secret']).toBe('secreto');
    expect(JSON.parse(capturedInit!.body as string)).toEqual({
      merchantId: 'm1',
      contactPhone: '+58911',
      text: 'hola',
      systemPrompt: 'sos un vendedor',
    });
  });

  it('lanza un error si n8n responde distinto de 2xx', async () => {
    globalThis.fetch = mock(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;

    const service = new N8nAgentService(fakeConfig({ N8N_WEBHOOK_BASE_URL: 'http://x', N8N_WEBHOOK_SECRET: 's' }));

    await expect(
      service.ask({ merchantId: 'm1', contactPhone: '+1', text: 'hi', systemPrompt: 'p' }),
    ).rejects.toThrow();
  });
});
