"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PerfilUsuario } from "@/lib/auth/session";

export type CreateUsuarioState = { error: string | null; success: boolean };

const PERFIS_VALIDOS: PerfilUsuario[] = ["administrador", "dentista", "recepcao"];

/**
 * Cria um novo usuario do sistema. Restrito a administrador - a
 * verificacao acontece AQUI, no servidor, antes de qualquer chamada
 * privilegiada, e nao apenas por este formulario estar escondido na UI
 * para quem nao e admin (ver lib/auth/session.ts).
 *
 * Fluxo: convite por e-mail via Supabase Admin API (o usuario define a
 * propria senha ao aceitar) + criacao do registro correspondente em
 * `usuarios`. Nao ha autocadastro no sistema.
 */
export async function createUsuario(
  _prevState: CreateUsuarioState,
  formData: FormData
): Promise<CreateUsuarioState> {
  await requireAdmin();

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const perfil = String(formData.get("perfil") ?? "") as PerfilUsuario;

  if (!nome || !email) {
    return { error: "Nome e e-mail são obrigatórios.", success: false };
  }

  if (!PERFIS_VALIDOS.includes(perfil)) {
    return { error: "Selecione um perfil válido.", success: false };
  }

  const admin = createSupabaseAdminClient();

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email
  );

  if (inviteError || !invited.user) {
    return {
      error: `Não foi possível convidar o usuário: ${inviteError?.message ?? "erro desconhecido"}.`,
      success: false,
    };
  }

  const { error: insertError } = await admin.from("usuarios").insert({
    id: invited.user.id,
    nome,
    email,
    perfil,
  });

  if (insertError) {
    // O convite ja foi enviado, mas o perfil de aplicacao falhou ao
    // salvar - isso deixa o usuario "orfao" (existe no auth, nao em
    // `usuarios`). getCurrentUser() trata esse caso como nao-autenticado
    // por seguranca, mas o certo e revisar manualmente no Supabase.
    return {
      error: `Convite enviado, mas houve erro ao salvar o perfil: ${insertError.message}. Verifique manualmente no Supabase.`,
      success: false,
    };
  }

  // Usuarios com perfil "dentista" ganham um registro correspondente em
  // `profissionais` (relacao 1:1 do schema aprovado - docs/DATABASE.md).
  // registro_profissional (CRO) fica em branco por enquanto - PAV em
  // aberto se e obrigatorio; preencher isso nao e parte desta sprint.
  if (perfil === "dentista") {
    const { error: profissionalError } = await admin.from("profissionais").insert({
      usuario_id: invited.user.id,
    });

    if (profissionalError) {
      return {
        error: `Usuário criado, mas houve erro ao registrar o profissional: ${profissionalError.message}. Verifique manualmente no Supabase.`,
        success: false,
      };
    }
  }

  revalidatePath("/usuarios");
  return { error: null, success: true };
}
