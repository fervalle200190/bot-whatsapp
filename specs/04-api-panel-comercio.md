# SPEC 04 — API del panel del comercio

> **Estado:** Aprobado
> **Depende de:** SPEC 01, SPEC 02, SPEC 03
> **Fecha:** 2026-09-08
> **Objetivo:** Exponer en el backend NestJS una API REST autenticada por link secreto, documentada con Swagger, para que un SPA (repo separado) le muestre al comercio sus pedidos con comprobante, le permita aceptarlos o rechazarlos, y le deje actualizar su tasa y sus datos de cobro.

---

## 1 — Por qué existe este spec

El SPEC 03 elimina el número operador, así que el comercio ya no tiene dónde aprobar un pago ni cambiar su tasa. Este spec pone esa administración en una API que consumirá un SPA en React + Vite que vive en **otro repositorio**, con su propio spec. Acá se define solo el lado del backend: autenticación, endpoints, contrato JSON, CORS y el mecanismo de "pedido nuevo" que el SPA usa para sonar. El contrato lo publica Swagger en `/docs`: el repo del SPA lo consume desde ahí, no desde este documento.

---

## 2 — Alcance

**Dentro:**

- `Merchant.panelToken`: token secreto permanente por comercio, generado en el alta manual (SPEC 05). Viaja como `Authorization: Bearer <token>`; el SPA lo recibe en la URL que el comercio abre desde un QR o link.
- `PanelModule` bajo `/api`: `PanelTokenGuard` que resuelve el `Merchant` y lo deja en la request; toda consulta posterior filtra por ese `merchantId`.
- `GET /api/me`.
- `GET /api/ordenes?desde=<ISO>`: pedidos en `PAGO_EN_REVISION`, `APROBADA` o `RECHAZADA` con ítems, totales congelados, entrega, coordenadas y último comprobante; `desde` filtra por `updatedAt` para el polling cada 10s del SPA. Devuelve `ahora`.
- `GET /api/ordenes/:id/comprobante`: la imagen, descargada de Meta con `downloadMedia` y reenviada por el backend.
- `POST /api/ordenes/:id/aceptar` y `/rechazar`: una sola decisión que cubre pago y pedido; actualiza orden y comprobante en una transacción y avisa al comprador por `MessagingPort` desde el número del comercio.
- `PUT /api/tasa` y `PUT /api/cobro`, mismas validaciones que las tools homónimas del SPEC 01.
- `POST /api/token/regenerar`.
- CORS restringido a `PANEL_ORIGIN`.
- Swagger: todas las rutas `/api/*` con DTOs de request y response y el esquema Bearer.
- Test de aislamiento del panel: un token no ve ni modifica nada de otro comercio.

**Fuera de alcance:**

- El SPA (pantallas, sonido, QR): repo separado.
- Menú: carga, extracción, edición. Decisión explícita del usuario.
- Alta del comercio y entrega del QR — **SPEC 05**.
- Avisos al dueño por WhatsApp, email o push.
- Pedidos en `BORRADOR` o `ESPERANDO_PAGO`; cancelaciones, reembolsos, notas.
- Multiusuario, roles, auditoría, rate limiting del token.

---

## 3 — Modelo de datos

```ts
@Column({ type: "varchar", nullable: true, unique: true }) panelToken: string | null;  // 32 bytes aleatorios base64url; null hasta el alta manual
```

### Variable de entorno

| `PANEL_ORIGIN` | origen exacto del SPA para CORS (`http://localhost:5173` en dev) |
| --- | --- |

### Contrato (publicado también en `/docs`)

```ts
// GET /api/me → { id, name, metaDisplayPhone, vesRate: number|null, payoutInstructions: string|null }

// GET /api/ordenes?desde=<ISO>  (desde opcional)
{
  ordenes: [{
    id, status: "PAGO_EN_REVISION"|"APROBADA"|"RECHAZADA",
    buyerPhone, fulfillment: "RETIRO"|"DELIVERY", deliveryLat: number|null, deliveryLng: number|null,
    items: [{ nombre, cantidad, precioUnitarioUsd }],
    totalUsd, totalVes, vesRateUsed,
    comprobante: { id, decision, decidedAt, url: "/api/ordenes/:id/comprobante" } | null,
    createdAt, updatedAt
  }],
  ahora: "<ISO>"
}
// GET /api/ordenes/:id/comprobante → image/*, 404
// POST /api/ordenes/:id/aceptar | /rechazar → { orden }; 409 si no está en PAGO_EN_REVISION; 404 si no es del comercio
// PUT /api/tasa  { tasaBsPorUsd > 0 } → { vesRate }
// PUT /api/cobro { datosCobro no vacío } → { payoutInstructions }
// POST /api/token/regenerar → { panelToken }
```

### Módulos que aparecen

```
src/panel/   panel.module.ts, panel-token.guard.ts, panel-token.service.ts, panel.controller.ts, dto/, order.serializer.ts
src/orders/  order-decision.service.ts   (decideOrder(orderId, merchantId, approved): función pura reutilizable)
test/panel/  api.isolation.spec.ts
```

---

## 4 — Plan de implementación

