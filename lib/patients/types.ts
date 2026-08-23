export type Patient = {
  id: string;
  nome: string;
  data_nascimento: string | null;
  telefone_contato: string | null;
  documento_identificacao: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type PatientListItem = Pick<
  Patient,
  "id" | "nome" | "data_nascimento" | "telefone_contato" | "ativo"
> & {
  total_count: number;
};

export type PatientClinicalAlerts = {
  paciente_id: string;
  alergias: string | null;
  intolerancias: string | null;
  medicamentos_em_uso: string | null;
  updated_at: string;
  updated_by: string;
};

export type PatientActionState = {
  success: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
};

export type PatientFormValues = {
  nome: string;
  dataNascimento: string | null;
  telefoneContato: string | null;
  documentoIdentificacao: string | null;
};

export type PatientClinicalAlertValues = {
  alergias: string | null;
  intolerancias: string | null;
  medicamentosEmUso: string | null;
};
