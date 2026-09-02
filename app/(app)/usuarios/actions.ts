"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/config/site";
import { recordAuditEvent } from "@/lib/audit/server";
import { normalizeUserProfileInput } from "@/lib/users/profile";
import type { PerfilUsuario } from "@/lib/auth/session";
import type { CreateUsuarioState, UpdateUsuarioAccessState, UpdateUsuarioProfileState } from "./types";

const PERFIS_VALIDOS: PerfilUsuario[] = ["administrador", "dentista", "recepcao"];

/**
 * Cria um novo usuario do sistema. Restrito a administrador - a
 * verificacao acontece AQUI, no servidor, antes de qualquer chamada
 * privilegiada, e nao apenas por este formulario estar escondido na UI
 * para quem nao e admin (ver lib/auth/session.ts).
 *
 * Fluxo: convite por e-mail via Supabase Admin API. O trigger
 * `handle_new_auth_user` provisiona `usuarios`, `profissionais` (quando
 * dentista) e a auditoria na mesma transacao da criacao em auth.users.
 * Nao ha autocadastro no sistema.
 */
export async function createUsuario(
  _prevState: CreateUsuarioState,
  formData: FormData
): Promise<CreateUsuarioState> {
  const actor = await requireAdmin();

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

  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        nome,
        perfil,
        created_by: actor.id,
      },
      redirectTo: `${getSiteUrl()}/auth/confirm`,
    });

  if (inviteError || !invited.user) {
    console.error("Falha ao convidar usuario", {
      status: inviteError?.status,
      code: inviteError?.code,
    });
    return {
      error: "Não foi possível enviar o convite. Verifique o e-mail e tente novamente.",
      success: false,
    };
  }

  revalidatePath("/usuarios");
  return { error: null, success: true };
}

function isPerfilUsuario(value: string): value is PerfilUsuario {
  return PERFIS_VALIDOS.includes(value as PerfilUsuario);
}

/**
 * Altera perfil e/ou status por uma RPC security definer que valida admin
 * ativo, protege o ultimo administrador e sincroniza profissionais.
 *
 * A desativacao bloqueia primeiro os dados via RLS e depois suspende a
 * conta Auth. Assim, uma falha na API administrativa nunca reabre acesso
 * aos dados da clinica. A reativacao usa compensacao para manter o estado
 * anterior caso a RPC falhe.
 */
export async function updateUsuarioAccess(
  formData: FormData
): Promise<UpdateUsuarioAccessState> {
  const actor = await requireAdmin();

  const usuarioId = String(formData.get("usuarioId") ?? "").trim();
  const perfilRaw = String(formData.get("perfil") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "").trim();

  if (!usuarioId) {
    return { error: "Usuário inválido.", success: false };
  }

  const perfil = perfilRaw ? perfilRaw : null;
  const status = statusRaw ? statusRaw : null;

  if (perfil !== null && !isPerfilUsuario(perfil)) {
    return { error: "Perfil inválido.", success: false };
  }

  if (status !== null && status !== "ativo" && status !== "inativo") {
    return { error: "Status inválido.", success: false };
  }

  if (perfil === null && status === null) {
    return { error: "Nenhuma alteração foi informada.", success: false };
  }

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (status === "ativo") {
    const { error: unbanError } = await admin.auth.admin.updateUserById(usuarioId, {
      ban_duration: "none",
    });

    if (unbanError) {
      console.error("Falha ao reativar conta Auth", {
        status: unbanError.status,
        code: unbanError.code,
      });
      return {
        error: "Não foi possível reativar a conta de acesso.",
        success: false,
      };
    }
  }

  const { error: accessError } = await supabase.rpc("update_user_access", {
    p_usuario_id: usuarioId,
    p_perfil: perfil,
    p_status: status,
  });

  if (accessError) {
    if (status === "ativo") {
      const { error: compensationError } =
        await admin.auth.admin.updateUserById(usuarioId, {
          ban_duration: "876000h",
        });
      if (compensationError) {
        console.error("Falha na compensacao da reativacao Auth", {
          status: compensationError.status,
          code: compensationError.code,
        });
      }
    }

    console.error("Falha na RPC update_user_access", {
      code: accessError.code,
    });
    if (accessError.code === "23514" || accessError.code === "42501") {
      await recordAuditEvent({
        usuarioId: actor.id,
        evento: "acao_administrativa_negada",
        entidade: "usuarios",
        entidadeId: usuarioId,
        dados: { motivo_codigo: accessError.code },
      });
    }
    return {
      error:
        accessError.code === "23514" || accessError.code === "42501"
          ? "A alteração foi recusada pelas regras de segurança administrativa."
          : "Não foi possível alterar o acesso do usuário.",
      success: false,
    };
  }

  if (status === "inativo") {
    const { error: banError } = await admin.auth.admin.updateUserById(usuarioId, {
      ban_duration: "876000h",
    });

    if (banError) {
      console.error("Falha ao suspender conta Auth", {
        status: banError.status,
        code: banError.code,
      });
      revalidatePath("/usuarios");
      return {
        error:
          "O acesso aos dados foi bloqueado, mas a suspensão da conta precisa ser tentada novamente.",
        success: false,
      };
    }
  }

  revalidatePath("/usuarios");
  return { error: null, success: true };
}

export async function updateUsuarioProfile(
  formData: FormData
): Promise<UpdateUsuarioProfileState> {
  await requireAdmin();
  const usuarioId = String(formData.get("usuarioId") ?? "").trim();
  if (!usuarioId) return { error: "Usuário inválido.", success: false };

  const parsed = normalizeUserProfileInput({
    nome: formData.get("nome"),
    registroProfissional: formData.get("registroProfissional"),
  });
  if ("error" in parsed) return { error: parsed.error, success: false };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_user_profile", {
    p_usuario_id: usuarioId,
    p_nome: parsed.data.nome,
    p_registro_profissional: parsed.data.registroProfissional,
  });

  if (error) {
    const messages: Record<string, string> = {
      "23505": "Este registro profissional já está associado a outro dentista.",
      "42501": "Apenas um administrador ativo pode alterar dados de usuário.",
      P0002: "Usuário não encontrado.",
      "23514": "Os dados profissionais não puderam ser atualizados. Revise os campos e tente novamente.",
    };
    console.error("Falha na RPC update_user_profile", { code: error.code });
    return { error: messages[error.code] ?? "Não foi possível atualizar o usuário.", success: false };
  }

  revalidatePath("/usuarios");
  return { error: null, success: true };
}
