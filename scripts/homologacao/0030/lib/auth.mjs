import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { assertGuard } from "../../lib/safety.mjs";
import { readLinkedProjectRef } from "../config.mjs";

function assertQaTarget(env) { assertGuard(env, readLinkedProjectRef(), "remote"); }

const actorVariables = {
  admin: ["HOMOLOGATION_ADMIN_EMAIL", "HOMOLOGATION_ADMIN_PASSWORD"],
  dentistA: ["HOMOLOGATION_DENTIST_A_EMAIL", "HOMOLOGATION_DENTIST_A_PASSWORD"],
  dentistB: ["HOMOLOGATION_DENTIST_B_EMAIL", "HOMOLOGATION_DENTIST_B_PASSWORD"],
  reception: ["HOMOLOGATION_RECEPTION_EMAIL", "HOMOLOGATION_RECEPTION_PASSWORD"],
};

export function createAnonClient(env = process.env) {
  assertQaTarget(env);
  return createClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createServiceClient(env = process.env) {
  assertQaTarget(env);
  const key = env.SUPABASE_TEST_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_TEST_SERVICE_ROLE_KEY necessária somente para preparar/remover fixtures locais.");
  return createClient(env.SUPABASE_TEST_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function readHiddenOtp() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("ACTION_REQUIRED: MFA_STEP_UP (terminal interativo necessário; OTP não pode ser lido com segurança aqui).");
  }
  const input = process.stdin;
  process.stdout.write("Insira o OTP do autenticador QA (entrada oculta): ");
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (buffer) => {
      for (const char of buffer.toString("utf8")) {
        if (char === "\u0003") { cleanup(); reject(new Error("MFA prompt cancelado.")); return; }
        if (char === "\r" || char === "\n") { cleanup(); resolve(value); return; }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (/^[0-9]$/.test(char) && value.length < 10) value += char;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

export async function assertCurrentAssuranceLevel(client) {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) throw new Error("Não foi possível verificar o nível MFA da sessão QA.");
  if (data.currentLevel === "aal2") return;
  if (data.nextLevel !== "aal2") throw new Error("ACTION_REQUIRED: MFA_ENROLLMENT (conclua o MFA pelo fluxo normal do sistema).");

  const { data: factorsData, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError) throw new Error("Não foi possível consultar fatores MFA da identidade QA.");
  const factor = factorsData?.totp?.find((item) => item.status === "verified");
  if (!factor) throw new Error("ACTION_REQUIRED: MFA_ENROLLMENT (conclua o MFA pelo fluxo normal do sistema).");
  let code = await readHiddenOtp();
  try {
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (verifyError) throw new Error("MFA_STEP_UP_FAILED");
  } finally {
    code = "";
  }
  const after = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (after.error || after.data?.currentLevel !== "aal2") throw new Error("ACTION_REQUIRED: MFA_STEP_UP");
}

export async function authenticateActor(actor, env = process.env) {
  assertQaTarget(env);
  const variables = actorVariables[actor];
  if (!variables) throw new Error("Ator QA inválido.");
  const [emailName, passwordName] = variables;
  const email = env[emailName]?.trim();
  const password = env[passwordName];
  if (!email || !password) throw new Error(`ACTION_REQUIRED: configure ${emailName} e ${passwordName} localmente após aceitar o convite.`);
  const cookieJar = new Map();
  const client = createServerClient(env.SUPABASE_TEST_URL, env.SUPABASE_TEST_ANON_KEY, {
    cookies: {
      getAll: () => [...cookieJar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => { for (const { name, value } of cookies) cookieJar.set(name, value); },
    },
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`AUTHENTICATION_FAILED:${actor}`);
  await assertCurrentAssuranceLevel(client);
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(`AUTHENTICATED_USER_UNVERIFIED:${actor}`);
  return {
    client,
    getCookieHeader: () => [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
  };
}
