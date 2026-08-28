export type PaymentMethod = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito" | "transferencia" | "outro";
export type PaymentStatus = "pago" | "estornado" | "cancelado";
export type Payment = { id: string; paciente_id: string; paciente_nome: string; atendimento_id: string | null; orcamento_id: string | null; referencia: string; valor_centavos: number; forma: PaymentMethod; status: PaymentStatus; data_pagamento: string; responsavel_nome: string; total_count: number };
export type PaymentSummary = { recebido_hoje_centavos: number; recebido_periodo_centavos: number; quantidade_pagamentos: number };
export type PaymentReference = { tipo: "atendimento" | "orcamento"; id: string; descricao: string };
export type PaymentActionState = { success: boolean; error: string | null; fieldErrors?: Record<string, string> };
export const initialPaymentActionState: PaymentActionState = { success: false, error: null };
