export type AppointmentStatus =
  | "agendado"
  | "confirmado"
  | "atendido"
  | "cancelado"
  | "faltou";

export type Appointment = {
  id: string;
  paciente_id: string;
  profissional_id: string;
  inicio: string;
  fim: string;
  status: AppointmentStatus;
  observacoes_administrativas: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type AgendaItem = Pick<
  Appointment,
  | "id"
  | "paciente_id"
  | "profissional_id"
  | "inicio"
  | "fim"
  | "status"
  | "observacoes_administrativas"
> & {
  paciente_nome: string;
  profissional_nome: string;
};

export type ActiveProfessional = {
  id: string;
  usuario_id: string;
  nome: string;
  registro_profissional: string | null;
};

export type AppointmentFormValues = {
  pacienteId: string;
  profissionalId: string;
  inicioLocal: string;
  fimLocal: string;
  observacoesAdministrativas: string | null;
};

export type DomainActionState = {
  success: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
};
