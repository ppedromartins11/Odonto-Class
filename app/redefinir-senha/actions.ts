"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  clearAuthFlowCookie,
  getVerifiedAuthFlow,
} from "@/lib/auth/flow-cookie";
import { recordAuditEvent } from "@/lib/audit/server";

export type ResetPasswordState = { success: boolean; error: string | null };

export async function updatePassword(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { success: false, error: "A senha precisa ter pelo menos 8 caracteres." };
  }

  if (password !== confirmPassword) {
    return { success: false, error: "As senhas não coincidem." };
  }

  const flow = await getVerifiedAuthFlow();
  if (!flow) {
    return {
      success: false,
      error: "O link é inválido ou expirou. Solicite uma nova redefinição.",
    };
  }

  const supabase = await createSupabaseServerClient();

  // Supabase estabelece uma sessao de recuperacao temporaria quando o
  // usuario segue o link do e-mail (redirectTo configurado em
  // esqueci-senha/actions.ts). updateUser usa essa sessao - nao exige
  // a senha antiga.
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return {
      success: false,
      error: "Não foi possível redefinir a senha. O link pode ter expirado - solicite um novo.",
    };
  }

  await recordAuditEvent({
    usuarioId: flow.sub,
    evento: flow.flow === "invite" ? "convite_aceito" : "senha_redefinida",
    entidade: "usuarios",
    entidadeId: flow.sub,
  });

  await clearAuthFlowCookie();
  await supabase.auth.signOut();
  return { success: true, error: null };
}
