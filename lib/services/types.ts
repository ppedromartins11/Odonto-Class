export const SERVICE_STATUSES = ["ativo", "inativo", "todos"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export type Service = {
  id: string;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  valor_padrao_centavos: number;
  ativo: boolean;
  total_count: number;
};

export type ServiceMaterial = {
  id: string;
  material_id: string;
  material_nome: string;
  quantidade_padrao: number;
  ativo: boolean;
};

export type ServiceActionState = {
  success: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
};

export const initialServiceActionState: ServiceActionState = { success: false, error: null };

export type FinalizationPreviewItem = {
  material_id: string;
  material_nome: string;
  necessario: number;
  disponivel: number;
  saldo_apos: number;
  suficiente: boolean;
};
