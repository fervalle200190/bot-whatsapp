import { describe, expect, it } from 'bun:test';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MetaSignatureGuard } from '../../src/meta/meta-signature.guard';

function fakeConfig(appSecret: string) {
  return { get: () => appSecret } as unknown as ConstructorParameters<typeof MetaSignatureGuard>[0];
}

function fakeContext(headers: Record<string, string>, rawBody?: Buffer): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, rawBody }) }),
  } as unknown as ExecutionContext;
}

describe('MetaSignatureGuard', () => {
  const secret = 'app_secret_test';
  const guard = new MetaSignatureGuard(fakeConfig(secret));

  it('acepta una firma válida calculada sobre el body crudo', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const ctx = fakeContext({ 'x-hub-signature-256': signature }, rawBody);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rechaza una firma inválida', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const ctx = fakeContext({ 'x-hub-signature-256': 'sha256=deadbeef' }, rawBody);

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rechaza si falta el header de firma', () => {
    const ctx = fakeContext({}, Buffer.from('{}'));
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rechaza si falta el body crudo', () => {
    const ctx = fakeContext({ 'x-hub-signature-256': 'sha256=x' }, undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
