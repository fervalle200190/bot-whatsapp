import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ActualizarCobroDto {
  @ApiProperty({ example: 'Pago Móvil: Banco Mercantil, V-12345678, 0412-1234567' })
  @IsString()
  @IsNotEmpty()
  datosCobro!: string;
}
