import { BeforeInsert, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { generateId } from '../common/id';
import { Order } from './order.entity';

export enum ProofDecision {
  PENDIENTE = 'PENDIENTE',
  APROBADO = 'APROBADO',
  RECHAZADO = 'RECHAZADO',
}

@Entity({ name: 'payment_proof' })
export class PaymentProof {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column()
  orderId!: string;

  @ManyToOne(() => Order, (o) => o.proofs, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'orderId' })
  order!: Relation<Order>;

  // Id de la media en Meta (no una URL: las URLs de Meta expiran y requieren
  // token para resolverse). El panel del comercio la descarga on-demand con
  // `MetaMessagingService.downloadMedia` (SPEC 04).
  @Column()
  mediaId!: string;

  // Id del mensaje en el canal de origen (Meta). Genérico a propósito.
  @Column()
  sourceMessageId!: string;

  @Column({ type: 'enum', enum: ProofDecision, default: ProofDecision.PENDIENTE })
  decision!: ProofDecision;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  merchantNote!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = generateId();
  }
}
