import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class OrdenesQueryDto {
  @ApiPropertyOptional({ description: 'Filtra por updatedAt posterior a esta fecha (para el polling del SPA).' })
  @IsOptional()
  @IsISO8601()
  desde?: string;
}
