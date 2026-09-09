# SPEC 03 — Canal Meta Cloud API + agente vendedor en n8n

> **Estado:** Aprobado
> **Depende de:** SPEC 01, SPEC 02
> **Fecha:** 2026-09-08
> **Objetivo:** Conectar el backend NestJS del SPEC 02 a WhatsApp directo por la Cloud API de Meta y delegar la conversación de venta a un workflow de n8n self-hosted, sin número operador y sin cambiar las reglas de negocio ni el aislamiento multi-tenant.

---

## 1 — Por qué existe este spec

El SPEC 01 delegó en un proveedor intermedio tres cosas: el canal de WhatsApp con *embedded signup*, el agente de IA hosteado y los webhooks. Aparecieron límites que no valen el costo para un MVP y el onboarding automático nunca se pudo probar. Se toman tres decisiones que dejan a ese intermediario sin nada que aportar:

- **Abandonar el onboarding automático.** El alta de comercios pasa a ser manual (SPEC 05).
- **Eliminar el número operador.** Toda la administración del comercio pasa a un panel web (API en SPEC 04, SPA en repo separado). Con eso desaparecen la segunda superficie de chat, la plantilla de Meta y la ventana de 24h con el dueño: el único interlocutor del bot es el comprador, que siempre está dentro de su propia ventana porque acaba de escribir.
- **Meta WhatsApp Cloud API directa + n8n Community Edition self-hosted.** Cloud API es gratis en mensajes de conversación (solo cobra plantillas), sin markup; se descartó Twilio por su costo de $0,005 por mensaje en ambas direcciones. n8n Cloud no tiene tier gratuito (trial 14 días; Starter $20–24/mes por 2.500 ejecuciones); self-hosted no tiene límite.

El backend del SPEC 02 ya tiene el núcleo de negocio, las tools con secreto compartido y un `MessagingPort` vacío. Este spec le pone el canal: un módulo de Meta que implementa ese puerto y recibe webhooks, y un módulo de n8n que resuelve la conversación.

### Modelo de Meta: una sola WABA nuestra

Todos los números de venta viven en **una única WhatsApp Business Account nuestra**: un token permanente de *system user*, una app, un webhook. Cada comercio se identifica por el `phone_number_id` que Meta pone en cada evento. Una WABA nueva admite 2 números; tras la verificación de negocio de Meta sube a 20; más de 20 requiere pedírselo a Meta.

---

## 2 — Alcance

**Dentro:**

- Servicio `n8n` en el `docker-compose.yml` existente, usando el mismo Postgres (base `n8n` separada) para su estado y para la memoria de chat.
- `MetaModule`: `MetaMessagingService` (implementa `MessagingPort`: `sendText`, `sendLocationRequest`, más `downloadMedia`), `MetaSignatureGuard` (`X-Hub-Signature-256` con el app secret, comparación en tiempo constante), `WebhooksController` (`GET /webhooks/meta` para el challenge, `POST /webhooks/meta`), y `MetaPayloadParser`.
- Ruteo de cada evento por `phone_number_id` → `Merchant.metaPhoneNumberId`; desconocido → `200` e ignorar. `200` inmediato tras verificar la firma; el procesamiento sigue después.
- `N8nModule`: `N8nAgentService.ask({ merchantId, contactPhone, text, systemPrompt })` → `reply`, con header `X-N8N-Secret`.
- Un único workflow exportado en `n8n/workflows/agente-vendedor.json`: Webhook (auth por header) → AI Agent (Anthropic `claude-opus-5`, Postgres Chat Memory con `sessionKey = merchantId:contactPhone`) → cinco tools HTTP hacia `/tools/*` del backend con `X-Tools-Secret` y `merchantId`/`contactPhone` como expresiones fijas al trigger → Respond to Webhook `{ reply }`.
- El prompt del vendedor vive en `src/messaging/prompts.ts` y viaja en cada llamada; el workflow no tiene texto de negocio.
- `VendorInboundService`: texto → n8n → `sendText`; ubicación → `deliveryLat/Lng` de la orden en `BORRADOR` con `DELIVERY`; imagen con orden en `ESPERANDO_PAGO` → `PaymentProof` + `PAGO_EN_REVISION` + acuse al comprador. **Nadie más recibe aviso.**
- Descarte de eventos repetidos por `messageId` (memoria en proceso con TTL corto).
- `Merchant.metaPhoneNumberId` y `metaDisplayPhone`.
- Tests: guard de firma, parser de payload, `MetaMessagingService` con `fetch` mockeado, `N8nAgentService` con `fetch` mockeado, `VendorInboundService` con puertos mockeados por DI.
- README: levantar n8n, importar el workflow, credencial de Anthropic en n8n, webhook de Meta.

**Fuera de alcance (para specs futuros):**

- API del panel: aceptar/rechazar pedidos, tasa, cobro, polling — **SPEC 04**.
- El SPA (repo separado, spec propio).
- Alta manual de comercio, número, menú, tasa y cobro iniciales — **SPEC 05**.
- Carga o edición del menú por cualquier vía.
- Avisos proactivos al dueño por WhatsApp; plantillas de Meta; ventana de 24h.
- Embedded signup. Más de 20 comercios. Alta disponibilidad de n8n. Exponer n8n a internet.
- Cambios a las reglas de negocio.

