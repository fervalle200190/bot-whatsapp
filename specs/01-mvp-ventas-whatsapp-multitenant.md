# SPEC 01 — MVP de ventas por WhatsApp multi-tenant

> **Estado:** Aprobado
> **Depende de:** —
> **Fecha:** 2026-09-05
> **Objetivo:** Validar que un comercio puede inscribirse apretando un botón, cargar su menú con una foto y vender por WhatsApp mediante un agente de IA, quedando cada pago en una cola de aprobación manual.

---

## 1 — Por qué existe este spec

La hipótesis a validar es comercial, no técnica: **¿un comercio pequeño adopta esto sin ayuda, y su cliente compra por chat?** Todo lo que no sirva para responder eso queda fuera.

Tres decisiones de fondo que condicionan el resto:

- **Zavu (`zavu.dev`) es la capa de mensajería, no se construye.** Aporta las primitivas caras: *Partner Invitations* (embedded signup de Meta sin compartir credenciales), *Senders*, *Agents* con *Webhook Tools*, y mensajes interactivos de botones y ubicación. Construir esto contra la Cloud API de Meta directamente costaría semanas y es exactamente el trabajo que no valida la hipótesis.
- **Multi-tenant es requisito duro, no una fase 2 — pero el aislamiento es de nuestra Postgres, no de Zavu.** La API de `invitations.create` de Zavu no tiene ningún parámetro para ligar la invitación a una *Sub-Account*, y la doc no confirma un flujo donde el sender resultante nazca aislado dentro de una sub-cuenta del comercio. Se probó y se descartó — ver la decisión al respecto en la sección 6. Un comercio = un sender + un agente en el **mismo proyecto principal de Zavu**, más una partición lógica estricta en Postgres. No hay tabla sin `merchantId`, no hay consulta sin filtro por `merchantId`.
- **La lógica de negocio vive en un backend propio.** Zavu llama a nuestros endpoints como *Agent Tools*. La fuente de verdad del catálogo, el carrito y las órdenes es nuestra Postgres, no la Memory API de Zavu.

### Consecuencia de diseño: hacen falta dos superficies de chat

El número del comercio **es** el bot que atiende compradores. El dueño no puede escribirle a su propio número de WhatsApp. Como el onboarding del menú y la aprobación de pagos ocurren por WhatsApp, el sistema necesita dos números distintos:

| Superficie | Cantidad | Dueño | Con quién habla | Agente |
| --- | --- | --- | --- | --- |
| **Número operador** | 1, compartido | Zavu | Los dueños de los comercios | `zavu-operador` |
| **Número vendedor** | N, uno por comercio | El comercio | Los compradores | `zavu-vendedor-<merchantId>` |

El número operador identifica al comercio por el `ownerPhone` de quien escribe. Ambos números —operador y vendedores— viven en la misma cuenta principal de Zavu; lo que los distingue es el `senderId`.

---

## 2 — Alcance

**Dentro:**

- Landing mínima `/registro` con un botón que crea el `Merchant` en Postgres, genera la *Partner Invitation* de Zavu y redirige al embedded signup de Meta.
- Webhook que detecta la invitación aceptada, guarda el `senderId`, crea el agente vendedor del comercio y lo conecta a su sender.
- Carga de catálogo por foto o PDF del menú enviado al número operador, con extracción a JSON estructurado mediante Claude con visión.
- Confirmación y corrección del catálogo extraído por chat, antes de persistirlo.
- Catálogo plano: nombre, descripción, precio en USD, disponible sí/no.
- Precio en USD con total también en bolívares, usando una tasa Bs/USD que el comercio fija y actualiza por chat.
- Datos de cobro (Pago Móvil / transferencia) como texto libre que el comercio carga por chat y el bot le repite al comprador.
- Agente vendedor que consulta catálogo, arma carrito, pregunta retiro o delivery, y cierra la orden.
- Delivery capturado con el mensaje de ubicación nativo de WhatsApp.
- Recepción de la foto del comprobante y encolado de la orden en `PAGO_EN_REVISION`.
- Aviso al comercio por el número operador con la imagen del comprobante y botones **Aprobar** / **Rechazar**.
- Notificación al comprador del resultado de la revisión.
- Aislamiento multi-tenant verificado con un test automatizado.

**Fuera de alcance (para specs futuros):**

