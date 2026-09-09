/**
 * Puerto de salida de mensajería. `cerrar_orden` y `definir_entrega`
 * dependen solo de esta interfaz; el SPEC 03 la implementa con Meta.
 */
export abstract class MessagingPort {
  abstract sendText(merchantId: string, to: string, text: string): Promise<void>;
  abstract sendLocationRequest(merchantId: string, to: string, text: string): Promise<void>;
}