---

## 3 — Modelo de datos

Solo cambia `Merchant`:

```ts
@Column({ type: "varchar", nullable: true, unique: true }) metaPhoneNumberId: string | null;  // phone_number_id de Meta; se llena en el alta manual (SPEC 05)
@Column({ type: "varchar", nullable: true }) metaDisplayPhone: string | null;                 // E.164 legible, informativo
```

n8n administra sus propias tablas (estado y memoria de chat) en la base `n8n`, fuera de TypeORM. La memoria queda aislada por comercio por construcción de la clave `merchantId:contactPhone`.

### Variables de entorno nuevas

| Variable | Qué es |
| --- | --- |
| `META_GRAPH_VERSION` | p. ej. `v21.0` |
| `META_ACCESS_TOKEN` | token permanente de system user de la WABA |
| `META_APP_SECRET` | para `X-Hub-Signature-256` |
| `META_VERIFY_TOKEN` | el del `GET` de suscripción |
| `N8N_WEBHOOK_BASE_URL` | p. ej. `http://localhost:5678/webhook` |
| `N8N_WEBHOOK_SECRET` | header que el backend manda a n8n y n8n exige |

`ANTHROPIC_API_KEY` se carga solo como credencial en n8n, no en el backend.

### Contrato backend → n8n

```ts
// POST {N8N_WEBHOOK_BASE_URL}/agente-vendedor   Header: X-N8N-Secret
{ merchantId: string, contactPhone: string, text: string, systemPrompt: string }
// 200 → { reply: string }
```

### Contrato n8n → tools

El del SPEC 02: `POST /tools/*`, header `X-Tools-Secret`, body `{ merchantId, contactPhone, arguments }`. `merchantId` y `contactPhone` son expresiones al trigger en el workflow (`={{ $('Webhook').item.json.merchantId }}`), nunca parámetros del modelo.

### Módulos que aparecen

```
src/meta/        meta.module.ts, meta-messaging.service.ts, meta-signature.guard.ts, meta-payload.parser.ts, webhooks.controller.ts
src/n8n/         n8n.module.ts, n8n-agent.service.ts
src/messaging/   prompts.ts (buildVendorSystemPrompt), vendor-inbound.service.ts, dedupe.service.ts
n8n/workflows/   agente-vendedor.json
```

`NoopMessagingService` del SPEC 02 se reemplaza como provider de `MessagingPort` por `MetaMessagingService`; queda disponible para tests.

---

## 4 — Plan de implementación

1. **n8n en Docker.** Servicio `n8n` (`n8nio/n8n`, `DB_TYPE=postgresdb` contra el Postgres existente, base `n8n`, puerto 5678, volumen). Prueba: `http://localhost:5678` pide crear el usuario dueño.
2. **Variables de entorno.** `EnvVars` con las seis nuevas; `.env.example`.
3. **Entidad.** `metaPhoneNumberId` y `metaDisplayPhone` en `Merchant`; migración generada y commiteada; seed con un `metaPhoneNumberId` ficticio.
4. **Firma y challenge.** `MetaSignatureGuard` y el `GET` del challenge. Tests: firma válida, inválida, header ausente, challenge correcto/incorrecto.
5. **`MetaMessagingService`.** `sendText`, `sendLocationRequest`, `downloadMedia` con `fetch` contra `graph.facebook.com/{version}/{phone_number_id}/messages`; el `phone_number_id` sale del `Merchant` del `merchantId` recibido. Registrado como `MessagingPort`. Tests con `fetch` mockeado.
6. **Parser.** `MetaPayloadParser`: de `entry[].changes[].value` a `{ phoneNumberId, messages: [{ messageId, from, type, text?, mediaId?, latitude?, longitude? }] }`, ignorando `statuses`. Tests con payloads reales.
7. **`N8nAgentService` y workflow.** Servicio con test (`fetch` mockeado). `agente-vendedor.json` importado por la UI y exportado al repo. Prueba manual: `curl` al webhook de n8n con un `merchantId` del seed devuelve un `reply` que nombra un producto real.
8. **`WebhooksController`.** `GET` challenge; `POST` con guard, parser, dedupe, ruteo por `phone_number_id` y despacho asíncrono a `VendorInboundService`. Prueba manual: payload firmado con el app secret del `.env` llega al servicio; firma inválida → `401`.
9. **`VendorInboundService`.** Texto → `N8nAgentService.ask` → `MessagingPort.sendText`; ubicación → orden; imagen → comprobante + acuse. Tests con `MessagingPort` y `N8nAgentService` mockeados por DI.
10. **Swagger.** Las rutas de webhook documentadas y marcadas como internas.
11. **README.** Puesta en marcha con n8n, importación del workflow, credencial de Anthropic, webhook de Meta apuntando a `PUBLIC_BASE_URL/webhooks/meta` (túnel en dev).
12. **Smoke local.** Con n8n corriendo y `ANTHROPIC_API_KEY` real cargada en n8n: un payload de Meta firmado simulando "qué venden" al número del comercio del seed produce un intento de envío por Meta cuyo texto nombra productos del seed.

