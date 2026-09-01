export const VALIDITY_STATUSES = ["valido", "proximo_do_vencimento", "vencido", "esgotado", "inativo"] as const;
export const CYCLE_STATUSES = ["em_andamento", "concluido", "reprovado", "cancelado"] as const;
export const PACKAGE_STATUSES = ["pendente", "ativo", "utilizado", "descartado"] as const;
export const PACKAGE_EFFECTIVE_STATUSES = ["pendente", "valido", "proximo_do_vencimento", "vencido", "utilizado", "descartado"] as const;

export type ValidityStatus = (typeof VALIDITY_STATUSES)[number];
export type CycleStatus = (typeof CYCLE_STATUSES)[number];
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];
export type PackageEffectiveStatus = (typeof PACKAGE_EFFECTIVE_STATUSES)[number];

export type ValidityLot = {
  id: string;
  material_id: string;
  material_nome: string;
  codigo_lote: string;
  quantidade_atual: number;
  saldo_disponivel: number;
  data_fabricacao: string | null;
  data_validade: string;
  fornecedor: string | null;
  ativo: boolean;
  status: ValidityStatus;
  dias_restantes: number;
  total_count: number;
};

export type OperationalSummary = {
  lotes_validos: number;
  lotes_vencendo: number;
  lotes_vencidos: number;
  lotes_esgotados: number;
  pacotes_validos: number;
  pacotes_vencendo: number;
  pacotes_vencidos: number;
  ciclos_hoje: number;
  ciclos_em_andamento: number;
  ciclos_reprovados: number;
};

export type DomainActionState = { success: boolean; error: string | null; fieldErrors?: Record<string, string> };
export const initialDomainActionState: DomainActionState = { success: false, error: null };
