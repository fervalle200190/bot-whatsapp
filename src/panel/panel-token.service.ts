import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/** Link secreto permanente por comercio, entregado como QR (alta manual, SPEC 05); regenerable. */
@Injectable()
export class PanelTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }
}
