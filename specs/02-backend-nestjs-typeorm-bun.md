# SPEC 02 — Backend en NestJS + TypeORM sobre Bun

> **Estado:** Aprobado
> **Depende de:** SPEC 01
> **Fecha:** 2026-09-08
> **Objetivo:** Reescribir el backend en NestJS + TypeORM corriendo sobre Bun, portando solo el núcleo de negocio del SPEC 01 que sobrevive al pivote (entidades, tools de venta, carrito, órdenes, registro, aislamiento multi-tenant) y dejándolo sin ningún canal de WhatsApp conectado, listo para que el SPEC 03 le enchufe Meta + n8n.

---

## 1 — Por qué existe este spec

El usuario decidió cambiar el stack: **NestJS** en lugar de Fastify, **TypeORM** en lugar de Prisma, **Bun** en lugar de Node + pnpm, y **Swagger/OpenAPI** autogenerado. Al mismo tiempo, el SPEC 03 cambia el canal de WhatsApp y elimina el número operador. Hacer las dos cosas en orden inverso — portar todo el Fastify actual a Nest y después borrar la mitad — sería escribir dos veces código que se tira. Por eso este spec porta **solo lo que sobrevive**: la lógica que no depende de ningún proveedor de mensajería.

Lo que se porta es exactamente lo que el SPEC 01 dejó probado con 30 tests: el modelo de datos, las reglas de catálogo/carrito/cierre de orden, la autenticación de tools con identidad inyectada (nunca desde lo que genera el modelo), y el test de aislamiento entre comercios. Lo que **no** se porta: la integración con el proveedor de mensajería anterior, el operador y sus cinco tools, la extracción de menú con Anthropic, los scripts de setup. Nada de eso tiene lugar en el destino.

Al terminar este spec el sistema **no habla con WhatsApp**: es un backend que expone `/health`, `/registro`, `/tools/*` y `/docs`, con la base migrada y los tests en verde. Es un estado intermedio deliberado y verificable; el canal llega en el SPEC 03.

---

## 2 — Alcance

**Dentro:**

- Proyecto NestJS nuevo en la raíz del repo (reemplaza `src/` de Fastify), corriendo con `bun` (`bun install`, `bun run start:dev`, `bun test`). Se elimina `pnpm-lock.yaml`; aparece `bun.lockb`.
- TypeORM con Postgres (el mismo `docker-compose.yml`). `synchronize: true` solo cuando `NODE_ENV !== "production"`; en producción, migraciones versionadas en `src/database/migrations/` con `DataSource` para la CLI.
- Entidades: `Merchant` (sin ningún campo del proveedor anterior), `Product`, `MenuImport`, `Order`, `OrderItem`, `PaymentProof`, con los mismos enums, índices y restricciones del SPEC 01. Los `Decimal` de Prisma pasan a `numeric` con transformer a `number`.
- Configuración validada al arrancar (`@nestjs/config` + `class-validator` sobre las variables de entorno).
- `GET /health`.
- `GET /registro` (HTML mínimo) y `POST /registro`: crea el `Merchant` en `PENDIENTE_CONEXION` y muestra "te contactamos para conectar tu número". Sin invitaciones ni llamadas externas.
- Módulo `tools` con las cinco tools de venta del SPEC 01 como endpoints `POST /tools/*`, protegidas por un guard de secreto compartido (`X-Tools-Secret`) que lee `merchantId` y `contactPhone` del body. Mismas reglas: catálogo filtrado por comercio y disponibilidad, carrito como `Order` en `BORRADOR` con fusión de cantidades, `definir_entrega`, `cerrar_orden` con congelamiento de totales y sus cuatro guards (`carrito_vacio`, `falta_definir_entrega`, `falta_ubicacion`, `comercio_no_configurado`).
- **Puerto de salida de mensajería vacío**: `cerrar_orden` y `definir_entrega` necesitan enviar WhatsApp; en este spec llaman a una interfaz `MessagingPort` cuya única implementación es `NoopMessagingService`, que loguea y no envía. El SPEC 03 la reemplaza por Meta.
- Swagger en `GET /docs` con `@nestjs/swagger`, documentando `/tools/*` y `/registro` a partir de los DTOs.
- Tests con `bun test` (API compatible con Jest) y `@nestjs/testing`: unitarios de `CartService` y `OrdersService`, y el **test de aislamiento multi-tenant** con las mismas aserciones que `tools.isolation.test.ts` del SPEC 01, contra Postgres real.
- Seed (`bun run seed`) con el mismo comercio y los mismos tres productos del SPEC 01.
- `README.md` reescrito para el stack nuevo.

