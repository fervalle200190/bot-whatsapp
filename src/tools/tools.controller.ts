import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CatalogService } from '../catalog/catalog.service';
import { CartService } from '../orders/cart.service';
import { OrdersService } from '../orders/orders.service';
import { Fulfillment } from '../orders/order.entity';
import { ToolsSecretGuard } from './tools-secret.guard';
import { ToolCallDto } from './dto/tool-call.dto';
import { AgregarAlCarritoArgs, BuscarProductosArgs, DefinirEntregaArgs } from './dto/args.dto';
import { validateArgs } from './dto/validate-args';

@ApiTags('tools')
@ApiHeader({ name: 'X-Tools-Secret', required: true })
@UseGuards(ToolsSecretGuard)
@Controller('tools')
export class ToolsController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly cart: CartService,
    private readonly orders: OrdersService,
  ) {}

  @Post('catalogo/buscar')
  @HttpCode(200)
  @ApiBody({ type: ToolCallDto })
  async buscarProductos(@Body() body: ToolCallDto) {
    const args = await validateArgs(BuscarProductosArgs, body.arguments);
    if (!args.success) return { error: 'argumentos_invalidos' };

    const productos = await this.catalog.buscar(body.merchantId, args.data.termino);
    return { productos };
  }

  @Post('carrito/agregar')
  @HttpCode(200)
  @ApiBody({ type: ToolCallDto })
  async agregarAlCarrito(@Body() body: ToolCallDto) {
    const args = await validateArgs(AgregarAlCarritoArgs, body.arguments);
    if (!args.success) return { error: 'argumentos_invalidos' };

    const product = await this.catalog.buscarPorNombreExacto(body.merchantId, args.data.nombreProducto);
    if (!product) return { error: 'producto_no_encontrado' };

    const order = await this.cart.add(body.merchantId, body.contactPhone, product, args.data.cantidad);
    const carrito = await this.cart.snapshot(order.id, body.merchantId);
    return { agregado: true, carrito };
  }

  @Post('carrito/ver')
  @HttpCode(200)
  @ApiBody({ type: ToolCallDto })
  async verCarrito(@Body() body: ToolCallDto) {
    const order = await this.cart.findDraft(body.merchantId, body.contactPhone);
    const carrito = order
      ? await this.cart.snapshot(order.id, body.merchantId)
      : await this.cart.emptySnapshot(body.merchantId);

    return { carrito };
  }

  @Post('orden/entrega')
  @HttpCode(200)
  @ApiBody({ type: ToolCallDto })
  async definirEntrega(@Body() body: ToolCallDto) {
    const args = await validateArgs(DefinirEntregaArgs, body.arguments);
    if (!args.success) return { error: 'argumentos_invalidos' };

    const tipo = args.data.tipo === 'RETIRO' ? Fulfillment.RETIRO : Fulfillment.DELIVERY;
    return this.orders.definirEntrega(body.merchantId, body.contactPhone, tipo);
  }

  @Post('orden/cerrar')
  @HttpCode(200)
  @ApiBody({ type: ToolCallDto })
  async cerrarOrden(@Body() body: ToolCallDto) {
    return this.orders.cerrar(body.merchantId, body.contactPhone);
  }
}
