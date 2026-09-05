import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../../../env.js";

const sendMock = vi.fn();
const findUniqueOrderMock = vi.fn();
const conversationsListMock = vi.fn();

vi.mock("../../client.js", () => ({
  getZavuClient: () => ({ messages: { send: sendMock }, conversations: { list: conversationsListMock } }),
  withSender: (senderId: string) => ({ headers: { "Zavu-Sender": senderId } }),
}));

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    order: { findUnique: findUniqueOrderMock },
  },
}));

const { notifyMerchantForReview, approveButtonId, rejectButtonId } = await import("../paymentReview.js");

const env = {
  ZAVU_API_KEY: "irrelevante",
  ZAVU_OPERATOR_SENDER_ID: "sender_operador",
  ZAVU_PAGO_EN_REVISION_TEMPLATE_ID: "tpl_pago_en_revision",
} as Env;
const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

const RECENT_INBOUND = { items: [{ lastMessage: { direction: "inbound", at: new Date().toISOString() } }] };
const NO_RECENT_ACTIVITY = { items: [] };

beforeEach(() => {
  sendMock.mockReset();
  findUniqueOrderMock.mockReset();
  conversationsListMock.mockReset();
  conversationsListMock.mockResolvedValue(RECENT_INBOUND);
});

describe("notifyMerchantForReview", () => {
  it("no hace nada si la orden o el comprobante no existen", async () => {
    findUniqueOrderMock.mockResolvedValue(null);
    await notifyMerchantForReview("order_1", env, silentLog);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("manda la imagen y el mensaje con los dos botones al dueño del comercio", async () => {
    findUniqueOrderMock.mockResolvedValue({
      id: "order_1",
      buyerPhone: "+584169990020",
      totalUsd: "1.50",
      totalVes: "750",
      items: [{ nameSnapshot: "Jugo de parchita", qty: 1, unitPriceUsd: "1.50" }],
      merchant: { ownerPhone: "+584121234567" },
      proofs: [{ imageUrl: "https://cdn.zavu.dev/comprobante.jpg" }],
    });

    await notifyMerchantForReview("order_1", env, silentLog);

    expect(sendMock).toHaveBeenCalledTimes(2);

    const [imageCall, buttonsCall] = sendMock.mock.calls;
    if (!imageCall || !buttonsCall) throw new Error("se esperaban dos llamadas a send");

    expect(imageCall[0]).toMatchObject({
      to: "+584121234567",
      messageType: "image",
      content: { mediaUrl: "https://cdn.zavu.dev/comprobante.jpg" },
    });
    expect(imageCall[1]).toEqual({ headers: { "Zavu-Sender": "sender_operador" } });

    expect(buttonsCall[0]).toMatchObject({
      to: "+584121234567",
      messageType: "buttons",
      content: {
        buttons: [
          { id: approveButtonId("order_1"), title: "Aprobar" },
          { id: rejectButtonId("order_1"), title: "Rechazar" },
        ],
      },
    });
    expect(buttonsCall[0].text).toContain("Jugo de parchita");
    expect(buttonsCall[0].text).toContain("$1.50");
  });

  it("con la ventana de 24h cerrada, manda solo la plantilla (sin imagen ni botones)", async () => {
    conversationsListMock.mockResolvedValue(NO_RECENT_ACTIVITY);
    findUniqueOrderMock.mockResolvedValue({
      id: "order_3",
      buyerPhone: "+584169990022",
      totalUsd: "5",
      totalVes: "1800",
      items: [],
      merchant: { ownerPhone: "+584121234567" },
      proofs: [{ imageUrl: "https://cdn.zavu.dev/y.jpg" }],
    });

    await notifyMerchantForReview("order_3", env, silentLog);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+584121234567",
        messageType: "template",
        content: { templateId: "tpl_pago_en_revision" },
      }),
      { headers: { "Zavu-Sender": "sender_operador" } },
    );
  });

  it("no lanza si el envío falla (queda logueado)", async () => {
    findUniqueOrderMock.mockResolvedValue({
      id: "order_2",
      buyerPhone: "+584169990021",
      totalUsd: "1",
      totalVes: "500",
      items: [],
      merchant: { ownerPhone: "+584121234567" },
      proofs: [{ imageUrl: "https://cdn.zavu.dev/x.jpg" }],
    });
    sendMock.mockRejectedValue(new Error("401"));

    await expect(notifyMerchantForReview("order_2", env, silentLog)).resolves.toBeUndefined();
  });
});
