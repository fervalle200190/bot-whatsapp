import { CanActivate, ExecutionContext, Injectable, RawBodyRequest, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { EnvVars } from '../config/env.validation';

/** Verifica `X-Hub-Signature-256` con el app secret, en tiempo constante. */
@Injectable()
export class MetaSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const rawHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!signature || !req.rawBody) {
      throw new UnauthorizedException();
    }

    const appSecret = this.config.get('META_APP_SECRET', { infer: true });
    const expected = `sha256=${createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`;

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) {
      timingSafeEqual(expBuf, expBuf);
      throw new UnauthorizedException();
    }
    if (!timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
