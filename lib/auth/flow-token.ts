import { createHmac, timingSafeEqual } from "node:crypto";

export type AuthFlow = "invite" | "recovery";

export type AuthFlowPayload = {
  sub: string;
  flow: AuthFlow;
  exp: number;
};

function signatureFor(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signAuthFlowToken(payload: AuthFlowPayload, secret: string) {
  if (secret.length < 32) {
    throw new Error("AUTH_FLOW_COOKIE_SECRET deve ter no minimo 32 caracteres.");
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signatureFor(encodedPayload, secret)}`;
}

export function verifyAuthFlowToken(
  token: string,
  secret: string,
  nowInSeconds = Math.floor(Date.now() / 1000)
): AuthFlowPayload | null {
  if (secret.length < 32) {
    return null;
  }

  const [encodedPayload, providedSignature, extraPart] = token.split(".");
  if (!encodedPayload || !providedSignature || extraPart) {
    return null;
  }

  const expectedSignature = signatureFor(encodedPayload, secret);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<AuthFlowPayload>;

    if (
      typeof payload.sub !== "string" ||
      (payload.flow !== "invite" && payload.flow !== "recovery") ||
      typeof payload.exp !== "number" ||
      payload.exp <= nowInSeconds
    ) {
      return null;
    }

    return payload as AuthFlowPayload;
  } catch {
    return null;
  }
}
