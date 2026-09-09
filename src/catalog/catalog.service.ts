import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Product } from './product.entity';

export interface ProductoDto {
  nombre: string;
  descripcion: string | null;
  precioUsd: number;
}

@Injectable()
export class CatalogService {
  constructor(@InjectRepository(Product) private readonly products: Repository<Product>) {}

  /** Catálogo filtrado por comercio y disponibilidad; término opcional, case-insensitive en nombre y descripción. */
  async buscar(merchantId: string, termino?: string): Promise<ProductoDto[]> {
    const where = termino
      ? [
          { merchantId, available: true, name: ILike(`%${termino}%`) },
          { merchantId, available: true, description: ILike(`%${termino}%`) },
        ]
      : { merchantId, available: true };

    const products = await this.products.find({ where, order: { name: 'ASC' } });

    return products.map((p) => ({
      nombre: p.name,
      descripcion: p.description,
      precioUsd: p.priceUsd,
    }));
  }

  /** Un producto disponible del comercio, por nombre exacto case-insensitive. */
  async buscarPorNombreExacto(merchantId: string, nombre: string): Promise<Product | null> {
    return this.products.findOne({
      where: { merchantId, available: true, name: ILike(nombre) },
    });
  }
}
