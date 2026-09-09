import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class RegistroDto {
  @ApiProperty({ example: 'Arepas La Esquina' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: '+584121234567' })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'El teléfono debe estar en formato E.164, ej: +584121234567.',
  })
  ownerPhone!: string;
}
