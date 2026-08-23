"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/config/site";
import type { ForgotPasswordState } from "./types";

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { submitted: false, error: "Informe seu e-mail." };
  }

  const supabase = await createSupabaseServerClient();
  const siteUrl = getSiteUrl();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?flow=recovery`,
  });

  // Sempre retorna sucesso, mesmo se o e-mail nao existir na base - evita
  // que a tela seja usada para descobrir quais e-mails tem conta.
  if (error) {
    console.error("Falha ao solicitar redefinicao de senha", {
      status: error.status,
      code: error.code,
    });
  }

  return { submitted: true, error: null };
}
