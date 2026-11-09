/** Server-only SMS provider boundary. Never import this module from client code. */
export type OtpSmsRequest = {
  phone: string;
  code: string;
};

export type OtpSmsProvider = {
  sendLoginCode(input: OtpSmsRequest): Promise<void>;
};

type TwoFactorResponse = {
  status?: string;
  session_id?: string;
  message?: string;
};

/**
 * 2Factor sends the app-generated code using a DLT-approved template. Keeping
 * verification in our application lets us enforce one-time use and attempt
 * limits uniformly, and keeps provider-specific concerns behind this adapter.
 */
export class TwoFactorOtpProvider implements OtpSmsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly templateName: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey || !templateName) throw new Error("2Factor OTP is not configured");
  }

  async sendLoginCode({ phone, code }: OtpSmsRequest): Promise<void> {
    const response = await this.fetcher("https://2factor.in/API/V1/OTP/SEND", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": this.apiKey },
      body: JSON.stringify({ to: phone, template_name: this.templateName, var1: code }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("OTP provider request failed");
    const result = await response.json() as TwoFactorResponse;
    if (result.status?.toLowerCase() !== "sent" || !result.session_id) {
      throw new Error("OTP provider did not accept the message");
    }
  }
}

export function configuredOtpProvider(): OtpSmsProvider {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  const templateName = process.env.TWOFACTOR_LOGIN_TEMPLATE;
  if (!apiKey || !templateName) throw new Error("OTP provider is not configured");
  return new TwoFactorOtpProvider(apiKey, templateName);
}
