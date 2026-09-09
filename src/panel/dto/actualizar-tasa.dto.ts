import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive } from 'class-validator';

export class ActualizarTasaDto {
  @ApiProperty({ example: 360.5 })
  @IsNumber()
  @IsPositive()
  tasaBsPorUsd!: number;
}
