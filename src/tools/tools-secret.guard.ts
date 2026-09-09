import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { EnvVars } from '../config/env.validation';

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // compara igual contra sí mismo para no revelar la diferencia de longitud por tiempo
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Compara `X-Tools-Secret` en tiempo constante contra `TOOLS_SHARED_SECRET`. */
@Injectable()
export class ToolsSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const rawHeader = req.headers['x-tools-secret'];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const expected = this.config.get('TOOLS_SHARED_SECRET', { infer: true });

    if (!provided || !timingSafeEqualStrings(provided, expected)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
