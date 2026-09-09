# Backend WhatsApp multi-tenant

Backend en **NestJS + TypeORM**, corriendo sobre **Bun**, con Postgres y Swagger/OpenAPI autogenerado. El canal de WhatsApp es la **Cloud API de Meta**, directa, con la conversación de venta delegada a un workflow de **n8n** self-hosted, y una **API de panel** para que el comercio administre sus pedidos, tasa y datos de cobro.

> **Estado actual:** SPEC 02 (núcleo de negocio) + SPEC 03 (canal Meta + n8n)
> + SPEC 04 (API del panel) implementados. El SPA del panel vive en otro
> repo, con su propio spec. El alta manual de comercios llega en el **SPEC 05**.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.1
- Docker + Docker Compose (para Postgres y n8n)

## Puesta en marcha

```bash
docker compose up -d   # Postgres + n8n
bun install
cp .env.example .env   # completá los secretos
bun run migration:run  # o dejá que NODE_ENV=development sincronice el esquema solo
bun run seed
bun run start:dev
```

- `GET http://localhost:3000/health` → `{ "status": "ok" }`
- `GET http://localhost:3000/docs` → Swagger UI con `/tools/*`, `/registro` y `/api/*`
- `GET http://localhost:3000/registro` → formulario de alta de comercio
- `http://localhost:5678` → n8n (crear el usuario dueño la primera vez)

En un volumen de Postgres **nuevo**, `docker/postgres-init/01-create-n8n-db.sql`
crea la base `n8n` sola. Si el volumen ya existía antes de este spec (por
ejemplo, en un entorno de desarrollo que arrancó con el SPEC 02), creála a mano una vez:

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE n8n"
```

## Variables de entorno

Ver `.env.example`. Resumen:

| Variable | Qué es |
| --- | --- |
| `NODE_ENV` | `development` sincroniza el esquema automáticamente; `production` requiere migraciones |
| `PORT` | Puerto HTTP (default `3000`) |
| `PUBLIC_BASE_URL` | URL pública del backend |
| `DATABASE_URL` | Conexión a Postgres (`bot_whatsapp`) |
| `TOOLS_SHARED_SECRET` | Secreto compartido por todas las tools de venta (`X-Tools-Secret`) |
| `META_GRAPH_VERSION` | Versión de la Graph API de Meta (p. ej. `v21.0`) |
| `META_ACCESS_TOKEN` | Token permanente de system user de la WABA |
| `META_APP_SECRET` | Para verificar `X-Hub-Signature-256` en los webhooks |
| `META_VERIFY_TOKEN` | El del `GET` de suscripción del webhook en Meta |
| `N8N_WEBHOOK_BASE_URL` | Base del webhook de n8n (p. ej. `http://localhost:5678/webhook`) |
| `N8N_WEBHOOK_SECRET` | Header que el backend manda a n8n y que el workflow exige |
| `PANEL_ORIGIN` | Origen exacto del SPA del panel, para CORS (`http://localhost:5173` en dev) |

Arrancar sin cualquiera de estas variables falla al inicio con un mensaje que
nombra la variable faltante (`ConfigModule` + `class-validator`).
`ANTHROPIC_API_KEY` **no** se carga en el backend: es una credencial dentro de n8n.

## Base de datos

- **Desarrollo** (`NODE_ENV=development`, default): TypeORM sincroniza el
  esquema automáticamente a partir de las entidades.
- **Producción** (`NODE_ENV=production`): el esquema se aplica solo con
  migraciones versionadas en `src/database/migrations/`.

```bash
bun run migration:generate -- src/database/migrations/NombreDelCambio
bun run migration:run
bun run migration:revert
```

`bun run seed` crea (upsert por `ownerPhone`, idempotente) el comercio
"Arepas La Esquina" con tres productos, tasa, datos de cobro, un
`metaPhoneNumberId` ficticio y un `panelToken` fijo para probar el panel en local:

```
Authorization: Bearer seed_panel_token_local_only
```

## Tools de venta (`POST /tools/*`)

Protegidas por el header `X-Tools-Secret: {TOOLS_SHARED_SECRET}`. La
identidad de quien llama (`merchantId`, `contactPhone`) va en el body —
**nunca** la pone el modelo, solo `arguments`:

```jsonc
// POST /tools/catalogo/buscar
{ "merchantId": "...", "contactPhone": "+58...", "arguments": { "termino": "arepa" } }
```