---

## 5 — Criterios de aceptación

- [ ] `docker compose up -d` levanta Postgres y n8n; `http://localhost:5678` responde.
- [ ] `GET /webhooks/meta` con el `hub.verify_token` correcto devuelve el `hub.challenge` en texto plano con `200`; incorrecto → `403`.
- [ ] `POST /webhooks/meta` con firma inválida → `401` y no toca la base.
- [ ] Un evento firmado cuyo `phone_number_id` coincide con un `Merchant` se despacha a `VendorInboundService` con ese `merchantId`; uno desconocido → `200` sin efecto.
- [ ] El mismo `messageId` recibido dos veces se procesa una sola vez.
- [ ] Un texto de un comprador produce exactamente una llamada a n8n con el `merchantId` correcto y una llamada a Meta desde el `phone_number_id` de ese comercio con el `reply`.
- [ ] `agente-vendedor.json` importado sin modificaciones responde `{ reply }` a un `curl` con `X-N8N-Secret`; sin el header → `403`.
- [ ] En el workflow, `merchantId` y `contactPhone` de cada tool son expresiones al trigger.
- [ ] Una ubicación compartida guarda `deliveryLat/Lng` en la orden `BORRADOR` con `DELIVERY` del comprador correcto.
- [ ] `cerrar_orden` envía los datos de cobro por Meta desde el `phone_number_id` del comercio (a través de `MessagingPort`).
- [ ] Un comprobante en `ESPERANDO_PAGO` crea el `PaymentProof`, deja la orden en `PAGO_EN_REVISION`, envía el acuse al comprador y **no envía nada a ningún otro número**.
- [ ] `tools.isolation.spec.ts` del SPEC 02 sigue pasando sin cambios.
- [ ] Ningún log contiene `META_ACCESS_TOKEN`, `META_APP_SECRET`, `N8N_WEBHOOK_SECRET` ni `TOOLS_SHARED_SECRET` en claro.
- [ ] `bun run build` y `bun test` en verde.

---

## 6 — Decisiones tomadas y descartadas

- **Sí:** eliminar el número operador; toda la administración va al panel (SPEC 04). Se lleva consigo la plantilla de Meta, la ventana de 24h con el dueño y los botones por WhatsApp.
- **Sí:** Meta Cloud API directa. **No:** Twilio ($0,005/mensaje en ambas direcciones).
- **Sí:** n8n Community self-hosted. **No:** n8n Cloud (sin tier gratuito; workflows fuera del repo).
- **Sí:** híbrido — el backend es dueño de webhooks, firma, ruteo y envío; n8n es una función pura `mensaje → respuesta`. **No:** n8n reemplazando al backend ni enviando directo.
- **Sí:** una sola WABA nuestra (2 números sin verificar, 20 verificado). **No:** WABA por comercio antes de ese tope.
- **Sí:** un único workflow parametrizado por `merchantId` y `systemPrompt`. **No:** un workflow por comercio.
- **Sí:** prompt en el repo, viaja en cada llamada. **No:** prompt en el nodo.
- **Sí:** Postgres Chat Memory con `sessionKey = merchantId:contactPhone`. **No:** tabla propia ni memoria en RAM.
- **Sí:** `MetaMessagingService` como implementación de `MessagingPort`; `cerrar_orden` y `definir_entrega` no cambian una línea.
- **Sí:** el comprobante solo cambia estado y acusa recibo; el comercio lo ve en el panel.
- **Sí:** n8n no se expone a internet.
- **Sí:** dedupe de `messageId` en memoria con TTL. **No:** persistirlo — Meta reintenta en minutos, no en días.

---

## 7 — Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Tope de 2 números por WABA hasta verificar el negocio | Iniciar la verificación apenas exista la WABA |
| Token de Meta expira | Token permanente de system user, documentado en el README |
| Meta reintenta si no recibe `200` rápido | `200` inmediato tras la firma; procesamiento asíncrono; dedupe por `messageId` |
| Meta exige HTTPS público | Túnel en dev solo al backend; n8n no se expone |
| n8n en una sola instancia | Aceptado para el MVP |
| El AI Agent manda `arguments` inválidos | Las tools devuelven `{ error }` legible; el prompt instruye al agente |
| Un pedido queda en `PAGO_EN_REVISION` sin que el comercio lo vea | SPEC 04 lo expone con polling y sonido |

---

## Lo que **no** está en este spec

- API del panel (**SPEC 04**) y el SPA (repo separado).
- Alta manual (**SPEC 05**).
- Menú por cualquier vía. Avisos al dueño. Plantillas de Meta.
- Embedded signup, más de 20 comercios, alta disponibilidad, exponer n8n.
- Cambios a las reglas de negocio.

Cada uno de ellos, si entra, va en su propio spec.
