import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../../../env.js";

const sendMock = vi.fn();
const retrieveMock = vi.fn();
const findUniqueMock = vi.fn();
const createMenuImportMock = vi.fn();
const updateMenuImportMock = vi.fn();
const extractMenuFromFileMock = vi.fn();

vi.mock("../../client.js", () => ({
  getZavuClient: () => ({
    messages: { send: sendMock, retrieve: retrieveMock },
  }),
  withSender: (senderId: string) => ({ headers: { "Zavu-Sender": senderId } }),
}));

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    merchant: { findUnique: findUniqueMock },
    menuImport: { create: createMenuImportMock, update: updateMenuImportMock },
  },
}));

vi.mock("../../../anthropic/menuExtraction.js", () => ({
  extractMenuFromFile: extractMenuFromFileMock,
  MENU_EXTRACTION_MODEL: "claude-opus-5",
}));

const originalFetch = global.fetch;

const { handleOperatorMessageInbound } = await import("../operatorMessageInbound.js");

const env = {
  ZAVU_API_KEY: "irrelevante",
  ZAVU_OPERATOR_SENDER_ID: "sender_operador",
  ANTHROPIC_API_KEY: "sk-ant-irrelevante",
  PUBLIC_BASE_URL: "https://ejemplo.test",
} as Env;

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

beforeEach(() => {
  sendMock.mockReset();
  retrieveMock.mockReset();
  findUniqueMock.mockReset();
  createMenuImportMock.mockReset();
  updateMenuImportMock.mockReset();
  extractMenuFromFileMock.mockReset();
  global.fetch = originalFetch;
});

describe("handleOperatorMessageInbound", () => {
  it("ignora mensajes que no son imagen ni documento", async () => {
    await handleOperatorMessageInbound(
      { messageId: "m1", from: "+584121234567", messageType: "text" },
      env,
      silentLog,
    );

    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("responde con el link de registro si el número no tiene comercio activo", async () => {
    findUniqueMock.mockResolvedValue(null);

    await handleOperatorMessageInbound(
      {
        messageId: "m2",
        from: "+584000000000",
        messageType: "image",
        content: { mediaUrl: "https://cdn.zavu.dev/img.jpg" },
      },
      env,
      silentLog,
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+584000000000",
        text: expect.stringContaining("https://ejemplo.test/registro"),
      }),
      { headers: { "Zavu-Sender": "sender_operador" } },
    );
    expect(createMenuImportMock).not.toHaveBeenCalled();
  });

  it("extrae el menú, lo persiste como ESPERANDO_CONFIRMACION y lo envía por chat", async () => {
    findUniqueMock.mockResolvedValue({ id: "merchant_1", status: "ACTIVO" });
    createMenuImportMock.mockResolvedValue({ id: "import_1" });
    extractMenuFromFileMock.mockResolvedValue([
      { name: "Arepa Pelúa", description: null, priceUsd: 4 },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([["content-type", "image/jpeg"]]),
      arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer,
    }) as any;
    (global.fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => (k === "content-type" ? "image/jpeg" : null) },
      arrayBuffer: async () => new TextEncoder().encode("fake-image-bytes").buffer,
    });

    await handleOperatorMessageInbound(
      {
        messageId: "m3",
        from: "+584121234567",
        messageType: "image",
        content: { mediaUrl: "https://cdn.zavu.dev/menu.jpg" },
      },
      env,
      silentLog,
    );

    expect(createMenuImportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ merchantId: "merchant_1", status: "EXTRAYENDO" }),
      }),
    );
    expect(updateMenuImportMock).toHaveBeenCalledWith({
      where: { id: "import_1" },
      data: {
        status: "ESPERANDO_CONFIRMACION",
        extracted: [{ name: "Arepa Pelúa", description: null, priceUsd: 4 }],
      },
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Arepa Pelúa") }),
      { headers: { "Zavu-Sender": "sender_operador" } },
    );
  });

  it("marca DESCARTADO y avisa si la extracción no encuentra productos", async () => {
    findUniqueMock.mockResolvedValue({ id: "merchant_1", status: "ACTIVO" });
    createMenuImportMock.mockResolvedValue({ id: "import_2" });
    extractMenuFromFileMock.mockResolvedValue([]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new ArrayBuffer(4),
    }) as any;

    await handleOperatorMessageInbound(
      {
        messageId: "m4",
        from: "+584121234567",
        messageType: "image",
        content: { mediaUrl: "https://cdn.zavu.dev/borroso.jpg" },
      },
      env,
      silentLog,
    );

    expect(updateMenuImportMock).toHaveBeenCalledWith({
      where: { id: "import_2" },
      data: { status: "DESCARTADO" },
    });
  });
});