**Fuera de alcance (para specs futuros):**

- Cualquier canal de WhatsApp: webhooks de Meta, envío real, n8n — **SPEC 03**.
- API del panel del comercio — **SPEC 04**.
- Alta manual de comercios y sus datos iniciales — **SPEC 05**.
- Extracción de menú con IA, operador, integración con el proveedor anterior: no se portan.
- Cambios a las reglas de negocio del SPEC 01.
- Cambiar de base de datos: sigue Postgres.
- CI/CD, Dockerfile del backend, despliegue.

---

## 3 — Modelo de datos

Mismas tablas y semántica que el SPEC 01, expresadas como entidades TypeORM. Se muestra `Merchant` completa y los cambios de tipo; el resto se traduce 1:1.

```ts
// src/merchants/merchant.entity.ts
export enum MerchantStatus { PENDIENTE_CONEXION = "PENDIENTE_CONEXION", ACTIVO = "ACTIVO", SUSPENDIDO = "SUSPENDIDO" }

@Entity()
export class Merchant {
  @PrimaryColumn({ type: "varchar", length: 32 }) id: string;            // cuid generado en el servicio
  @Column() name: string;
  @Column({ unique: true }) ownerPhone: string;                           // E.164
  @Column({ type: "enum", enum: MerchantStatus, default: MerchantStatus.PENDIENTE_CONEXION }) status: MerchantStatus;
  @Column({ type: "text", nullable: true }) payoutInstructions: string | null;
  @Column({ type: "numeric", precision: 18, scale: 4, nullable: true, transformer: numericToNumber }) vesRate: number | null;
  @Column({ type: "timestamptz", nullable: true }) vesRateUpdatedAt: Date | null;
  @OneToMany(() => Product, p => p.merchant) products: Product[];
  @OneToMany(() => Order, o => o.merchant) orders: Order[];
  @OneToMany(() => MenuImport, m => m.merchant) menuImports: MenuImport[];
  @CreateDateColumn({ type: "timestamptz" }) createdAt: Date;
}
```

Reglas de traducción Prisma → TypeORM:

| Prisma | TypeORM |
| --- | --- |
| `Decimal @db.Decimal(p, s)` | `numeric(p, s)` con `transformer: numericToNumber` (`to: v => v`, `from: v => v === null ? null : Number(v)`) |
| `Json` | `jsonb` |
| `@default(cuid())` | id `varchar(32)` asignado en el servicio con `@paralleldrive/cuid2` |
| `@@index([a, b])` | `@Index(["a", "b"])` en la entidad |
| `@relation` | `@ManyToOne` / `@OneToMany` con `onDelete: "RESTRICT"` explícito |
| enum | `enum` de TypeScript + columna `type: "enum"` |

`Merchant` pierde los cuatro campos del proveedor anterior (invitación, sender, secreto de webhook, agente). No gana nada todavía: `metaPhoneNumberId` llega en el SPEC 03 y `panelToken` en el SPEC 04.

### Contrato de las tools (lo consume n8n en el SPEC 03)

```ts
// POST /tools/<ruta>   Header: X-Tools-Secret: {TOOLS_SHARED_SECRET}
class ToolCallDto {
  @IsString() merchantId: string;       // identidad, la pone quien llama — nunca el modelo
  @IsString() contactPhone: string;     // E.164 del comprador
  @IsObject() arguments: Record<string, unknown>;   // lo único que genera el modelo; cada tool lo valida con su propio DTO
}
```

Rutas: `/tools/catalogo/buscar`, `/tools/carrito/agregar`, `/tools/carrito/ver`, `/tools/orden/entrega`, `/tools/orden/cerrar`. Respuestas idénticas a las del SPEC 01 (`{ productos }`, `{ agregado, carrito }`, `{ carrito }`, `{ definido, tipo }`, `{ cerrada, totalUsd, totalVes, vesRateUsed }` y los `{ error }` legibles).

### Puerto de mensajería

