import assert from "node:assert/strict";
import test from "node:test";
import { TwoFactorOtpProvider } from "../src/lib/sms/provider";

test("2Factor adapter sends the supplied code with the DLT template without exposing its key in the request body", async () => {
  let request: Request | undefined;
  const provider = new TwoFactorOtpProvider("server-only-secret", "SCHOOL_LOGIN_OTP", async (input, init) => {
    request = new Request(input, init);
    return Response.json({ status: "sent", session_id: "provider-session" });
  });

  await provider.sendLoginCode({ phone: "+919876543210", code: "472918" });
  assert.equal(request?.url, "https://2factor.in/API/V1/OTP/SEND");
  assert.equal(request?.headers.get("x-api-key"), "server-only-secret");
  assert.deepEqual(await request?.json(), {
    to: "+919876543210",
    template_name: "SCHOOL_LOGIN_OTP",
    var1: "472918",
  });
});

test("2Factor adapter rejects provider errors and malformed successful responses", async () => {
  const failed = new TwoFactorOtpProvider("key", "template", async () => new Response("no", { status: 503 }));
  await assert.rejects(failed.sendLoginCode({ phone: "+919876543210", code: "472918" }));
  const malformed = new TwoFactorOtpProvider("key", "template", async () => Response.json({ status: "sent" }));
  await assert.rejects(malformed.sendLoginCode({ phone: "+919876543210", code: "472918" }));
});

test("2Factor adapter converts normalized Indian ten-digit numbers to E.164", async () => {
  let body: { to?: string } | undefined;
  const provider = new TwoFactorOtpProvider("key", "template", async (_input, init) => {
    body = JSON.parse(String(init?.body)) as { to?: string };
    return Response.json({ status: "sent", session_id: "provider-session" });
  });
  await provider.sendLoginCode({ phone: "9876543210", code: "472918" });
  assert.equal(body?.to, "+919876543210");
});
