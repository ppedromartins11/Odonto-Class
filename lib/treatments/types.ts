import type { FdiTooth } from "@/lib/odontogram/fdi";

export type TreatmentPlanStatus = "planejado" | "em_andamento" | "concluido" | "cancelado";
export type TreatmentPlanItemStatus = "planejado" | "em_andamento" | "realizado" | "cancelado";

export type TreatmentPlanSummary = {
  id: string;
  paciente_id: string;
  orcamento_id: string;
  profissional_id: string;
  status: TreatmentPlanStatus;
  created_at: string;
  cancelled_at: string | null;
  total_items: number;
  completed_items: number;
  progress_percent: number;
};

export type TreatmentPlanProcedure = {
  id: string;
  atendimento_id: string;
  quantidade: number;
  attendance_status: "em_andamento" | "finalizado";
  teeth: FdiTooth[];
};

export type TreatmentPlanClinicalItem = {
  id: string;
  descricao_snapshot: string;
  quantidade_planejada: number;
  quantidade_executada: number;
  quantidade_restante: number;
  status: TreatmentPlanItemStatus;
  procedures: TreatmentPlanProcedure[];
};

export type TreatmentPlanDetail = TreatmentPlanSummary & {
  clinical_items?: TreatmentPlanClinicalItem[];
};

export type AvailableTreatmentPlanItem = {
  id: string;
  descricao_snapshot: string;
  quantidade_restante: number;
};

export type TreatmentPlanActionState = {
  success: boolean;
  error: string | null;
  planId?: string;
};

export const initialTreatmentPlanActionState: TreatmentPlanActionState = { success: false, error: null };
