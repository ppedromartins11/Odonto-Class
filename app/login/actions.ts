"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

export async function signInWithPassword(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Informe e-mail e senha." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Mensagem generica de proposito - nao confirmar se o e-mail existe
    // ou nao evita dar pista util para tentativa de acesso indevido.
    return { error: "E-mail ou senha inválidos." };
  }

  redirect("/dashboard");
}
