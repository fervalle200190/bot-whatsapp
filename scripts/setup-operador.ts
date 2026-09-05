/**
 * Script de configuración ÚNICA del número operador. Se corre una sola vez,
 * a mano, después de:
 *   1. Crear el sender del operador en el dashboard de Zavu y conectarle
 *      SU PROPIO WhatsApp (Channels → WhatsApp → "Use my own phone number").
 *      No hay API para este paso — es 100% manual (confirmado en la doc).
 *   2. Poner el senderId resultante en ZAVU_OPERATOR_SENDER_ID (.env).
 *
 * Uso: pnpm exec tsx scripts/setup-operador.ts
 *
 * Este script configura el webhook de ese sender, genera su secreto,
 * crea el agente operador y su tool identificar_comercio. Imprime el
 * secreto nuevo — pegalo en ZAVU_OPERATOR_WEBHOOK_SECRET.
 */
import { loadEnv } from "../src/env.js";
import { getZavuClient } from "../src/zavu/client.js";
import { buildOperatorSystemPrompt } from "../src/zavu/prompts.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const zavu = getZavuClient(env.ZAVU_API_KEY);
  const senderId = env.ZAVU_OPERATOR_SENDER_ID;
  const webhookUrl = `${env.PUBLIC_BASE_URL}/webhooks/zavu`;

  console.log(`Configurando webhook del sender operador (${senderId})...`);
  await zavu.senders.update(senderId, {
    webhookUrl,
    webhookEvents: ["message.inbound", "invitation.status_changed"],
    webhookSignatureVersion: "v2",
  });

  const { secret } = await zavu.senders.regenerateWebhookSecret(senderId);
  console.log("\n>>> Pegá esto en .env como ZAVU_OPERATOR_WEBHOOK_SECRET:");
  console.log(secret);

  console.log("\nCreando el agente operador...");
  const { agent } = await zavu.senders.agent.create(senderId, {
    name: "Operador Zavu",
    provider: "anthropic",
    model: "claude-opus-5",
    systemPrompt: buildOperatorSystemPrompt(),
    apiKey: env.ANTHROPIC_API_KEY,
    // Las fotos/PDF de menú las procesa nuestro propio webhook (extracción con
    // Claude vision), no el agente conversacional — si el agente también
    // respondiera a message.inbound de tipo imagen, el comercio recibiría dos
    // respuestas para el mismo mensaje.
    triggerOnMessageTypes: ["text", "interactive"],
  });
  console.log(`Agente creado: ${agent.id}`);

  console.log("\nCreando la tool identificar_comercio...");
  const { tool: identificarTool } = await zavu.senders.agent.tools.create(senderId, {
    name: "identificar_comercio",
    description:
      "Identifica si el número que escribe es dueño de un comercio registrado en Zavu, y devuelve su nombre. Llamala siempre al empezar una conversación nueva, sin pedirle nada al usuario.",
    parameters: { type: "object", properties: {}, required: [] },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/comercio/identificar`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });
  console.log(`Tool creada: ${identificarTool.id}`);

  console.log("\nCreando la tool confirmar_menu...");
  const { tool: confirmarTool } = await zavu.senders.agent.tools.create(senderId, {
    name: "confirmar_menu",
    description:
      "Persiste como catálogo definitivo del comercio la última lista de productos extraída de una foto/PDF de menú que todavía está pendiente de confirmación. Llamala solo cuando el usuario confirme explícitamente que la lista está bien.",
    parameters: { type: "object", properties: {}, required: [] },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/menu/confirmar`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });
  console.log(`Tool creada: ${confirmarTool.id}`);

  console.log("\nCreando la tool editar_producto...");
  const { tool: editarTool } = await zavu.senders.agent.tools.create(senderId, {
    name: "editar_producto",
    description:
      "Corrige el nombre, precio o descripción de UN producto dentro de la lista extraída que todavía está pendiente de confirmación, antes de llamar a confirmar_menu. nombreActual debe ser el nombre tal como aparece en la lista que le mostraste al usuario.",
    parameters: {
      type: "object",
      properties: {
        nombreActual: {
          type: "string",
          description: "Nombre del producto tal como aparece en la lista mostrada al usuario",
        },
        nuevoNombre: { type: "string", description: "Nuevo nombre, si cambia" },
        nuevoPrecioUsd: { type: "number", description: "Nuevo precio en USD, si cambia" },
        nuevaDescripcion: { type: "string", description: "Nueva descripción, si cambia" },
      },
      required: ["nombreActual"],
    },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/producto/editar`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });
  console.log(`Tool creada: ${editarTool.id}`);

  console.log("\nCreando la tool actualizar_tasa...");
  const { tool: tasaTool } = await zavu.senders.agent.tools.create(senderId, {
    name: "actualizar_tasa",
    description:
      "Fija o actualiza la tasa de cambio Bs/USD que usa el comercio para mostrarle el total en bolívares a sus compradores. Llamala cuando el usuario diga un número de tasa, por ejemplo 'la tasa es 360'.",
    parameters: {
      type: "object",
      properties: {
        tasaBsPorUsd: { type: "number", description: "Cuántos bolívares equivalen a 1 dólar" },
      },
      required: ["tasaBsPorUsd"],
    },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/tasa/actualizar`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });
  console.log(`Tool creada: ${tasaTool.id}`);

  console.log("\nCreando la tool guardar_datos_cobro...");
  const { tool: cobroTool } = await zavu.senders.agent.tools.create(senderId, {
    name: "guardar_datos_cobro",
    description:
      "Guarda los datos de cobro del comercio (Pago Móvil, transferencia, etc.) tal como el usuario los dicte, para que el bot se los repita a los compradores al cerrar una orden.",
    parameters: {
      type: "object",
      properties: {
        datosCobro: {
          type: "string",
          description: "Texto libre con los datos de cobro, tal como el usuario los dictó",
        },
      },
      required: ["datosCobro"],
    },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/cobro/guardar`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });
  console.log(`Tool creada: ${cobroTool.id}`);

  console.log("\nListo. El número operador ya puede recibir mensajes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
