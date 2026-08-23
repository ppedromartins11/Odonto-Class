import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AuditEvent =
  | "usuario_convidado"
  | "convite_aceito"
  | "usuario_ativado"
  | "usuario_desativado"
  | "perfil_alterado"
  | "acao_administrativa_negada"
  | "senha_redefinida"
  | "configuracao_acesso_alterada"
  | "paciente_criado"
  | "paciente_atualizado"
  | "paciente_inativado"
  | "paciente_reativado"
  | "alertas_clinicos_atualizados";

type AuditEntry = {
  usuarioId: string | null;
  evento: AuditEvent;
  entidade: string;
  entidadeId?: string | null;
  dados?: Record<string, string | number | boolean | null>;
};

/**
 * Grava somente metadados de seguranca usando a service role. O helper
 * nunca recebe senha, token, texto clinico ou outros dados sensiveis.
 */
export async function recordAuditEvent(entry: AuditEntry): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("auditoria").insert({
      usuario_id: entry.usuarioId,
      evento: entry.evento,
      entidade: entry.entidade,
      entidade_id: entry.entidadeId ?? null,
      dados: entry.dados ?? {},
    });

    if (error) {
      console.error("Falha ao registrar evento de auditoria", {
        code: error.code,
        evento: entry.evento,
      });
      return false;
    }

    return true;
  } catch {
    console.error("Falha de configuracao ao registrar evento de auditoria", {
      evento: entry.evento,
    });
    return false;
  }
}