- Panel web para el comercio. Toda la administración es por chat en este MVP.
- Panel web interno de Zavu para observar todos los comercios.
- Variantes, modificadores y stock numérico.
- Categorías del menú.
- Pasarelas de pago y confirmación automática (Mercado Pago, Stripe, Zelle).
- Lectura del comprobante con IA para pre-validar el monto contra el total.
- Cálculo o cobro de costo de envío.
- Tasa Bs/USD automática desde una fuente externa.
- Multi-idioma. El MVP es solo español.
- Horarios de atención, pausar el negocio, agotar un producto por tiempo.
- Broadcasts, remarketing y recuperación de carritos.
- Canales que no sean WhatsApp, aunque Zavu los soporte.
- Facturación del comercio hacia Zavu.

---

## 3 — Modelo de datos

Postgres vía Prisma. Todas las tablas de negocio cuelgan de `Merchant`; **ninguna consulta se escribe sin `merchantId` en el `where`**.

```prisma
enum MerchantStatus { PENDIENTE_CONEXION  ACTIVO  SUSPENDIDO }
enum ProductSource  { EXTRACCION_FOTO  MANUAL_CHAT }
enum ImportStatus   { EXTRAYENDO  ESPERANDO_CONFIRMACION  CONFIRMADO  DESCARTADO }
enum Fulfillment    { RETIRO  DELIVERY }
enum OrderStatus    { BORRADOR  ESPERANDO_PAGO  PAGO_EN_REVISION  APROBADA  RECHAZADA  CANCELADA }
enum ProofDecision  { PENDIENTE  APROBADO  RECHAZADO }

model Merchant {
  id                 String         @id @default(cuid())
  name               String
  ownerPhone         String         @unique          // E.164, el WhatsApp del dueño
  status             MerchantStatus @default(PENDIENTE_CONEXION)

  // Zavu
  zavuInvitationId   String?        @unique          // permite resolver el Merchant al activarse (paso 6)
  zavuSenderId       String?        @unique          // el número del comercio, se llena al conectar
  zavuSenderWebhookSecret String?                    // secreto v2 del webhook de ESE sender (por-sender, no global)
  zavuAgentId        String?        @unique

  // Cobro y precios
  payoutInstructions String?                         // texto libre: banco, cédula/RIF, teléfono, alias
  vesRate            Decimal?       @db.Decimal(18, 4)  // bolívares por 1 USD
  vesRateUpdatedAt   DateTime?

  products           Product[]
  orders             Order[]
  menuImports        MenuImport[]
  createdAt          DateTime       @default(now())
}

model Product {
  id          String        @id @default(cuid())
  merchantId  String
  merchant    Merchant      @relation(fields: [merchantId], references: [id])
  name        String
  description String?
  priceUsd    Decimal       @db.Decimal(10, 2)
  available   Boolean       @default(true)
  source      ProductSource
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([merchantId, available])
}

model MenuImport {
  id         String       @id @default(cuid())
  merchantId String
  merchant   Merchant     @relation(fields: [merchantId], references: [id])
  sourceUrl  String                                  // attachment de Zavu
  status     ImportStatus @default(EXTRAYENDO)
  extracted  Json                                    // array crudo devuelto por el modelo
  model      String                                  // p. ej. "claude-opus-5"
  createdAt  DateTime     @default(now())

  @@index([merchantId, status])
}

model Order {
  id                 String        @id @default(cuid())
  merchantId         String
  merchant           Merchant      @relation(fields: [merchantId], references: [id])
  buyerPhone         String                          // E.164
  buyerName          String?
  status             OrderStatus   @default(BORRADOR)
  fulfillment        Fulfillment?
  deliveryLat        Decimal?      @db.Decimal(10, 7)
  deliveryLng        Decimal?      @db.Decimal(10, 7)
  totalUsd           Decimal?      @db.Decimal(10, 2)
  totalVes           Decimal?      @db.Decimal(18, 2)
  vesRateUsed        Decimal?      @db.Decimal(18, 4)   // congelada al cerrar la orden
  zavuConversationId String?
  items              OrderItem[]
  proofs             PaymentProof[]
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  @@index([merchantId, status])
  @@index([merchantId, buyerPhone, status])
}

model OrderItem {
  id           String   @id @default(cuid())
  orderId      String
  order        Order    @relation(fields: [orderId], references: [id])
  productId    String
  nameSnapshot String                                // el nombre al momento de comprar
  unitPriceUsd Decimal  @db.Decimal(10, 2)           // el precio al momento de comprar
  qty          Int
}

model PaymentProof {
  id           String        @id @default(cuid())
  orderId      String
  order        Order         @relation(fields: [orderId], references: [id])
  imageUrl     String                                // attachment de Zavu
  zavuMessageId String
  decision     ProofDecision @default(PENDIENTE)
  decidedAt    DateTime?
  merchantNote String?
  createdAt    DateTime      @default(now())
}
```