```ts
// src/messaging/messaging.port.ts
export abstract class MessagingPort {
  abstract sendText(merchantId: string, to: string, text: string): Promise<void>;
  abstract sendLocationRequest(merchantId: string, to: string, text: string): Promise<void>;
}
// src/messaging/noop-messaging.service.ts — implementación de este spec: loguea y resuelve.
```

### Variables de entorno

```
NODE_ENV=development
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bot_whatsapp
TOOLS_SHARED_SECRET=
```

La base pasa a llamarse `bot_whatsapp` (también en `docker-compose.yml`). Desaparecen todas las variables del proveedor anterior y `ANTHROPIC_API_KEY`.

### Estructura de módulos

```
src/
  main.ts                    bootstrap, ValidationPipe global, Swagger en /docs
  app.module.ts
  config/                    validación de env con class-validator
  database/                  TypeORM config, DataSource para CLI, migrations/, seed.ts
  common/                    cuid, numericToNumber, filtros de error
  merchants/                 Merchant entity + MerchantsService
  catalog/                   Product, MenuImport entities + CatalogService (buscar)
  orders/                    Order, OrderItem, PaymentProof entities + CartService + OrdersService
  tools/                     ToolsController, ToolsSecretGuard, DTOs
  registro/                  RegistroController (HTML)
  messaging/                 MessagingPort + NoopMessagingService
  health/
test/
  orders/cart.service.spec.ts
  orders/orders.service.spec.ts
  tools/tools.isolation.spec.ts
```

---

## 4 — Plan de implementación

Cada paso deja `bun run build` y `bun test` en verde y es commiteable por separado. El código Fastify viejo se borra en el paso 1: este spec es una reescritura, no una convivencia.

1. **Proyecto Nest limpio.** Borrar `src/`, `prisma/`, `scripts/`, `vitest.*`, `pnpm-lock.yaml`. `bun create nest` (o `nest new` ejecutado con bun) en la raíz; `package.json` con scripts `start:dev`, `build`, `test`, `seed`, `migration:generate`, `migration:run`. `GET /health` devuelve `{ status: "ok" }`. Prueba: `bun run start:dev` levanta y `curl /health` responde.
2. **Config validada.** `ConfigModule` con `validate()` sobre una clase `EnvVars` (`class-validator`). Arrancar sin `TOOLS_SHARED_SECRET` falla con un mensaje claro. `.env.example` actualizado.
3. **TypeORM conectado.** `TypeOrmModule.forRootAsync` con `DATABASE_URL`, `synchronize: NODE_ENV !== "production"`, `autoLoadEntities`. `src/database/data-source.ts` para la CLI. Prueba: arranca contra el Postgres del `docker-compose`.
4. **Entidades.** Las seis entidades con enums, índices, relaciones y `numericToNumber`. Con `synchronize` las tablas aparecen. Se genera la primera migración (`bun run migration:generate -- InitialSchema`) y se commitea, aunque en dev no se use. Prueba: `\d "order"` en psql muestra `numeric(18,2)` en `totalVes`.
5. **Seed.** `bun run seed` crea "Arepas La Esquina" con sus tres productos, `vesRate` y `payoutInstructions`, idempotente por `ownerPhone`.
6. **Servicios de negocio.** `CatalogService.buscar(merchantId, termino?)`, `CartService.getOrCreateDraft`, `CartService.add`, `CartService.snapshot`, `OrdersService.definirEntrega`, `OrdersService.cerrar` — lógica portada línea a línea desde `src/lib/cart.ts` y `src/routes/tools.ts` del SPEC 01. Tests unitarios con repositorios mockeados vía `@nestjs/testing`.
7. **Puerto de mensajería.** `MessagingPort` abstracto + `NoopMessagingService` registrado como provider. `OrdersService` lo inyecta para `cerrar` y `definirEntrega`.
8. **Guard y DTO de tools.** `ToolsSecretGuard` compara `X-Tools-Secret` en tiempo constante; `ToolCallDto` con `class-validator`; `ValidationPipe({ whitelist: true, transform: true })` global. Un DTO de `arguments` por tool (`BuscarProductosArgs`, `AgregarAlCarritoArgs`, `DefinirEntregaArgs` con `@Transform` a mayúsculas). Argumentos inválidos → `200 { error: "argumentos_invalidos" }` como en el SPEC 01, no `400`.
9. **`ToolsController`.** Las cinco rutas, delegando en los servicios. Prueba manual: `curl` con el header y `merchantId` del seed devuelve el catálogo real.
10. **Test de aislamiento.** `test/tools/tools.isolation.spec.ts` con `@nestjs/testing` + `supertest` contra Postgres real: dos comercios, mismas seis aserciones del SPEC 01 (catálogo, término cruzado, producto ajeno al carrito, carritos separados por comercio, y las dos del operador reemplazadas por: `cerrar_orden` de A no ve la tasa de B; `definir_entrega` de A no toca órdenes de B).
11. **`/registro`.** `RegistroController` con `GET` (HTML) y `POST` (`class-validator` sobre `name` y `ownerPhone` E.164), idempotente por `ownerPhone`, respuesta HTML "te contactamos". Prueba manual con `curl -d`.
12. **Swagger.** `@nestjs/swagger` en `/docs`; `@ApiTags`, `@ApiHeader('X-Tools-Secret')`, `@ApiBody` con los DTOs. Prueba manual: `/docs` lista las seis rutas y el esquema de `ToolCallDto`.
13. **README.** Requisitos (Bun, Docker), puesta en marcha, scripts, y una sección "Estado: sin canal de WhatsApp todavía — ver SPEC 03".
14. **Verificación final.** `grep -ri "prisma\|fastify\|pnpm\|vitest\|zod\|operador" src test package.json docker-compose.yml` devuelve cero, y tampoco queda ninguna referencia al proveedor de mensajería anterior. `bun run build`, `bun test` en verde.

