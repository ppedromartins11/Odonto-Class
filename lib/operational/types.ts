export type ReturnStatus = "pendente" | "agendado" | "concluido" | "cancelado";
export type TaskStatus = "pendente" | "em_andamento" | "concluida" | "cancelada";
export type TaskPriority = "alta" | "media" | "baixa" | "urgente";
export type DocumentType = "atestado" | "declaracao" | "declaracao_comparecimento" | "declaracao_acompanhamento";
export type NewDocumentType = Exclude<DocumentType, "declaracao">;
export type DocumentAuthorAttendance = { id: string; profissional_id: string; profissional_nome: string; registro_profissional: string | null; iniciado_em: string; finalizado_em: string | null; status: "em_andamento" | "finalizado" };
export type FileCategory = "administrativo" | "clinico";

export type DomainActionState = { success: boolean; error: string | null; fieldErrors?: Record<string, string> };
export type OperationalReturn = { id: string; paciente_id: string; atendimento_origem_id: string | null; profissional_id: string | null; data_prevista: string; status: ReturnStatus; observacao_administrativa: string | null; agendamento_id: string | null; created_at: string; paciente_nome: string; profissional_nome: string | null };
export type OperationalTask = { id: string; titulo: string; descricao: string | null; status: TaskStatus; prioridade: TaskPriority; prazo: string | null; responsavel_id: string; paciente_id: string | null; agendamento_id: string | null; created_by: string; created_at: string; responsavel_nome: string; paciente_nome: string | null };
export type PatientDocument = { id: string; paciente_id: string; profissional_id: string; tipo: DocumentType; emitido_em: string; periodo_inicio: string | null; periodo_fim: string | null; texto_adicional: string | null; nome_arquivo: string; tamanho_bytes: number; created_at: string; atendimento_id: string | null; finalidade: string | null; comparecimento_inicio: string | null; comparecimento_fim: string | null; afastamento_quantidade: number | null; afastamento_unidade: "horas" | "dias" | null; acompanhante_nome: string | null; layout_version: number; pdf_sha256: string | null; created_by: string };
export type OperationalDocument = PatientDocument & { paciente_nome: string; profissional_nome: string };
export type PatientFile = { id: string; paciente_id: string; nome_original: string; mime_type: string; tamanho_bytes: number; categoria: FileCategory; status: "ativo" | "removido"; created_at: string; uploaded_by: string };
