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
} from 'typeorm';
import { generateId } from '../common/id';
import { Merchant } from '../merchants/merchant.entity';

export enum ImportStatus {
  EXTRAYENDO = 'EXTRAYENDO',
  ESPERANDO_CONFIRMACION = 'ESPERANDO_CONFIRMACION',
  CONFIRMADO = 'CONFIRMADO',
  DESCARTADO = 'DESCARTADO',
}

/**
 * Se conserva la tabla por paridad de esquema con el SPEC 01 (sección 2 de
 * SPEC 02 la lista explícitamente), aunque nada en este spec la escribe: la
 * extracción de menú con IA no se porta.
 */
@Entity({ name: 'menu_import' })
@Index(['merchantId', 'status'])
export class MenuImport {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column()
  merchantId!: string;

  @ManyToOne(() => Merchant, (m) => m.menuImports, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant!: Relation<Merchant>;

  @Column()
  sourceUrl!: string;

  @Column({ type: 'enum', enum: ImportStatus, default: ImportStatus.EXTRAYENDO })
  status!: ImportStatus;

  @Column({ type: 'jsonb' })
  extracted!: unknown;

  @Column()
  model!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = generateId();
  }
}
