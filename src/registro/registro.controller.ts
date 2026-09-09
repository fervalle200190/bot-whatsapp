import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantsService } from '../merchants/merchants.service';
import { RegistroDto } from './registro.dto';
import { REGISTRO_FORM_HTML, REGISTRO_SUCCESS_HTML } from './registro.templates';

/**
 * HTML mínimo, sin invitaciones ni llamadas externas: crea el Merchant en
 * PENDIENTE_CONEXION y avisa "te contactamos para conectar tu número".
 */
@ApiTags('registro')
@Controller('registro')
export class RegistroController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @ApiOperation({ summary: 'Formulario HTML de alta de comercio.' })
  @Header('Content-Type', 'text/html; charset=utf-8')
  getForm(): string {
    return REGISTRO_FORM_HTML;
  }

  @Post()
  @ApiOperation({ summary: 'Crea el Merchant en PENDIENTE_CONEXION; idempotente por ownerPhone.' })
  @ApiBody({ type: RegistroDto })
  @Header('Content-Type', 'text/html; charset=utf-8')
  async postForm(@Body() body: RegistroDto): Promise<string> {
    const existing = await this.merchants.findByOwnerPhone(body.ownerPhone);
    if (!existing) {
      await this.merchants.crearPendiente(body.name, body.ownerPhone);
    }
    return REGISTRO_SUCCESS_HTML;
  }
}
