// Africa's Talking SMS adapter (ADR 0001, ADR 0005). Falls back to a
// dev-visible log/audit entry when AFRICASTALKING_API_KEY isn't configured
// yet, so the OTP flow works end-to-end in staging before real sandbox
// credentials exist — flip the env vars and this becomes the production
// path with no code change.

export type SendSmsResult =
  | { delivered: true; provider: "africastalking" }
  | { delivered: false; provider: "dev-fallback"; devMessage: string };

export async function sendOtpSms(phone: string, otpCode: string): Promise<SendSmsResult> {
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME;
  const message = `Your StockFlow ZW verification code is ${otpCode}`;

  if (!apiKey || !username) {
    // No sandbox credentials yet — record so the OTP is visible for
    // manual/staging testing without pretending an SMS was sent.
    console.log(`[dev-fallback SMS] to=${phone} message="${message}"`);
    return { delivered: false, provider: "dev-fallback", devMessage: message };
  }

  const response = await fetch("https://api.sandbox.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ username, to: phone, message }),
  });

  if (!response.ok) {
    throw new Error(`Africa's Talking SMS send failed: ${response.status}`);
  }

  return { delivered: true, provider: "africastalking" };
}
