import { BeforeInsert, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { generateId } from '../common/id';
import { numericToNumber } from '../common/numeric.transformer';
import { Order } from './order.entity';

@Entity({ name: 'order_item' })
export class OrderItem {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column()
  orderId!: string;

  @ManyToOne(() => Order, (o) => o.items, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'orderId' })
  order!: Relation<Order>;

  // Sin relación formal a Product, igual que en el SPEC 01: es un snapshot,
  // no una referencia viva.
  @Column()
  productId!: string;

  @Column()
  nameSnapshot!: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: numericToNumber })
  unitPriceUsd!: number;

  @Column({ type: 'int' })
  qty!: number;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = generateId();
  }
}
