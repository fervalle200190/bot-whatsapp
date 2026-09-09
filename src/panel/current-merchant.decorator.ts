import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Merchant } from '../merchants/merchant.entity';
import type { RequestWithMerchant } from './panel-token.guard';

/** El `Merchant` que `PanelTokenGuard` ya resolvió del `panelToken`. */
export const CurrentMerchant = createParamDecorator((_: unknown, ctx: ExecutionContext): Merchant => {
  const req = ctx.switchToHttp().getRequest<RequestWithMerchant>();
  return req.merchant;
});
