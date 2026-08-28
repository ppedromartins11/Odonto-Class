export type BudgetStatus = "rascunho" | "enviado" | "aprovado" | "rejeitado" | "expirado" | "convertido";

export type BudgetItem = {
  id: string;
  orcamento_id: string;
  descricao: string;
  quantidade: number;
  valor_unitario_centavos: number;
  total_centavos: number;
  ativo: boolean;
};

export type Budget = {
  id: string;
  numero: number;
  paciente_id: string;
  profissional_id: string;
  data_orcamento: string;
  validade_em: string | null;
  observacao_administrativa: string | null;
  status: BudgetStatus;
  effective_status: BudgetStatus;
  total_centavos: number;
  created_at: string;
  paciente_nome: string;
  profissional_nome: string;
};

export type BudgetDetail = Budget & { items: BudgetItem[] };

export type BudgetActionState = {
  success: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
};

export const initialBudgetActionState: BudgetActionState = { success: false, error: null };
