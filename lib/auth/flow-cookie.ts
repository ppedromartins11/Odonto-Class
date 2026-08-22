import "server-only";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  signAuthFlowToken,
  verifyAuthFlowToken,
  type AuthFlow,
} from "@/lib/auth/flow-token";

const AUTH_FLOW_COOKIE = "clinica_auth_flow";
const AUTH_FLOW_MAX_AGE_SECONDS = 10 * 60;

function getSecret() {
  const secret = process.env.AUTH_FLOW_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_FLOW_COOKIE_SECRET deve estar configurado com no minimo 32 caracteres."
    );
  }
  return secret;
}

export async function setAuthFlowCookie(userId: string, flow: AuthFlow) {
  const cookieStore = await cookies();
  const now = Math.floor(Date.now() / 1000);
  const token = signAuthFlowToken(
    { sub: userId, flow, exp: now + AUTH_FLOW_MAX_AGE_SECONDS },
    getSecret()
  );

  cookieStore.set(AUTH_FLOW_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_FLOW_MAX_AGE_SECONDS,
  });
}

export async function clearAuthFlowCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_FLOW_COOKIE);
}

export async function getVerifiedAuthFlow() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_FLOW_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const payload = verifyAuthFlowToken(token, getSecret());
  if (!payload) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || user.id !== payload.sub) {
    return null;
  }

  return payload;
}
