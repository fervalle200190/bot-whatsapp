import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { MerchantsService } from '../merchants/merchants.service';
import type { Merchant } from '../merchants/merchant.entity';

export interface RequestWithMerchant extends Request {
  merchant: Merchant;
}

/** Resuelve el `Merchant` a partir de `Authorization: Bearer <panelToken>`; si no, 401. */
@Injectable()
export class PanelTokenGuard implements CanActivate {
  constructor(private readonly merchants: MerchantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithMerchant>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

    if (!token) throw new UnauthorizedException();

    const merchant = await this.merchants.findByPanelToken(token);
    if (!merchant) throw new UnauthorizedException();

    req.merchant = merchant;
    return true;
  }
}
