import { Merchant } from '../merchants/merchant.entity';
import { Product } from '../catalog/product.entity';
import { MenuImport } from '../catalog/menu-import.entity';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { PaymentProof } from '../orders/payment-proof.entity';

/** Lista única de entidades, compartida por `AppModule` y `AppDataSource` (CLI). */
export const ENTITIES = [Merchant, Product, MenuImport, Order, OrderItem, PaymentProof];
