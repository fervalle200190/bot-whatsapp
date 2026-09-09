import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { Merchant, MerchantStatus } from '../merchants/merchant.entity';
import { Product, ProductSource } from '../catalog/product.entity';

config();

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: ENTITIES,
    synchronize: false,
  });
  await dataSource.initialize();

  const merchantRepo = dataSource.getRepository(Merchant);
  const productRepo = dataSource.getRepository(Product);

  // Upsert real por ownerPhone: crea si no existe, y si ya existe sincroniza
  // los mismos valores (para que agregar campos al seed no requiera borrar la base).
  const seedData = {
    name: 'Arepas La Esquina',
    ownerPhone: '+584121234567',
    status: MerchantStatus.ACTIVO,
    payoutInstructions: 'Pago Móvil: Banco Mercantil, V-12345678, 0412-1234567',
    vesRate: 360.5,
    vesRateUpdatedAt: new Date(),
    // Ficticio: en producción lo asigna el alta manual (SPEC 05).
    metaPhoneNumberId: 'seed_meta_phone_number_id',
    metaDisplayPhone: '+584121234567',
    // Token fijo y conocido para probar el SPA del panel en local (ver README).
    panelToken: 'seed_panel_token_local_only',
  };

  let merchant = await merchantRepo.findOne({ where: { ownerPhone: seedData.ownerPhone } });
  if (!merchant) {
    merchant = await merchantRepo.save(merchantRepo.create(seedData));
  } else {
    await merchantRepo.update({ id: merchant.id }, seedData);
    merchant = await merchantRepo.findOneOrFail({ where: { id: merchant.id } });
  }

  const existingProducts = await productRepo.count({ where: { merchantId: merchant.id } });
  if (existingProducts === 0) {
    await productRepo.save([
      productRepo.create({
        merchantId: merchant.id,
        name: 'Arepa Reina Pepiada',
        description: 'Con pollo, aguacate y mayonesa de la casa',
        priceUsd: 3.5,
        available: true,
        source: ProductSource.MANUAL_CHAT,
      }),
      productRepo.create({
        merchantId: merchant.id,
        name: 'Arepa Pelúa',
        description: 'Con carne mechada y queso amarillo',
        priceUsd: 4.0,
        available: true,
        source: ProductSource.MANUAL_CHAT,
      }),
      productRepo.create({
        merchantId: merchant.id,
        name: 'Jugo de parchita',
        description: null,
        priceUsd: 1.5,
        available: true,
        source: ProductSource.MANUAL_CHAT,
      }),
    ]);
  }

  console.log(`Seed listo para el comercio: ${merchant.name} (${merchant.id})`);
  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
