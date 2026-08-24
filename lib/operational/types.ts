export type ReturnStatus = "pendente" | "agendado" | "concluido" | "cancelado";
export type TaskStatus = "pendente" | "concluida" | "cancelada";
export type DocumentType = "atestado" | "declaracao";
export type FileCategory = "administrativo" | "clinico";

export type DomainActionState = { success: boolean; error: string | null; fieldErrors?: Record<string, string> };
export type OperationalReturn = { id: string; paciente_id: string; atendimento_origem_id: string | null; profissional_id: string | null; data_prevista: string; status: ReturnStatus; observacao_administrativa: string | null; agendamento_id: string | null; created_at: string; paciente_nome: string; profissional_nome: string | null };
export type OperationalTask = { id: string; titulo: string; descricao: string | null; status: TaskStatus; prazo: string | null; responsavel_id: string; paciente_id: string | null; agendamento_id: string | null; created_by: string; created_at: string };
export type PatientDocument = { id: string; paciente_id: string; profissional_id: string; tipo: DocumentType; emitido_em: string; periodo_inicio: string | null; periodo_fim: string | null; texto_adicional: string | null; nome_arquivo: string; tamanho_bytes: number; created_at: string };
export type OperationalDocument = PatientDocument & { paciente_nome: string; profissional_nome: string };
export type PatientFile = { id: string; paciente_id: string; nome_original: string; mime_type: string; tamanho_bytes: number; categoria: FileCategory; status: "ativo" | "removido"; created_at: string; uploaded_by: string };