| Ruta | Qué hace |
| --- | --- |
| `POST /tools/catalogo/buscar` | Catálogo disponible del comercio, filtrado por término opcional |
| `POST /tools/carrito/agregar` | Agrega un producto al carrito (fusiona cantidad si ya estaba) |
| `POST /tools/carrito/ver` | Snapshot del carrito con totales en USD/Bs |
| `POST /tools/orden/entrega` | Define `RETIRO`/`DELIVERY`; con `DELIVERY` pide ubicación |
| `POST /tools/orden/cerrar` | Congela totales, pasa a `ESPERANDO_PAGO`, envía datos de cobro |

Un `arguments` inválido para la tool responde `200 { "error": "argumentos_invalidos" }`
(no `400`): la única clienta es n8n y necesita poder explicarle el error al
comprador. Un `merchantId`/`contactPhone` faltante sí responde `400`.

Sin `X-Tools-Secret` correcto → `401`.

## Canal de WhatsApp: Meta Cloud API + n8n

Una sola WhatsApp Business Account nuestra: cada comercio se identifica por
el `phone_number_id` que Meta manda en cada evento (`Merchant.metaPhoneNumberId`).

- `GET /webhooks/meta` — challenge de verificación de Meta (`hub.verify_token`).
- `POST /webhooks/meta` — eventos entrantes, protegidos por `MetaSignatureGuard`
  (`X-Hub-Signature-256` contra el body crudo). Responde `200` de inmediato;
  el procesamiento sigue en segundo plano. Un `phone_number_id` desconocido
  se ignora con `200`. El mismo `messageId` recibido dos veces se procesa una
  sola vez (`DedupeService`, TTL corto en memoria).
- Texto del comprador → `N8nAgentService.ask(...)` (workflow de n8n) → la
  respuesta se envía por `MetaMessagingService.sendText`.
- Ubicación compartida → se guarda en la orden `BORRADOR` con `DELIVERY` del
  comprador.
- Imagen con una orden en `ESPERANDO_PAGO` → se crea el `PaymentProof`
  (referenciando el `mediaId` de Meta, no una URL: las de Meta expiran), la
  orden pasa a `PAGO_EN_REVISION` y se le acusa recibo al comprador. Nadie
  más recibe aviso — el comercio lo ve en el panel.

### Poner en marcha n8n

1. Abrí `http://localhost:5678` y creá el usuario dueño.
2. Cargá una credencial **Anthropic** con tu `ANTHROPIC_API_KEY`.
3. Cargá una credencial **Postgres** apuntando a la misma base `n8n` del
   `docker-compose.yml`, para la memoria de chat.
4. Cargá una credencial **Header Auth** para el nodo Webhook: header
   `X-N8N-Secret`, valor = tu `N8N_WEBHOOK_SECRET`.
5. Importá `n8n/workflows/agente-vendedor.json` desde la UI (Import from File).
6. En los nodos HTTP Request de las tools, las expresiones usan
   `$env.BACKEND_BASE_URL` y `$env.TOOLS_SHARED_SECRET`: definilas como
   variables de entorno del contenedor de n8n (o reemplazalas por los
   valores fijos de tu entorno al importar).
7. Activá el workflow.

> El JSON del workflow se versiona tal cual se exporta desde la UI; los tipos
> de nodo de n8n cambian de versión en versión, así que si algo no importa
> limpio, es más rápido rehacer el nodo en la UI y reexportar que pelearse
> con el JSON a mano.

### Contrato backend → n8n

```jsonc
// POST {N8N_WEBHOOK_BASE_URL}/agente-vendedor   Header: X-N8N-Secret
{ "merchantId": "...", "contactPhone": "+58...", "text": "...", "systemPrompt": "..." }
// 200 → { "reply": "..." }
```

El prompt del vendedor vive en [`src/messaging/prompts.ts`](src/messaging/prompts.ts)
y viaja en cada llamada; el workflow no tiene texto de negocio.

## API del panel del comercio (`/api/*`)

Pensada para que la consuma un SPA en otro repo. Autenticada por link
secreto permanente (`Merchant.panelToken`), como `Authorization: Bearer <token>`.
CORS restringido a `PANEL_ORIGIN`. El contrato completo (DTOs de request y
response) está publicado en `/docs`.

