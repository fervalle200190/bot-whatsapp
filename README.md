# Zavu MVP — Ventas por WhatsApp multi-tenant

MVP para validar que un comercio puede inscribirse apretando un botón, cargar su menú con una foto y vender por WhatsApp con un agente de IA, dejando cada pago en una cola de aprobación manual.

Spec completa: [specs/01-mvp-ventas-whatsapp-multitenant.md](specs/01-mvp-ventas-whatsapp-multitenant.md) — léela primero si necesitás el porqué de las decisiones, no solo el qué.

---

## 1. Requisitos

- Node 20+
- pnpm
- Docker (para Postgres local)
- Una cuenta de [Zavu](https://zavu.dev) con API key
- Una API key de Anthropic

---

## 2. Poner el proyecto a andar en local (sin WhatsApp real todavía)

Esto te deja el server corriendo y la base migrada. Sirve para tocar el código, correr los tests, y probar los endpoints de tools "a mano" con curl — pero **sin** un WhatsApp real conectado, porque eso requiere los pasos de la sección 3.

```bash
pnpm install
docker compose up -d
cp .env.example .env
```

Completá `.env` con al menos:
- `ZAVU_API_KEY` (real, aunque sea de una cuenta de prueba)
- `ANTHROPIC_API_KEY` (real)
- El resto de las variables (`ZAVU_OPERATOR_SENDER_ID`, `ZAVU_OPERATOR_WEBHOOK_SECRET`, `ZAVU_TOOLS_WEBHOOK_SECRET`, `ZAVU_PAGO_EN_REVISION_TEMPLATE_ID`) podés dejarlas con cualquier valor no vacío por ahora — se completan de verdad en la sección 3.

```bash
pnpm exec prisma migrate dev --name init
pnpm prisma:seed
pnpm dev
```

Verificá que levantó:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

Corré la suite de tests (necesita Postgres arriba, por el test de aislamiento del paso 20):

```bash
pnpm test
pnpm typecheck
pnpm build
```

---

## 3. Conectar un WhatsApp real (necesario para probar el flujo completo)

Nada de esto se pudo probar en el desarrollo de este MVP por no tener una cuenta de Zavu real ni un WhatsApp Business conectado — son los pasos que hacen falta correr una sola vez, en orden, antes de que un comercio de verdad pueda usar esto.

### 3.1. Exponer tu servidor a internet

Zavu necesita mandarte webhooks por HTTPS. En desarrollo, usá un túnel (ej. `ngrok http 3000`) y poné esa URL en `PUBLIC_BASE_URL` de tu `.env`. En producción, es la URL real de tu deploy.

### 3.2. Crear el número operador (100% manual, no hay API para esto)

1. Entrá al [dashboard de Zavu](https://dashboard.zavu.dev).
2. Creá un sender nuevo.
3. En ese sender, andá a **Channels → WhatsApp → Add → Use my own phone number**, y conectá un número que pueda recibir SMS y que no esté ya en WhatsApp/WhatsApp Business.
4. Copiá el `senderId` de ese sender y ponelo en `ZAVU_OPERATOR_SENDER_ID` en `.env`.

### 3.3. Terminar de configurar el operador (esto sí es automatizable)

Con el servidor corriendo y `PUBLIC_BASE_URL` apuntando a tu túnel/deploy:

```bash
pnpm exec tsx scripts/setup-operador.ts
```

Esto configura el webhook del sender operador, genera su secreto, crea el agente de IA del operador, y crea sus 4 tools (`identificar_comercio`, `confirmar_menu`, `editar_producto`, `actualizar_tasa`, `guardar_datos_cobro`). El script imprime el secreto nuevo — pegalo en `ZAVU_OPERATOR_WEBHOOK_SECRET` y reiniciá el server.

### 3.4. Crear y enviar a aprobación la plantilla de WhatsApp

```bash
pnpm exec tsx scripts/setup-template-pago-en-revision.ts
```

Pegá el `id` que imprime en `ZAVU_PAGO_EN_REVISION_TEMPLATE_ID`. La plantilla queda en estado `pending` — **la aprobación de Meta puede tardar horas o días**. Hasta que Meta la apruebe, avisar a un comercio fuera de la ventana de 24h (paso 19 del spec) va a fallar; dentro de la ventana funciona igual sin depender de la plantilla.

### 3.5. Probar el alta de un comercio real

1. Abrí `PUBLIC_BASE_URL/registro` en el navegador.
2. Completá nombre del comercio y tu WhatsApp real.
3. Te va a redirigir al embedded signup de Meta — conectá un WhatsApp Business real de prueba (puede ser un número de prueba de Meta si tenés uno, o cualquier número que puedas usar para testear).
4. Al completarse, el webhook `invitation.status_changed` activa el comercio: crea su agente vendedor y sus tools de venta (`buscar_productos`, `agregar_al_carrito`, `ver_carrito`, `definir_entrega`, `cerrar_orden`) automáticamente — no hay que correr nada a mano para esto.

A partir de acá, escribile al número operador (para cargar menú/tasa/cobro) y al número del comercio recién conectado (para probar la venta) desde WhatsApp de verdad.

---

## 4. Qué está probado y qué falta probar en vivo

Todo el código pasa `pnpm typecheck`, `pnpm test` (30 tests) y `pnpm build`. Durante el desarrollo se verificó en vivo, contra Postgres real y HTTP real (sin mocks), lo siguiente:

- Firma de webhooks (válida/inválida, por sender y por tool) — pasos 4, 8, 14, 16, 18.
- Alta de un `Merchant` y manejo de fallos externos sin dejar filas huérfanas — paso 5.
- Extracción, confirmación y corrección del menú, con el catálogo final correcto en Postgres — pasos 9, 10.
- Tasa Bs/USD y datos de cobro — paso 11.
- Catálogo, carrito y aislamiento entre dos comercios reales corriendo en paralelo — pasos 12, 13, 20.
- Entrega (retiro/delivery) y guardado de coordenadas — paso 14.
- Cierre de orden con congelamiento de totales (incluida la prueba de que cambiar la tasa después no mueve una orden ya cerrada) — paso 15.
- Comprobante de pago y cola de revisión — pasos 16, 17.
- Decisión Aprobar/Rechazar, **incluida la verificación de que solo el dueño de esa orden puntual puede decidir sobre ella** — paso 18.
- Que ningún log exponga `ZAVU_API_KEY`, `ANTHROPIC_API_KEY`, ni los secretos de webhook.

### Lo que NO se pudo probar en este entorno (sin cuenta de Zavu ni WhatsApp reales)

No es una falla de la implementación: son pasos que necesitan credenciales reales que este entorno de desarrollo no tenía. Quedaron verificados por lógica y tests unitarios con mocks, pero no de punta a punta:

- **Que el agente vendedor realmente responda un saludo** al escribirle al número de un comercio recién conectado (paso 7). El código que lo crea está probado; la respuesta real del agente de IA de Zavu no.
- **Que el embedded signup de Meta funcione tal cual** — se probó el flujo hasta la llamada a `invitations.create`, que rechazó la API key de prueba con un error real de Zavu (`401 Invalid API key format`), confirmando que el código llega bien hasta ahí.
- **La extracción real de un menú fotografiado** con Claude — la lógica está probada con mocks; nunca se le mandó una foto real a la API de Anthropic desde este flujo.
- **La entrega real de mensajes de WhatsApp** (saludos, resúmenes de carrito, pedido de ubicación, aviso de comprobante, botones Aprobar/Rechazar, confirmaciones al comprador) — todas estas llamadas a `messages.send` se probaron hasta el punto de fallar contra la API real de Zavu con la key de prueba; el contenido exacto de cada mensaje está confirmado por tests unitarios, pero ninguna llegó de verdad a un WhatsApp.
- **La aprobación real de Meta de la plantilla `pago_en_revision`** — depende de Meta, puede tardar días, y no hay forma de apurarla ni simularla.
- **El fallback de ventana de 24h** (paso 19) — la heurística que decide si la ventana está abierta o cerrada (`conversations.list`) nunca se ejecutó contra datos reales; quedó documentada como limitación conocida en el spec (sección 6).
- **Reenvío automático de los botones Aprobar/Rechazar** cuando la ventana estaba cerrada y el comercio responde a la plantilla — deliberadamente no se construyó (ver spec, decisión en sección 6); hoy hay que aprobar/rechazar manualmente si esto pasa.

### Cómo terminar de validar esto

1. Seguí la sección 3 de este README con una cuenta de Zavu real.
2. Conectá dos comercios de prueba (dos WhatsApp Business distintos) para volver a probar el aislamiento multi-tenant con tráfico real, no solo con el test automatizado.
3. Hacé una compra de punta a punta: cargar menú por foto → confirmar → comprar → elegir delivery → compartir ubicación → cerrar orden → mandar comprobante → aprobar desde el número operador.
4. Mirá los logs del server mientras lo hacés — todo queda registrado con `req.log`, incluidos los `error` cuando algo externo falla.
