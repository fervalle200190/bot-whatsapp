import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../../../env.js";

const updateMock = vi.fn();
const regenerateWebhookSecretMock = vi.fn();
const createAgentMock = vi.fn();
const createToolMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMerchantMock = vi.fn();

vi.mock("../../client.js", () => ({
  getZavuClient: () => ({
    senders: {
      update: updateMock,
      regenerateWebhookSecret: regenerateWebhookSecretMock,
      agent: { create: createAgentMock, tools: { create: createToolMock } },
    },
  }),
}));

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    merchant: {
      findUnique: findUniqueMock,
      update: updateMerchantMock,
    },
  },
}));

const { handleInvitationStatusChanged } = await import("../invitationStatusChanged.js");

const env = {
  PUBLIC_BASE_URL: "https://ejemplo.test",
  ZAVU_API_KEY: "irrelevante",
  ANTHROPIC_API_KEY: "sk-ant-irrelevante",
} as Env;

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

beforeEach(() => {
  updateMock.mockReset();
  regenerateWebhookSecretMock.mockReset();
  createAgentMock.mockReset();
  createToolMock.mockReset();
  findUniqueMock.mockReset();
  updateMerchantMock.mockReset();
});

describe("handleInvitationStatusChanged", () => {
  it("no hace nada si la invitación todavía no se completó", async () => {
    await handleInvitationStatusChanged(
      { invitationId: "inv_1", previousStatus: "pending", currentStatus: "in_progress" },
      env,
      silentLog,
    );

    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("no hace nada si no hay Merchant asociado a esa invitación", async () => {
    findUniqueMock.mockResolvedValue(null);

    await handleInvitationStatusChanged(
      {
        invitationId: "inv_huerfana",
        previousStatus: "in_progress",
        currentStatus: "completed",
        senderId: "snd_x",
      },
      env,
      silentLog,
    );

    expect(updateMock).not.toHaveBeenCalled();
    expect(updateMerchantMock).not.toHaveBeenCalled();
  });

  it("configura el webhook del sender, crea el agente vendedor y activa el comercio", async () => {
    findUniqueMock.mockResolvedValue({ id: "merchant_1", name: "Panaderia Don Jose" });
    updateMock.mockResolvedValue({});
    regenerateWebhookSecretMock.mockResolvedValue({ secret: "whsec_nuevo" });
    createAgentMock.mockResolvedValue({ agent: { id: "agent_nuevo" } });
    createToolMock.mockResolvedValue({ tool: { id: "tool_nuevo" } });

    await handleInvitationStatusChanged(
      {
        invitationId: "inv_2",
        previousStatus: "in_progress",
        currentStatus: "completed",
        senderId: "snd_panaderia",
      },
      env,
      silentLog,
    );

    expect(updateMock).toHaveBeenCalledWith(
      "snd_panaderia",
      expect.objectContaining({
        webhookUrl: "https://ejemplo.test/webhooks/zavu",
        webhookSignatureVersion: "v2",
      }),
    );
    expect(regenerateWebhookSecretMock).toHaveBeenCalledWith("snd_panaderia");
    expect(createAgentMock).toHaveBeenCalledWith(
      "snd_panaderia",
      expect.objectContaining({
        provider: "anthropic",
        apiKey: "sk-ant-irrelevante",
        systemPrompt: expect.stringContaining("Panaderia Don Jose"),
      }),
    );
    expect(createToolMock).toHaveBeenCalledWith(
      "snd_panaderia",
      expect.objectContaining({
        name: "buscar_productos",
        webhookUrl: "https://ejemplo.test/tools/catalogo/buscar?merchantId=merchant_1",
      }),
    );
    expect(updateMerchantMock).toHaveBeenCalledWith({
      where: { id: "merchant_1" },
      data: {
        zavuSenderId: "snd_panaderia",
        zavuSenderWebhookSecret: "whsec_nuevo",
        zavuAgentId: "agent_nuevo",
        status: "ACTIVO",
      },
    });
  });
});
