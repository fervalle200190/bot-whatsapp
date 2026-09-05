import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../../../env.js";

const sendMock = vi.fn();
const findUniqueOrderMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("../../client.js", () => ({
  getZavuClient: () => ({ messages: { send: sendMock } }),
  withSender: (senderId: string) => ({ headers: { "Zavu-Sender": senderId } }),
}));

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    order: { findUnique: findUniqueOrderMock, update: vi.fn() },
    paymentProof: { update: vi.fn() },
    $transaction: transactionMock,
  },
}));

const { handlePaymentDecision } = await import("../paymentDecision.js");
const { approveButtonId, rejectButtonId } = await import("../paymentReview.js");

const env = { ZAVU_API_KEY: "irrelevante", ZAVU_OPERATOR_SENDER_ID: "sender_operador" } as Env;
const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

const baseOrder = {
  id: "order_1",
  status: "PAGO_EN_REVISION",
  buyerPhone: "+584169990020",
  merchant: { ownerPhone: "+584121234567", zavuSenderId: "sender_seed_demo" },
  proofs: [{ id: "proof_1" }],
};

beforeEach(() => {
  sendMock.mockReset();
  findUniqueOrderMock.mockReset();
  transactionMock.mockReset();
  transactionMock.mockResolvedValue([]);
});

describe("handlePaymentDecision", () => {
  it("ignora un botón que no es de aprobar/rechazar", async () => {
    await handlePaymentDecision("otro_boton_123", "+584121234567", env, silentLog);
    expect(findUniqueOrderMock).not.toHaveBeenCalled();
  });

  it("ignora si la orden no existe", async () => {
    findUniqueOrderMock.mockResolvedValue(null);
    await handlePaymentDecision(approveButtonId("no_existe"), "+584121234567", env, silentLog);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("no procesa la decisión si quien escribe no es dueño de esa orden (aislamiento multi-tenant)", async () => {
    findUniqueOrderMock.mockResolvedValue(baseOrder);

    await handlePaymentDecision(approveButtonId("order_1"), "+584169999999", env, silentLog);

    expect(transactionMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("aprueba, notifica al comercio y al comprador", async () => {
    findUniqueOrderMock.mockResolvedValue(baseOrder);

    await handlePaymentDecision(approveButtonId("order_1"), "+584121234567", env, silentLog);

    expect(transactionMock).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+584121234567", text: expect.stringContaining("aprobado") }),
      { headers: { "Zavu-Sender": "sender_operador" } },
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+584169990020", text: expect.stringContaining("confirmado") }),
      { headers: { "Zavu-Sender": "sender_seed_demo" } },
    );
  });

  it("rechaza y avisa a ambos con el mensaje correspondiente", async () => {
    findUniqueOrderMock.mockResolvedValue(baseOrder);

    await handlePaymentDecision(rejectButtonId("order_1"), "+584121234567", env, silentLog);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+584121234567", text: expect.stringContaining("rechazado") }),
      { headers: { "Zavu-Sender": "sender_operador" } },
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+584169990020", text: expect.stringContaining("rechazado") }),
      { headers: { "Zavu-Sender": "sender_seed_demo" } },
    );
  });

  it("no reprocesa una orden que ya no está en PAGO_EN_REVISION", async () => {
    findUniqueOrderMock.mockResolvedValue({ ...baseOrder, status: "APROBADA" });

    await handlePaymentDecision(approveButtonId("order_1"), "+584121234567", env, silentLog);

    expect(transactionMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("ya estaba resuelto") }),
      { headers: { "Zavu-Sender": "sender_operador" } },
    );
  });
});
