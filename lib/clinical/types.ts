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
};

export type ProcedureFormValues = {
  descricao: string;
  dente: string | null;
  materialUtilizado: string | null;
  corResina: string | null;
  detalhes: string | null;
};
import type { DomainActionState } from "@/lib/agenda/types";
import type { FdiTooth } from "@/lib/odontogram/fdi";
