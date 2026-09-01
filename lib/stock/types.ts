export const STOCK_UNITS = ["unidade", "caixa", "pacote", "frasco", "kit", "outro"] as const;
export const STOCK_MOVEMENT_TYPES = ["entrada", "saida", "ajuste"] as const;
export const STOCK_STATUSES = ["normal", "estoque_baixo", "vencendo", "vencido", "inativo"] as const;

export type StockUnit = (typeof STOCK_UNITS)[number];
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export type StockStatus = (typeof STOCK_STATUSES)[number];

export type StockMaterial = {
  id: string;
  nome: string;
  categoria: string;
  unidade: StockUnit;
  quantidade_atual: number;
  estoque_minimo: number;
  validade: string | null;
  fornecedor: string | null;
  ativo: boolean;
  controla_lote_validade?: boolean;
  estoque_baixo: boolean;
  vencendo: boolean;
  vencido: boolean;
  total_count: number;
};

export type StockMovement = {
  id: string;
  material_id: string;
  material_nome: string;
  tipo: StockMovementType;
  quantidade: number;
  motivo: string | null;
  referencia: string | null;
  quantidade_anterior: number;
  quantidade_posterior: number;
  created_at: string;
  usuario_nome: string;
  total_count: number;
};

export type StockSummary = { total_ativos: number; estoque_baixo: number; vencendo: number; vencidos: number };
export type StockActionState = { success: boolean; error: string | null; fieldErrors?: Record<string, string> };
export const initialStockActionState: StockActionState = { success: false, error: null };
