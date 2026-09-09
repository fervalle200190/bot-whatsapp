import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';

/**
 * Sobre común de toda tool call. `merchantId` y `contactPhone` son la
 * identidad — la pone quien llama (n8n en el SPEC 03), nunca el modelo.
 * `arguments` es lo único que genera el modelo; cada tool la valida con su
 * propio DTO (ver dto/args.dto.ts) fuera del pipe global, para poder
 * devolver `{ error: "argumentos_invalidos" }` con 200 en vez de un 400.
 */
export class ToolCallDto {
  @ApiProperty({ description: 'Identidad del comercio; la pone quien llama, nunca el modelo.' })
  @IsString()
  merchantId!: string;

  @ApiProperty({ description: 'E.164 del comprador.' })
  @IsString()
  contactPhone!: string;

  @ApiProperty({ type: Object, description: 'Argumentos generados por el modelo; forma libre, validada por tool.' })
  @IsObject()
  arguments!: Record<string, unknown>;
}
