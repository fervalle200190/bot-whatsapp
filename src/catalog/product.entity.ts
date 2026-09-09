import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { generateId } from '../common/id';
import { numericToNumber } from '../common/numeric.transformer';
import { Merchant } from '../merchants/merchant.entity';

export enum ProductSource {
  EXTRACCION_FOTO = 'EXTRACCION_FOTO',
  MANUAL_CHAT = 'MANUAL_CHAT',
}

@Entity({ name: 'product' })
@Index(['merchantId', 'available'])
export class Product {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column()
  merchantId!: string;

  @ManyToOne(() => Merchant, (m) => m.products, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant!: Relation<Merchant>;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: numericToNumber })
  priceUsd!: number;

  @Column({ default: true })
  available!: boolean;

  @Column({ type: 'enum', enum: ProductSource })
  source!: ProductSource;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = generateId();
  }
}
