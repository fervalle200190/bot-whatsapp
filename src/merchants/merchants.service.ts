import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Merchant, MerchantStatus } from './merchant.entity';

@Injectable()
export class MerchantsService {
  constructor(@InjectRepository(Merchant) private readonly merchants: Repository<Merchant>) {}

  async findById(id: string): Promise<Merchant | null> {
    return this.merchants.findOne({ where: { id } });
  }

  async findByOwnerPhone(ownerPhone: string): Promise<Merchant | null> {
    return this.merchants.findOne({ where: { ownerPhone } });
  }

  /** Ruteo de webhooks de Meta: cada evento trae el `phone_number_id`, no un merchantId. */
  async findByMetaPhoneNumberId(metaPhoneNumberId: string): Promise<Merchant | null> {
    return this.merchants.findOne({ where: { metaPhoneNumberId } });
  }

  /** Autenticación del panel del comercio (SPEC 04): `Authorization: Bearer <panelToken>`. */
  async findByPanelToken(panelToken: string): Promise<Merchant | null> {
    return this.merchants.findOne({ where: { panelToken } });
  }

  async regenerarPanelToken(merchantId: string, panelToken: string): Promise<void> {
    await this.merchants.update({ id: merchantId }, { panelToken });
  }

  async crearPendiente(name: string, ownerPhone: string): Promise<Merchant> {
    const merchant = this.merchants.create({
      name,
      ownerPhone,
      status: MerchantStatus.PENDIENTE_CONEXION,
    });
    return this.merchants.save(merchant);
  }

  async actualizarTasa(merchantId: string, vesRate: number): Promise<void> {
    await this.merchants.update({ id: merchantId }, { vesRate, vesRateUpdatedAt: new Date() });
  }

  async actualizarCobro(merchantId: string, payoutInstructions: string): Promise<void> {
    await this.merchants.update({ id: merchantId }, { payoutInstructions });
  }
}
