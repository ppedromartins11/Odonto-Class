export type AttendanceStatus = "em_andamento" | "finalizado";

export type Attendance = {
  id: string;
  agendamento_id: string | null;
  paciente_id: string;
  profissional_id: string;
  iniciado_em: string;
  finalizado_em: string | null;
  status: AttendanceStatus;
  evolucao: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type Procedure = {
  id: string;
  atendimento_id: string;
  descricao: string;
  dente: string | null;
  material_utilizado: string | null;
  cor_resina: string | null;
  detalhes: string | null;
  servico_id?: string | null;
  plano_tratamento_item_id?: string | null;
  quantidade?: number;
  valor_aplicado_centavos?: number | null;
  teeth: FdiTooth[];
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type ProcedureActionState = DomainActionState & {
  procedureId?: string;
  procedureSaved?: boolean;
  attemptedTeeth?: FdiTooth[];
  planLinkPending?: boolean;
  pendingPlanItemId?: string;
};

export type ProcedureFormValues = {
  descricao: string;
  dente: string | null;
  materialUtilizado: string | null;
  corResina: string | null;
  detalhes: string | null;
};

export type ClinicalMaterialOption = {
  id: string;
  nome: string;
  unidade: string;
  quantidade_atual: number;
  controla_lote_validade: boolean;
};

export type ClinicalLotOption = {
  id: string;
  material_id: string;
  codigo_lote: string;
  data_validade: string;
  quantidade_atual: number;
};

export type ClinicalMaterialSuggestion = {
  id: string;
  procedimento_id: string;
  material_id: string;
  material_nome: string;
  unidade: string;
  quantidade_prevista: number;
  controla_lote_validade: boolean;
  consumo_ativo_registrado: boolean;
};

export type ClinicalMaterialConsumption = {
  id: string;
  procedimento_id: string;
  procedimento_material_consumo_id: string | null;
  material_id: string;
  material_nome: string;
  unidade: string;
  lote_id: string | null;
  lote_codigo: string | null;
  lote_validade: string | null;
  quantidade: number;
  created_at: string;
  estornado_em: string | null;
  movimentacao_estoque_id: string;
  movimentacao_lote_id: string | null;
  movimentacao_estorno_id: string | null;
};

export type AttendanceClinicalMaterials = {
  consumptions: ClinicalMaterialConsumption[];
  suggestions: ClinicalMaterialSuggestion[];
  materials: ClinicalMaterialOption[];
};

export type ClinicalMaterialActionState = DomainActionState & {
  notice?: string;
};
import type { DomainActionState } from "@/lib/agenda/types";
import type { FdiTooth } from "@/lib/odontogram/fdi";
