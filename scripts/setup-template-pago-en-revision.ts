/**
 * Script de alta ÚNICA de la plantilla "pago_en_revision". Se corre una sola
 * vez, después de que el sender operador ya tenga su WhatsApp Business
 * Account conectado (ver scripts/setup-operador.ts).
 *
 * Uso: pnpm exec tsx scripts/setup-template-pago-en-revision.ts
 *
 * Imprime el `id` de la plantilla creada — pegalo en
 * ZAVU_PAGO_EN_REVISION_TEMPLATE_ID (.env). La plantilla queda en estado
 * "pending" hasta que Meta la apruebe (puede tardar horas o días); mientras
 * tanto, mandarla devuelve un error de Zavu, así que el fallback del paso 19
 * no funciona en la práctica hasta que status pase a "approved".
 *
 * No lleva botones: por diseño (ver spec sección 6/7), solo avisa que hay un
 * pago pendiente. Los botones Aprobar/Rechazar se mandan como mensaje libre
 * una vez que el comercio responde y la ventana de 24h se reabre.
 */
import { loadEnv } from "../src/env.js";
import { getZavuClient } from "../src/zavu/client.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const zavu = getZavuClient(env.ZAVU_API_KEY);

  console.log("Creando la plantilla pago_en_revision...");
  const template = await zavu.templates.create({
    name: "pago_en_revision",
    language: "es",
    body: "Tenés un comprobante de pago pendiente de revisión. Respondé este mensaje para ver los detalles.",
    whatsappCategory: "UTILITY",
  });
  console.log(`Plantilla creada: ${template.id} (status: ${template.status})`);

  console.log("\nEnviándola a Meta para aprobación...");
  const submitted = await zavu.templates.submit(template.id, {
    senderId: env.ZAVU_OPERATOR_SENDER_ID,
    category: "UTILITY",
  });
  console.log(`Estado tras el envío: ${submitted.status}`);

  console.log("\n>>> Pegá esto en .env como ZAVU_PAGO_EN_REVISION_TEMPLATE_ID:");
  console.log(template.id);
  console.log("\nRevisá el estado más adelante con templates.retrieve() o templates.sync() — la aprobación de Meta no es inmediata.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