| Ruta | Qué hace |
| --- | --- |
| `GET /api/me` | Datos del comercio del token |
| `GET /api/ordenes?desde=<ISO>` | Pedidos en `PAGO_EN_REVISION`/`APROBADA`/`RECHAZADA`, con ítems, totales y comprobante; `desde` filtra por `updatedAt` para el polling del SPA (cada 10s) |
| `GET /api/ordenes/:id/comprobante` | La imagen del comprobante, descargada de Meta al momento (`MetaMessagingService.downloadMedia`) |
| `POST /api/ordenes/:id/aceptar` | Aprueba pago y pedido en una sola decisión; avisa al comprador por WhatsApp |
| `POST /api/ordenes/:id/rechazar` | Rechaza; avisa al comprador |
| `PUT /api/tasa` | Actualiza `vesRate` del comercio del token |
| `PUT /api/cobro` | Actualiza `payoutInstructions` del comercio del token |
| `POST /api/token/regenerar` | El token viejo deja de servir al instante |

- Sin `Authorization` o con un token inexistente → `401`.
- `aceptar`/`rechazar` fuera de `PAGO_EN_REVISION` → `409`; con el token de
  otro comercio (pedido ajeno) → `404`. Ninguno de los dos cambia nada.
- El aviso al comprador usa `safeSend`: si Meta falla o está fuera de la
  ventana de 24h, se loguea pero la decisión queda aplicada igual.
- `OrderDecisionService.decideOrder` es un servicio puro (sin acoplarse a
  HTTP) — orden + comprobante se actualizan en una sola transacción.

## Arquitectura de módulos

```
src/
  main.ts                bootstrap, ValidationPipe global, rawBody (para el guard de Meta), CORS, Swagger en /docs
  app.module.ts
  config/                validación de variables de entorno
  database/              TypeORM data-source (CLI), migrations/, seed
  common/                id (cuid2), transformer numeric ↔ number, safeSend
  merchants/              Merchant + MerchantsService
  catalog/                Product, MenuImport + CatalogService
  orders/                 Order, OrderItem, PaymentProof + CartService + OrdersService + OrderDecisionService
  tools/                  ToolsController, guard de secreto, DTOs
  registro/               RegistroController (HTML)
  messaging/              MessagingPort, VendorInboundService, DedupeService, prompts, MessagingModule
  meta/                   MetaMessagingService, MetaSignatureGuard, MetaPayloadParser, WebhooksController
  n8n/                    N8nAgentService
  panel/                  PanelController, PanelTokenGuard, PanelTokenService, order.serializer, DTOs
  health/
n8n/
  workflows/agente-vendedor.json
docker/
  postgres-init/          crea la base `n8n` en un volumen nuevo
test/
  orders/cart.service.spec.ts
  orders/orders.service.spec.ts
  tools/tools.isolation.spec.ts         ← contra Postgres real
  meta/meta-signature.guard.spec.ts
  meta/meta-payload.parser.spec.ts
  meta/meta-messaging.service.spec.ts   ← fetch mockeado
  n8n/n8n-agent.service.spec.ts         ← fetch mockeado
  messaging/vendor-inbound.service.spec.ts
  panel/api.isolation.spec.ts           ← contra Postgres real
```

`NoopMessagingService` (SPEC 02) sigue en el repo — sirve para tests y para
correr sin credenciales de Meta — pero ya no es el provider activo de
`MessagingPort`; `MetaMessagingService` lo reemplazó.

## Tests

```bash
bun test
```

Los dos tests de aislamiento (`tools/tools.isolation.spec.ts` y
`panel/api.isolation.spec.ts`) corren contra Postgres real, sin mockear la
base: dos comercios con datos cruzados; fallan si cualquier ruta devuelve o
modifica algo de otro `merchantId`. Sí mockean `fetch` global para no llamar
a Meta de verdad.

## Lo que no está en este spec

- El SPA del panel (repo separado, spec propio).
- Menú: carga, extracción, edición — decisión explícita del usuario.
- Alta manual de comercios y su número, entrega del QR del panel (**SPEC 05**).
- Avisos al dueño por WhatsApp, email o push fuera del panel.
- Pedidos en `BORRADOR`/`ESPERANDO_PAGO` en el panel; cancelaciones,
  reembolsos, multiusuario, roles, auditoría, rate limiting del token.
- Embedded signup, más de 20 comercios, alta disponibilidad de n8n, exponer n8n a internet.
- Extracción de menú con IA, operador, integración con el proveedor de
  mensajería anterior: no se portan.