1. **`panelToken`.** Columna, migración commiteada, `PanelTokenService.generate()` (`crypto.randomBytes(32)` base64url). El seed asigna un token fijo conocido al comercio de prueba.
2. **`PanelModule` con guard y CORS.** `PanelTokenGuard` (Bearer → `Merchant`, si no `401`), `enableCors({ origin: PANEL_ORIGIN })`, `GET /api/me`. Tests: token del seed OK; sin token / inventado → `401`.
3. **`GET /api/ordenes`.** `OrderSerializer`, filtro por `merchantId` + estados + `desde`, orden `updatedAt desc`, campo `ahora`. Test: dos comercios cruzados; `desde` excluye viejos.
4. **Comprobante.** Orden por `id` **y** `merchantId`; último `PaymentProof`; `downloadMedia`; reenvío con content-type. `404` si no es del comercio o no hay comprobante. Test con `fetch` mockeado.
5. **Aceptar / rechazar.** `OrderDecisionService.decideOrder`: verifica pertenencia y `PAGO_EN_REVISION` (si no, `409`), transacción, aviso al comprador vía `MessagingPort` con `safeSend`. Tests: aprueba, rechaza, `409`, `404`.
6. **Tasa y cobro.** DTOs con `class-validator`; solo el comercio del token. Tests.
7. **Regenerar token.** El anterior deja de servir al instante. Test.
8. **Swagger.** `@ApiBearerAuth`, DTOs de response, ejemplos. Prueba manual: `/docs` muestra las ocho rutas con esquemas.
9. **Test de aislamiento.** `test/panel/api.isolation.spec.ts`: dos comercios, dos tokens, ninguna ruta cruza.
10. **README.** Sección "Panel del comercio": `PANEL_ORIGIN`, token del seed para probar el SPA en local, link a `/docs`.

---

## 5 — Criterios de aceptación

- [ ] Toda ruta `/api/*` sin `Authorization` o con token inexistente → `401`.
- [ ] Una request desde un origen distinto de `PANEL_ORIGIN` no recibe cabeceras CORS que la habiliten.
- [ ] `GET /api/me` devuelve los datos del comercio del token.
- [ ] `GET /api/ordenes` devuelve solo pedidos del comercio del token en los tres estados, con ítems, totales congelados y comprobante.
- [ ] `?desde=<ts>` excluye pedidos con `updatedAt` anterior y devuelve `ahora`.
- [ ] `GET /api/ordenes/:id/comprobante` devuelve la imagen para un pedido propio y `404` para uno ajeno.
- [ ] Aceptar deja `APROBADA` + `APROBADO` con `decidedAt` y produce un envío al `buyerPhone` desde el número del comercio.
- [ ] Rechazar deja `RECHAZADA` + `RECHAZADO` y avisa al comprador.
- [ ] Aceptar/rechazar fuera de `PAGO_EN_REVISION` → `409` sin cambios; con token de otro comercio → `404` sin cambios.
- [ ] `PUT /api/tasa` no positivo → `400`; válido actualiza `vesRate` y `vesRateUpdatedAt` solo del comercio del token.
- [ ] `PUT /api/cobro` vacío → `400`; válido actualiza solo el comercio del token.
- [ ] Tras regenerar, el token viejo → `401` y el nuevo funciona.
- [ ] `/docs` documenta las ocho rutas con Bearer y DTOs.
- [ ] `api.isolation.spec.ts` pasa.
- [ ] Ningún log contiene un `panelToken` en claro.
- [ ] `bun run build` y `bun test` en verde.

---

## 6 — Decisiones tomadas y descartadas

- **Sí:** link secreto permanente por comercio entregado como QR; regenerable. **No:** código de 6 dígitos ni email + contraseña.
- **Sí:** SPA en repo separado; acá solo la API. El contrato vive en Swagger, no en un documento a mano.
- **Sí:** polling cada 10s con `?desde=`. **No:** SSE ni WebSocket.
- **Sí:** una sola decisión, después del pago, con el comprobante a la vista. **No:** doble aprobación.
- **Sí:** el comprador se entera por WhatsApp desde el número del comercio, vía `MessagingPort` y `safeSend`.
- **Sí:** el comprobante se sirve por el backend; las URLs de media de Meta exigen token y expiran.
- **Sí:** sin avisos al dueño fuera del panel. Decisión del usuario.
- **No:** menú en el panel. Decisión del usuario.
- **Sí:** `decideOrder` como servicio puro reutilizable, sin acoplarse a HTTP.

---

## 7 — Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Link de panel filtrado | Regenerar; el viejo muere al instante |
| El comercio no abre el panel | Aceptado por decisión del usuario; el SPA suena mientras esté abierto |
| Aviso al comprador fuera de su ventana de 24h | `safeSend` loguea; la decisión queda aplicada |
| URL de media de Meta expira | Se descarga en el momento de la request |
| CORS mal configurado en producción | `PANEL_ORIGIN` explícito por entorno |

---

## Lo que **no** está en este spec

- El SPA. Menú. Alta y QR (**SPEC 05**). Avisos al dueño. Pedidos sin pagar. Cancelaciones, reembolsos, multiusuario, roles, auditoría, rate limiting.

Cada uno de ellos, si entra, va en su propio spec.
