"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { submitted: boolean; error: string | null };

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { submitted: false, error: "Informe seu e-mail." };
  }

  const supabase = await createSupabaseServerClient();
  const headerList = await headers();
  const origin = headerList.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/redefinir-senha`,
  });

  // Sempre retorna sucesso, mesmo se o e-mail nao existir na base - evita
  // que a tela seja usada para descobrir quais e-mails tem conta.
  if (error) {
    console.error("Erro ao solicitar redefinição de senha:", error.message);
  }

  return { submitted: true, error: null };
}