---

## 5 — Criterios de aceptación

- [ ] `bun install && bun run start:dev` levanta el servidor; `GET /health` devuelve `200 { status: "ok" }`.
- [ ] Arrancar sin `TOOLS_SHARED_SECRET` o sin `DATABASE_URL` falla al inicio con un mensaje que nombra la variable.
- [ ] Con `NODE_ENV=development` las tablas se crean solas; con `NODE_ENV=production` no, y `bun run migration:run` las crea desde `src/database/migrations/`.
- [ ] `bun run seed` es idempotente: correrlo dos veces deja un solo "Arepas La Esquina" con tres productos.
- [ ] `totalVes`, `totalUsd`, `vesRateUsed`, `priceUsd` y `vesRate` se leen como `number` en TypeScript y se guardan como `numeric` con la precisión del SPEC 01.
- [ ] Toda llamada a `/tools/*` sin `X-Tools-Secret` o con uno incorrecto devuelve `401`.
- [ ] Un body sin `merchantId` o `contactPhone` devuelve `400`; `arguments` inválidos para la tool devuelven `200 { error: "argumentos_invalidos" }`.
- [ ] `buscar_productos` devuelve solo productos `available` del `merchantId` del body, filtrando por término case-insensitive en nombre y descripción.
- [ ] Agregar el mismo producto dos veces fusiona la cantidad en un solo `OrderItem`.
- [ ] `ver_carrito` devuelve `totalVes = totalUsd × vesRate` redondeado a 2 decimales, o `null` si el comercio no tiene tasa.
- [ ] `definir_entrega` acepta `"retiro"` en minúsculas y lo guarda como `RETIRO`; con `DELIVERY` llama a `MessagingPort.sendLocationRequest`.
- [ ] `cerrar_orden` devuelve `carrito_vacio`, `falta_definir_entrega`, `falta_ubicacion` o `comercio_no_configurado` en cada caso, y en el camino feliz congela los tres montos, pasa a `ESPERANDO_PAGO` y llama a `MessagingPort.sendText` con los datos de cobro.
- [ ] Cambiar `vesRate` después de cerrar no modifica `totalVes` de la orden cerrada.
- [ ] `tools.isolation.spec.ts` pasa: ninguna tool devuelve ni modifica datos de otro `merchantId`.
- [ ] `POST /registro` crea el `Merchant` en `PENDIENTE_CONEXION` sin llamar a ninguna API externa; repetir el mismo `ownerPhone` no crea otro.
- [ ] `GET /docs` sirve Swagger UI con las seis rutas y sus DTOs.
- [ ] `grep -ri "prisma\|fastify\|pnpm\|vitest\|zod\|operador" src test package.json docker-compose.yml` devuelve cero, y no queda ninguna referencia al proveedor de mensajería anterior.
- [ ] Ningún log contiene `TOOLS_SHARED_SECRET` en claro.
- [ ] `bun run build` y `bun test` en verde.

