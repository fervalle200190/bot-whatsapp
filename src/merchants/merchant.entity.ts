import { BeforeInsert, Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, type Relation } from 'typeorm';
import { generateId } from '../common/id';
import { numericToNumber } from '../common/numeric.transformer';
import { Product } from '../catalog/product.entity';
import { MenuImport } from '../catalog/menu-import.entity';
import { Order } from '../orders/order.entity';

export enum MerchantStatus {
  PENDIENTE_CONEXION = 'PENDIENTE_CONEXION',
  ACTIVO = 'ACTIVO',
  SUSPENDIDO = 'SUSPENDIDO',
}

@Entity({ name: 'merchant' })
export class Merchant {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  ownerPhone!: string;

  @Column({ type: 'enum', enum: MerchantStatus, default: MerchantStatus.PENDIENTE_CONEXION })
  status!: MerchantStatus;

  @Column({ type: 'text', nullable: true })
  payoutInstructions!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true, transformer: numericToNumber })
  vesRate!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  vesRateUpdatedAt!: Date | null;

  // `phone_number_id` de Meta; se llena en el alta manual (SPEC 05).
  @Column({ type: 'varchar', nullable: true, unique: true })
  metaPhoneNumberId!: string | null;

  // E.164 legible, informativo (SPEC 03).
  @Column({ type: 'varchar', nullable: true })
  metaDisplayPhone!: string | null;

  // Token secreto permanente del panel del comercio (SPEC 04); null hasta el alta manual (SPEC 05).
  @Column({ type: 'varchar', nullable: true, unique: true })
  panelToken!: string | null;

  @OneToMany(() => Product, (p) => p.merchant)
  products!: Relation<Product>[];

  @OneToMany(() => Order, (o) => o.merchant)
  orders!: Relation<Order>[];

  @OneToMany(() => MenuImport, (m) => m.merchant)
  menuImports!: Relation<MenuImport>[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = generateId();
  }
}
