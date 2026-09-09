import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class BuscarProductosArgs {
  @IsOptional()
  @IsString()
  termino?: string;
}

export class AgregarAlCarritoArgs {
  @IsString()
  @IsNotEmpty()
  nombreProducto!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad: number = 1;
}

export class DefinirEntregaArgs {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsIn(['RETIRO', 'DELIVERY'])
  tipo!: 'RETIRO' | 'DELIVERY';
}

// `ver_carrito` y `cerrar_orden` no toman argumentos, igual que en el SPEC 01
// (no tenían schema de validación propio): no hay nada que validar, así que no tienen DTO.
