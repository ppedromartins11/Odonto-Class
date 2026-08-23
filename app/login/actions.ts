"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserState } from "@/lib/auth/session";
import type { LoginState } from "./types";

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

  const state = await getCurrentUserState();
  if (state.kind !== "authenticated") {
    await supabase.auth.signOut();
    return {
      error:
        state.kind === "error"
          ? "Não foi possível validar o acesso agora. Tente novamente."
          : "Acesso indisponível. Contate o administrador da clínica.",
    };
  }

  redirect("/dashboard");
}