### Convenciones

- **El carrito no es una estructura aparte.** Un carrito es una `Order` en estado `BORRADOR`. Hay como máximo una por `(merchantId, buyerPhone)`.
- **Dinero:** `Decimal`, nunca `Float`. Precios en USD con 2 decimales; totales en Bs con 2 decimales; tasa con 4.
- **La tasa se congela.** `Order.vesRateUsed` se copia al cerrar la orden. Si el comercio cambia la tasa después, las órdenes ya cerradas no se mueven.
- **Los precios se congelan.** `OrderItem` guarda `nameSnapshot` y `unitPriceUsd`, no lee del `Product` al revisar.
- **Teléfonos:** siempre E.164 (`+58...`), normalizados al entrar.
- **Zavu:** una sola API key principal, compartida por todos los comercios, en `ZAVU_API_KEY` (env). No hay credencial de Zavu por comercio: el aislamiento entre comercios es responsabilidad exclusiva de filtrar por `merchantId` en cada consulta a Postgres.
- **Webhooks de Zavu son por sender, no por proyecto.** Cada `Sender` tiene su propia URL de webhook y su propio secreto de firma (`senders.create` / `senders.update` / `regenerateWebhookSecret`). El número operador —único, fijo— guarda su secreto en `ZAVU_OPERATOR_WEBHOOK_SECRET` (env). El sender de cada comercio, creado automáticamente por Zavu al completarse su invitación, guarda su secreto en `Merchant.zavuSenderWebhookSecret` una vez que el paso 6 le configura su webhook.

### Endpoints de Agent Tools

Zavu llama a estos endpoints como *Webhook Tools*. El payload de una tool call **no trae `senderId`** (confirmado en la doc: `{ tool, arguments, context: { messageId, contactPhone, sessionId }, timestamp }`) — es distinto del sobre de un webhook de evento normal. **Nunca se resuelve identidad desde `arguments`**, que es lo único que genera el modelo y por lo tanto lo único no confiable. Hay dos formas de resolver identidad, según quién llama:

- **Tools del operador:** quien escribe es el dueño. Se resuelve el `Merchant` por `context.contactPhone` (provisto por Zavu, no por el modelo) contra `ownerPhone`.
- **Tools del vendedor:** quien escribe es el comprador, así que `contactPhone` no identifica al comercio. Cada comercio tiene su propia copia de cada tool de venta (creadas junto con su agente, paso 7), con el `merchantId` incrustado en la URL que **nosotros** fijamos al crearla (`?merchantId=...`) — nunca en algo que el modelo genere.

Todas las Tools de este proyecto (de cualquier comercio y del operador) comparten un único secreto de firma fijo, `ZAVU_TOOLS_WEBHOOK_SECRET` (env), que nosotros mismos elegimos al crear cada tool (`webhookSecret` es opcional en la API de Zavu — "supply your own if you already have one you want reused"). No hace falta un secreto por comercio acá: la identidad la da `contactPhone`, no el secreto.

Agente vendedor (número del comercio):

| Tool | Endpoint | Hace |
| --- | --- | --- |
| `buscar_productos` | `POST /tools/catalogo/buscar` | Devuelve productos disponibles que matcheen |
| `agregar_al_carrito` | `POST /tools/carrito/agregar` | Crea o actualiza la `Order` en `BORRADOR` |
| `ver_carrito` | `POST /tools/carrito/ver` | Devuelve ítems y total en USD y Bs |
| `definir_entrega` | `POST /tools/orden/entrega` | Fija `RETIRO`, o pide ubicación para `DELIVERY` |
| `cerrar_orden` | `POST /tools/orden/cerrar` | Congela totales y tasa, pasa a `ESPERANDO_PAGO`, devuelve los datos de cobro |

Agente operador (número de Zavu):