---

## 6 — Decisiones tomadas y descartadas

- **Sí:** portar solo lo que sobrevive al pivote y dejar el canal vacío. **No:** portar todo el Fastify actual 1:1 (incluido el proveedor anterior y el operador) — código que el SPEC 03 borra. **No:** hacer stack + Meta + n8n en un solo spec — sin punto intermedio verificable, un fallo no se sabe de dónde viene.
- **Sí:** NestJS, TypeORM, Bun y Swagger. Decisión cerrada del usuario; no se reabre.
- **Sí:** `synchronize: true` en desarrollo y migraciones en producción. Decisión del usuario. Se mitiga el riesgo de divergencia generando y commiteando igualmente la migración inicial y cada migración posterior, aunque en dev no se ejecuten; el criterio de aceptación exige que producción arranque solo con `migration:run`.
- **Sí:** `class-validator`/`class-transformer` y `bun test` con `@nestjs/testing`. Es lo idiomático de Nest; Zod y Vitest se abandonan. `bun test` es compatible con la API de Jest, así que los tests se escriben como tests de Jest sin depender del runner de Jest.
- **Sí:** un `MessagingPort` abstracto con `NoopMessagingService`. Permite portar `cerrar_orden` y `definir_entrega` completos y probarlos ahora; el SPEC 03 solo cambia el provider. **No:** dejar esos dos endpoints a medias hasta el SPEC 03.
- **Sí:** el contrato de tools con `merchantId`/`contactPhone` en el body y secreto compartido en header, definido acá aunque n8n llegue en el SPEC 03. Es el mismo principio del SPEC 01: la identidad la pone quien llama, nunca el modelo.
- **Sí:** `numeric` con transformer a `number`. Los montos del MVP caben en `number` sin pérdida (2–4 decimales, cifras pequeñas); una librería de decimales sería peso innecesario. **No:** dejar `numeric` como `string`, que obliga a convertir en cada cálculo.
- **Sí:** ids `cuid2` generados en el servicio, para que los ids sigan siendo opacos y no secuenciales como en el SPEC 01. **No:** `uuid` de Postgres — cambiaría el formato de todos los ids sin ganancia.
- **Sí:** `arguments` inválidos siguen devolviendo `200 { error }` y no `400`. La única cliente será n8n: un `400` haría fallar la tool call y el agente no podría explicarle nada al comprador; un `{ error }` legible sí.
- **Sí:** borrar el código Fastify en el paso 1 en vez de convivir. Dos frameworks en el mismo `src/` durante la migración no aportan nada y confunden los tests.

---

## 7 — Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Bun y NestJS: `emitDecoratorMetadata`, `reflect-metadata` y el driver `pg` de TypeORM tienen historial de incompatibilidades | Verificar en el paso 1 y 3, antes de portar lógica; si algo no corre en Bun, es un hallazgo para el usuario, no algo a esquivar en silencio |
| `bun test` no es Jest: `jest.mock` a nivel de módulo se comporta distinto | Los tests unitarios mockean por inyección de dependencias de Nest (`useValue` en el `TestingModule`), no por `jest.mock`; el de aislamiento no mockea nada |
| `synchronize` en dev y migraciones en prod divergen | Cada cambio de entidad genera y commitea su migración en el mismo paso; criterio de aceptación explícito para producción |
| `numeric` → `number` pierde precisión en cifras grandes | Fuera del rango del MVP (montos en USD y Bs de 2–4 decimales); si hace falta, el transformer es el único lugar a cambiar |
| Perder cobertura al reescribir los tests | El test de aislamiento conserva sus aserciones; las de tools del operador se reemplazan por dos equivalentes de venta, no se eliminan sin más |
| El repo queda sin canal de WhatsApp hasta el SPEC 03 | Deliberado y documentado en el README; el SPEC 03 es el siguiente paso obligado |

---

## Lo que **no** está en este spec

- Cualquier canal de WhatsApp, Meta, n8n (**SPEC 03**).
- API del panel (**SPEC 04**).
- Alta manual de comercios (**SPEC 05**).
- Proveedor anterior, operador, extracción de menú con IA: no se portan.
- Cambios de reglas de negocio, cambio de base de datos, CI/CD, despliegue.

Cada uno de ellos, si entra, va en su propio spec.
