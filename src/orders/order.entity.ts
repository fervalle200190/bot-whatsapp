import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { generateId } from '../common/id';
import { numericToNumber } from '../common/numeric.transformer';
import { Merchant } from '../merchants/merchant.entity';
import { OrderItem } from './order-item.entity';
import { PaymentProof } from './payment-proof.entity';

export enum Fulfillment {
  RETIRO = 'RETIRO',
  DELIVERY = 'DELIVERY',
}

export enum OrderStatus {
  BORRADOR = 'BORRADOR',
  ESPERANDO_PAGO = 'ESPERANDO_PAGO',
  PAGO_EN_REVISION = 'PAGO_EN_REVISION',
  APROBADA = 'APROBADA',
  RECHAZADA = 'RECHAZADA',
  CANCELADA = 'CANCELADA',
}

@Entity({ name: 'order' })
@Index(['merchantId', 'status'])
@Index(['merchantId', 'buyerPhone', 'status'])
export class Order {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column()
  merchantId!: string;

  @ManyToOne(() => Merchant, (m) => m.orders, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant!: Relation<Merchant>;

  @Column()
  buyerPhone!: string;

  @Column({ type: 'varchar', nullable: true })
  buyerName!: string | null;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.BORRADOR })
  status!: OrderStatus;

  @Column({ type: 'enum', enum: Fulfillment, nullable: true })
  fulfillment!: Fulfillment | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true, transformer: numericToNumber })
  deliveryLat!: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true, transformer: numericToNumber })
  deliveryLng!: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericToNumber })
  totalUsd!: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true, transformer: numericToNumber })
  totalVes!: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true, transformer: numericToNumber })
  vesRateUsed!: number | null;

  @OneToMany(() => OrderItem, (i) => i.order)
  items!: Relation<OrderItem>[];

  @OneToMany(() => PaymentProof, (p) => p.order)
  proofs!: Relation<PaymentProof>[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = generateId();
  }
}