| Tool | Endpoint | Hace |
| --- | --- | --- |
| `identificar_comercio` | `POST /tools/comercio/identificar` | Resuelve el comercio del `ownerPhone` que escribe, o señala que no existe |
| `confirmar_menu` | `POST /tools/menu/confirmar` | Persiste el `MenuImport` pendiente (`ESPERANDO_CONFIRMACION`) como `Product[]`, y lo pasa a `CONFIRMADO` |
| `editar_producto` | `POST /tools/producto/editar` | Corrige nombre, precio o descripción de un ítem **dentro del `MenuImport` pendiente**, antes de confirmar (ver decisión en sección 6) |
| `actualizar_tasa` | `POST /tools/tasa/actualizar` | Fija `vesRate` |
| `guardar_datos_cobro` | `POST /tools/cobro/guardar` | Fija `payoutInstructions` |

---

## 4 — Plan de implementación

Cada paso deja el sistema corriendo y es commiteable por separado.

1. **Scaffold.** `pnpm`, TypeScript estricto, Fastify, Zod, Prisma, Postgres local por Docker. `GET /health` devuelve `200`. `.env.example` con `DATABASE_URL`, `ZAVU_API_KEY`, `ZAVU_OPERATOR_SENDER_ID`, `ZAVU_OPERATOR_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `PUBLIC_BASE_URL`.
2. **Esquema Prisma.** El modelo de la sección 3 completo. `prisma migrate dev`. Seed con un comercio ficticio y tres productos. Prueba manual: `prisma studio` muestra las tablas.
3. **Cliente Zavu.** Wrapper tipado sobre el SDK de TypeScript de Zavu en `src/zavu/client.ts`. Prueba manual: un script lista los senders de la cuenta.
4. **Middleware de webhook.** Verificación de firma v2 de Zavu en `src/zavu/verify.ts`. Como el secreto es por sender, primero se lee `senderId` del body para resolver qué secreto usar: si es `ZAVU_OPERATOR_SENDER_ID` se usa `ZAVU_OPERATOR_WEBHOOK_SECRET` (env); si no, se busca el `Merchant` por `zavuSenderId` y se usa su `zavuSenderWebhookSecret`. Rechaza firma inválida, o `senderId` que no resuelve a ningún secreto conocido, con `401`. Test unitario con un payload firmado de ejemplo para cada caso.
5. **Landing de alta.** `GET /registro` sirve un formulario con nombre del comercio y teléfono del dueño, y un botón. `POST /registro` valida, crea el `Merchant` en `PENDIENTE_CONEXION`, crea la *Partner Invitation* con la API key principal de Zavu y redirige a la URL de invitación. Prueba manual: el botón lleva al embedded signup de Meta.
6. **Activación.** Webhook `invitation.status_changed` con `currentStatus = completed`: guarda `zavuSenderId`, configura el webhook de ESE sender (`senders.update` con la URL propia y `webhookSignatureVersion: 'v2'`), guarda el secreto devuelto en `zavuSenderWebhookSecret`, y pasa el comercio a `ACTIVO`. Prueba manual: conectar un número de prueba deja el registro completo y el secreto guardado.
7. **Agente vendedor.** Al activarse el comercio, crear el agente vendedor en la cuenta principal con el prompt de ventas y conectarle el sender del comercio. Prueba manual: escribirle al número del comercio devuelve un saludo.
8. **Agente operador.** Creación única del agente `zavu-operador` sobre el número de Zavu, con resolución de comercio por `ownerPhone`. Si el número que escribe no es dueño de ningún comercio, responde con el link de `/registro`. Prueba manual: el dueño escribe y el bot lo saluda por el nombre de su comercio.
9. **Extracción del menú.** El operador recibe una imagen o PDF, crea el `MenuImport` en `EXTRAYENDO` y llama a Claude (`claude-opus-5`) con el archivo y `output_config.format` para obtener `{ name, description, priceUsd }[]`. Guarda el resultado y pasa a `ESPERANDO_CONFIRMACION`. Prueba manual: una foto de un menú real devuelve productos con precios.
10. **Confirmación del menú.** El bot lista lo extraído y pide confirmación. `confirmar_menu` persiste los `Product`; `editar_producto` corrige uno. Prueba manual: corregir un precio por chat y confirmar deja el catálogo correcto en la base.
11. **Tasa y datos de cobro.** Tools `actualizar_tasa` y `guardar_datos_cobro` por chat con el operador. El operador se niega a activar la venta si falta cualquiera de los dos. Prueba manual: "la tasa es 360" deja `vesRate = 360`.
12. **Catálogo para el vendedor.** Tool `buscar_productos` filtrando por `merchantId` y `available`. Prueba manual: un comprador pregunta qué hay y recibe la lista real de ese comercio.
13. **Carrito.** Tools `agregar_al_carrito` y `ver_carrito` sobre la `Order` en `BORRADOR`. Prueba manual: pedir dos ítems y ver el total en USD y Bs.
14. **Entrega.** Tool `definir_entrega`. Para `DELIVERY`, el bot manda un *location request message* y el webhook guarda `deliveryLat` y `deliveryLng`. Prueba manual: compartir ubicación deja las coordenadas en la orden.
15. **Cierre y cobro.** Tool `cerrar_orden`: congela `totalUsd`, `totalVes` y `vesRateUsed`, pasa a `ESPERANDO_PAGO` y el bot envía los `payoutInstructions` del comercio con el monto en Bs. Prueba manual: la orden queda en `ESPERANDO_PAGO` con los tres montos congelados.
16. **Comprobante.** El vendedor recibe una imagen mientras la orden está en `ESPERANDO_PAGO`, crea el `PaymentProof` y pasa la orden a `PAGO_EN_REVISION`. Prueba manual: mandar una foto cambia el estado.
17. **Cola de revisión.** Al entrar en `PAGO_EN_REVISION`, el operador le manda al `ownerPhone` la imagen del comprobante, el resumen de la orden y un *button message* con **Aprobar** y **Rechazar**. Prueba manual: el dueño recibe el mensaje con los dos botones.
18. **Decisión.** El webhook del botón actualiza `PaymentProof.decision` y el estado de la orden a `APROBADA` o `RECHAZADA`, y el agente vendedor le avisa al comprador. Prueba manual: apretar Aprobar cierra el ciclo y el comprador recibe el aviso.
19. **Plantilla de WhatsApp.** Crear y enviar a aprobación la plantilla `pago_en_revision` para poder notificar al comercio fuera de la ventana de 24 horas, con fallback a mensaje libre si la ventana está abierta.
20. **Test de aislamiento multi-tenant.** Test de integración con dos comercios y datos cruzados que falla si cualquier tool devuelve o modifica algo de otro `merchantId`.

---

## 5 — Criterios de aceptación

- [x] `GET /health` responde `200`.
- [x] Un webhook con firma inválida recibe `401` y no toca la base.
- [x] Completar el formulario de `/registro` crea un `Merchant` en `PENDIENTE_CONEXION` con `zavuInvitationId` no nulo.
- [x] El botón de `/registro` redirige al embedded signup de Meta sin pedir credenciales de Meta en nuestra página.
- [x] Al aceptar la invitación, el comercio queda en `ACTIVO` con `zavuSenderId` y `zavuAgentId` no nulos.
- [x] Escribirle al número del comercio recién conectado obtiene una respuesta del agente vendedor.
- [x] Enviar una foto de menú al número operador crea un `MenuImport` y devuelve por chat una lista de productos con precios.
- [x] Confirmar el menú por chat crea los `Product` con `merchantId` correcto y `source = EXTRACCION_FOTO`.
- [x] Corregir un precio por chat antes de confirmar se refleja en el `Product` creado.
- [x] El operador se niega a habilitar la venta si el comercio no tiene `vesRate` o `payoutInstructions`.
- [x] Un comprador que pregunta por el catálogo recibe solo productos de ese comercio con `available = true`.
- [x] Agregar dos productos al carrito crea una `Order` en `BORRADOR` con dos `OrderItem`.
- [x] El total mostrado en Bs es igual a `totalUsd × vesRate` redondeado a 2 decimales.
- [x] Elegir delivery dispara un mensaje de solicitud de ubicación y compartirla guarda `deliveryLat` y `deliveryLng`.
- [x] Cerrar la orden la deja en `ESPERANDO_PAGO` con `totalUsd`, `totalVes` y `vesRateUsed` no nulos.
- [x] Cambiar `vesRate` después de cerrar una orden no modifica el `totalVes` de esa orden.
- [x] Enviar una imagen con la orden en `ESPERANDO_PAGO` crea un `PaymentProof` y deja la orden en `PAGO_EN_REVISION`.
- [x] Cada orden que entra en `PAGO_EN_REVISION` genera un mensaje al `ownerPhone` con la imagen y dos botones.
- [x] Apretar Aprobar deja la orden en `APROBADA` y el comprador recibe una confirmación.
- [x] Apretar Rechazar deja la orden en `RECHAZADA` y el comprador recibe el aviso.
- [x] El test de aislamiento pasa: ningún tool devuelve ni modifica registros de otro `merchantId`.
- [x] Ningún log contiene `ZAVU_API_KEY`, `ANTHROPIC_API_KEY`, `ZAVU_OPERATOR_WEBHOOK_SECRET` ni `zavuSenderWebhookSecret` en claro.

---

## 6 — Decisiones tomadas y descartadas

- **Sí:** Zavu como capa de mensajería. Sus *Partner Invitations* resuelven el "inscribirse con un botón". Es la parte del problema que no vale la pena construir para validar una hipótesis comercial.
- **Sí (con reserva a confirmar con tráfico real):** verificar las llamadas a Agent Tools con la misma función `verifyZavuSignature` (esquema v2, `t.body`) que los webhooks de evento, usando un secreto fijo propio (`ZAVU_TOOLS_WEBHOOK_SECRET`) en vez de uno por sender. La doc de Zavu para tool calls es más pobre que la de webhooks de evento: describe el mismo esquema HMAC pero también menciona un header separado `X-Zavu-Timestamp` que no aparece en la doc de webhooks normales, sin un ejemplo de código que lo resuelva. Se avanzó con la lectura más simple y consistente con el resto de la plataforma; queda pendiente confirmarlo contra una llamada real de Zavu apenas haya una cuenta activa, y si no coincide el arreglo es puntual (una sola función).
- **Sí:** resolver el secreto de firma del webhook por `senderId`, no con un único secreto global. Confirmado leyendo los tipos del SDK: `Sender.webhook.secret` es propio de cada sender y solo se devuelve al crearlo o regenerarlo (`regenerateWebhookSecret`); no existe un secreto de proyecto. El número operador (único, fijo) guarda el suyo en env; cada sender de comercio guarda el suyo en `Merchant.zavuSenderWebhookSecret`, configurado en el paso 6 al activarse.
- **No:** aislar cada comercio en su propia *Sub-Account* de Zavu. Se investigó durante la implementación (paso 3): la API de `invitations.create` no acepta ningún identificador de sub-cuenta, y la documentación de Zavu no confirma un flujo donde el sender resultante nazca ya aislado dentro de la sub-cuenta del comercio — solo que una sub-cuenta *"is a fully isolated project with its own API keys, senders..."*, sin un ejemplo que lo conecte con `invitations.create`. Ir por ahí hubiera significado apostar la arquitectura entera a una inferencia no verificada. Se descartó a favor de una sola cuenta principal de Zavu compartida por todos los comercios, con el aislamiento real puesto donde sí se puede verificar: el `merchantId` en cada consulta a Postgres (paso 20).
- **No:** WhatsApp Cloud API de Meta directo. Habría que construir embedded signup, gestión de tokens por comercio y reintentos. Semanas de trabajo que no responden la pregunta del MVP.
- **No:** Evolution API o Baileys. Sin costo, pero un ban de Meta mata el experimento y los datos que produzca.
- **Sí:** un número de WhatsApp por comercio, vía embedded signup. Con Zavu deja de ser caro, y el comprador ve la marca del comercio y no la de Zavu.
- **Sí:** un segundo número operador compartido, propiedad de Zavu. Forzado por la restricción de que el dueño no puede escribirle a su propio número. La alternativa era un panel web, que contradice la decisión de administrar todo por WhatsApp.
- **Sí:** backend propio Node/TypeScript con Postgres como fuente de verdad. Permite el test de aislamiento multi-tenant, consultas reales sobre las órdenes y no ata los datos al runtime de Zavu.
- **No:** todo en Zavu Functions. Más rápido de arrancar, pero deja los datos del negocio en la Memory API de un tercero y hace más difícil verificar el aislamiento entre comercios.
- **Sí:** extracción del menú por foto con Claude y salida estructurada. Es el mayor diferencial percibido del onboarding y la razón por la que un comercio prueba el producto.
- **Sí:** paso de confirmación humana obligatorio antes de persistir el catálogo extraído. La extracción va a fallar con menús mal fotografiados; publicar precios equivocados es peor que pedir una confirmación.
- **Sí:** precio en USD y total también en Bs con tasa fijada por el comercio. Es cómo el mercado venezolano piensa los precios, y evita que el comercio reedite el menú entero cada vez que se mueve la tasa.
- **No:** tasa Bs/USD automática desde una fuente externa. Agrega una dependencia y una discusión sobre qué tasa es la correcta, sin ayudar a validar la hipótesis.
- **Sí:** congelar tasa y precios en la orden. Sin esto, la revisión manual del comprobante compara contra un total que se movió.
- **Sí:** datos de cobro como texto libre. Cubre Pago Móvil, transferencia y cualquier variante sin modelar el sistema bancario venezolano.
- **No:** pasarela de pago con confirmación automática. El chequeo manual es un pedido explícito, y es además la forma más barata de tener a un humano mirando las primeras transacciones reales.
- **No:** lectura del comprobante con IA para pre-validar el monto. Buena idea, pero es una optimización de la cola, no parte de la hipótesis. Va en su propio spec.
- **Sí:** revisión por WhatsApp con botones. Cero panel, cero login, y el comercio ya vive en WhatsApp.
- **Sí:** catálogo plano sin variantes ni stock. Es lo máximo que una extracción por foto llena de forma confiable y lo mínimo para vender.
- **Sí:** el carrito es una `Order` en `BORRADOR`. Una estructura menos y el historial de carritos abandonados queda gratis.
- **Sí:** resolver el `merchantId` desde el `senderId` del evento firmado, nunca desde los argumentos que manda el modelo. Un prompt injection en un mensaje de comprador no debe poder alcanzar los datos de otro comercio.
- **Sí:** el agente operador (`triggerOnMessageTypes: ["text", "interactive"]`) no responde a mensajes de imagen/documento. Las fotos y PDF de menú los procesa exclusivamente nuestro propio webhook con extracción por Claude vision (paso 9); si el agente conversacional también reaccionara a esos mensajes, el comercio recibiría dos respuestas para la misma foto.
- **Sí:** descargar nosotros mismos el archivo del menú (fetch + base64) en vez de pasarle la URL de Zavu directamente a Anthropic. La doc de Zavu no garantiza que esa URL sea alcanzable desde fuera ni cuánto dura vigente; descargarla apenas llega evita depender de eso.
- **Sí:** la plantilla `pago_en_revision` es solo un aviso, sin botones. Un botón `quick_reply` de plantilla de Meta tiene un payload **fijo por plantilla**, no dinámico por envío — no puede llevar el `orderId` como sí lo lleva el *button message* libre (paso 17). Los botones Aprobar/Rechazar de siempre se mandan cuando el comercio responde y la ventana de 24h se reabre. Decidido con el usuario tras identificar la limitación técnica; la alternativa (un botón de URL dinámico a una página web) queda fuera de alcance de este MVP.
- **Sí:** detectar si la ventana de 24h está abierta con una heurística best-effort (`conversations.list`, último mensaje del hilo): si el último mensaje fue del contacto hace menos de 24h, se asume abierta; cualquier otro caso —incluido un error de red— se trata como cerrada. Es la opción segura que nunca intenta un mensaje libre que WhatsApp rechazaría; no hay forma de confirmar que esta heurística es exacta sin una cuenta real de Zavu conectada.
- **No:** reenviar automáticamente los botones Aprobar/Rechazar apenas el comercio responde tras recibir la plantilla. Requeriría guardar qué mensaje saliente corresponde a qué aviso pendiente (Meta entrega el error de ventana cerrada de forma asíncrona, no en la respuesta síncrona de `send`), lo que es modelo nuevo no contemplado en la sección 3. Queda como limitación conocida (ver riesgos) para otro spec si en la práctica hace falta.
- **Sí:** el botón Aprobar/Rechazar lleva el `orderId` incrustado en su `id` (`aprobar_<id>`/`rechazar_<id>`, fijado por nosotros al mandarlo, paso 17), pero antes de aplicar la decisión se verifica que quien escribe (`from` del webhook, autenticado por WhatsApp/Zavu) sea efectivamente el `ownerPhone` del comercio dueño de esa orden. Sin este chequeo, cualquiera que le escriba al número operador y consiga el id de un botón ajeno podría aprobar o rechazar el pedido de otro comercio — el mismo principio de aislamiento multi-tenant que el resto del spec, aplicado acá.
- **Sí:** el gate técnico duro de "no vender sin tasa ni datos de cobro" (prometido en el paso 11) vive en `cerrar_orden` (paso 15), que es el único punto donde de verdad hay algo que bloquear. `cerrar_orden` también se niega si el carrito está vacío, si no se definió retiro/delivery, o si es delivery sin ubicación compartida todavía — sin esto, "cerrar" un pedido incompleto dejaría una orden que nadie puede entregar.
- **Sí:** las tools del agente vendedor (`buscar_productos` y las que siguen) identifican el comercio por el `merchantId` incrustado en la URL de **esa copia puntual** de la tool, fijada por nuestro backend al crearla — nunca por `contactPhone`. A diferencia de las tools del operador, acá quien llama es el comprador, no el dueño: `contactPhone` identifica al comprador, no al comercio. Cada comercio tiene su propia copia de cada tool de venta (se crean junto con el agente vendedor, paso 7), todas apuntando al mismo endpoint pero con un `?merchantId=` distinto — así la identidad nunca depende de nada que el modelo genere.
- **Sí:** `editar_producto` corrige un ítem dentro del `MenuImport.extracted` (el borrador todavía sin confirmar), no un `Product` ya persistido. Es lo mínimo que la prueba manual del paso 10 pide ("corregir un precio por chat y confirmar"); editar un producto ya confirmado y en venta es un caso distinto (¿qué pasa con órdenes que ya lo referencian?) que no hace falta resolver para validar el onboarding y queda para otro spec si se necesita.
- **Sí:** hacer polling acotado (`messages.retrieve`, hasta 5 intentos cada 1.5s) cuando el webhook trae `mediaId` pero todavía no `mediaUrl`. La doc de Zavu confirma que `mediaUrl` "reemplaza" a `mediaId` en "lecturas posteriores del mensaje" pero no da un tiempo ni un evento de "medio listo" — polling acotado con timeout explícito es la única opción sin inventar una garantía que la doc no da.

---

## 7 — Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Ventana de 24 h de WhatsApp cerrada al querer avisarle al comercio de un pago | Plantilla `pago_en_revision` aprobada por Meta (paso 19), con fallback a mensaje libre si la ventana está abierta |
| La extracción del menú devuelve precios equivocados | Confirmación humana obligatoria antes de persistir; el `MenuImport` guarda el JSON crudo para poder auditar el error |
| Prompt injection desde un mensaje de comprador intentando leer otro comercio | El `merchantId` sale del `senderId` del webhook firmado, nunca del body del tool; test de aislamiento en el paso 20 |
| El comprador manda una imagen que no es un comprobante | Se guarda igual como `PaymentProof` y el humano lo rechaza. No se intenta validar automáticamente en este MVP |
| El comercio nunca aprueba y la orden queda colgada en `PAGO_EN_REVISION` | Fuera de alcance resolverlo automáticamente. El estado es consultable y visible; el recordatorio va en otro spec |
| La aprobación de Meta del embedded signup demora y frena las pruebas | Arrancar el trámite en paralelo al paso 1, no al paso 5 |
| Dos compradores del mismo comercio confunden sus carritos | Índice único lógico por `(merchantId, buyerPhone, status = BORRADOR)`, verificado en el paso 13 |
| El `ownerPhone` cambia de dueño o el dueño escribe desde otro número | El operador no lo reconoce y ofrece el link de registro. Recuperar acceso queda fuera de alcance |
| Sin Sub-Accounts de Zavu, todos los senders y agentes viven en una única cuenta de Zavu | El aislamiento entre comercios recae por completo en filtrar por `merchantId` en Postgres (nunca en la cuenta de Zavu); el test del paso 20 es lo que lo hace verificable |
| La tasa cargada por el comercio queda vieja y el comprador paga de menos | `vesRateUpdatedAt` queda registrado; avisar por antigüedad va en otro spec |
| La plantilla `pago_en_revision` tarda en ser aprobada por Meta (horas o días), y hasta entonces enviarla falla | Arrancar el trámite de aprobación apenas exista una cuenta real de Zavu, no esperar al final del proyecto |
| Con la ventana cerrada, el comercio recibe el aviso por plantilla pero los botones Aprobar/Rechazar no se reenvían solos cuando responde | Limitación conocida y aceptada para este MVP (ver decisión en sección 6); requeriría guardar qué aviso quedó pendiente, que es modelo nuevo |

---

## Lo que **no** está en este spec

- Panel web, tanto del comercio como interno de Zavu.
- Variantes, modificadores, categorías y stock.
- Pasarelas de pago y confirmación automática.
- Lectura con IA del comprobante para pre-validar el monto.
- Costo de envío y logística de delivery.
- Tasa Bs/USD automática.
- Multi-idioma, horarios de atención, broadcasts y remarketing.
- Canales que no sean WhatsApp.
- Facturación del comercio hacia Zavu.

Cada uno de ellos, si entra, va en su propio spec.
