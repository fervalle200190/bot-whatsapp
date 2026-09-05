import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyZavuSignature } from "../verify.js";

const SECRET = "whsec_test_secret";

function signV2(rawBody: string, timestamp: number, secret = SECRET): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v2=${hmac}`;
}

describe("verifyZavuSignature", () => {
  it("acepta una firma v2 válida y reciente", () => {
    const rawBody = JSON.stringify({ type: "message.inbound", senderId: "snd_abc" });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signV2(rawBody, timestamp);

    expect(verifyZavuSignature(rawBody, header, SECRET)).toBe(true);
  });

  it("rechaza si el secreto no coincide (comercio equivocado)", () => {
    const rawBody = JSON.stringify({ type: "message.inbound", senderId: "snd_abc" });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signV2(rawBody, timestamp);

    expect(verifyZavuSignature(rawBody, header, "otro_secreto")).toBe(false);
  });

  it("rechaza si el body fue alterado después de firmarlo", () => {
    const rawBody = JSON.stringify({ type: "message.inbound", senderId: "snd_abc" });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signV2(rawBody, timestamp);
    const tamperedBody = JSON.stringify({ type: "message.inbound", senderId: "snd_otro_comercio" });

    expect(verifyZavuSignature(tamperedBody, header, SECRET)).toBe(false);
  });

  it("rechaza una firma con más de 5 minutos de antigüedad", () => {
    const rawBody = JSON.stringify({ type: "message.inbound", senderId: "snd_abc" });
    const timestamp = Math.floor(Date.now() / 1000) - 400;
    const header = signV2(rawBody, timestamp);

    expect(verifyZavuSignature(rawBody, header, SECRET)).toBe(false);
  });

  it("rechaza un header ausente", () => {
    const rawBody = JSON.stringify({ type: "message.inbound", senderId: "snd_abc" });
    expect(verifyZavuSignature(rawBody, undefined, SECRET)).toBe(false);
  });

  it("rechaza un header sin timestamp parseable", () => {
    const rawBody = JSON.stringify({ type: "message.inbound", senderId: "snd_abc" });
    expect(verifyZavuSignature(rawBody, "v2=deadbeef", SECRET)).toBe(false);
  });

  it("acepta el esquema v1 legado (solo body, sin timestamp firmado)", () => {
    const rawBody = JSON.stringify({ type: "message.inbound", senderId: "snd_abc" });
    const timestamp = Math.floor(Date.now() / 1000);
    const v1Hmac = createHmac("sha256", SECRET).update(rawBody).digest("hex");
    const header = `t=${timestamp},v1=${v1Hmac}`;

    expect(verifyZavuSignature(rawBody, header, SECRET)).toBe(true);
  });
});
