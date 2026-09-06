import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FinancialInstallment, FinancialReceivable, Payment, PaymentMethod, PaymentReference, PaymentStatus, PaymentSummary } from "./types";
import type { ReceivableStatus } from "./receivables";

function fail(scope: string, code?: string): never { console.error(scope, { code }); throw new Error(scope); }
export async function listPayments(options: { query?: string; patientId?: string; startDate?: string; endDate?: string; method?: PaymentMethod; status?: PaymentStatus; page: number; pageSize?: number }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payments", { p_query: options.query || null, p_paciente_id: options.patientId || null, p_data_inicio: options.startDate || null, p_data_fim: options.endDate || null, p_forma: options.method || null, p_status: options.status || null, p_page: options.page, p_page_size: options.pageSize ?? 20 });
  if (error) fail("PAYMENTS_LIST_FAILED", error.code);
  const payments = (data ?? []) as Payment[];
  return { payments, total: Number(payments[0]?.total_count ?? 0), pageSize: options.pageSize ?? 20 };
}
export async function listPaymentReferences(patientId: string) { const supabase = await createSupabaseServerClient(); const { data, error } = await supabase.rpc("list_payment_references", { p_paciente_id: patientId }); if (error) fail("PAYMENT_REFERENCES_FAILED", error.code); return (data ?? []) as PaymentReference[]; }
export async function getPaymentSummary(startDate: string, endDate: string): Promise<PaymentSummary> { const supabase = await createSupabaseServerClient(); const { data, error } = await supabase.rpc("get_payment_summary", { p_data_inicio: startDate, p_data_fim: endDate }); if (error) fail("PAYMENT_SUMMARY_FAILED", error.code); return ((data ?? [])[0] as PaymentSummary | undefined) ?? { recebido_hoje_centavos: 0, recebido_periodo_centavos: 0, quantidade_pagamentos: 0, a_receber_centavos: 0, vencido_centavos: 0 }; }
export async function listFinancialReceivables(options: { query?: string; patientId?: string; status?: ReceivableStatus; overdue?: boolean; page: number; pageSize?: number }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_financial_receivables", { p_query: options.query || null, p_paciente_id: options.patientId || null, p_status: options.status || null, p_vencidos: options.overdue ?? false, p_page: options.page, p_page_size: options.pageSize ?? 20 });
  if (error) fail("RECEIVABLES_LIST_FAILED", error.code);
  const receivables = (data ?? []) as FinancialReceivable[];
  return { receivables, total: Number(receivables[0]?.total_count ?? 0), pageSize: options.pageSize ?? 20 };
}
export async function getFinancialReceivable(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("financeiro_recebiveis").select("id,paciente_id,atendimento_id,orcamento_id,valor_total_centavos,data_criacao,status,observacao_administrativa,pacientes!inner(nome),atendimentos(iniciado_em),orcamentos(numero)").eq("id", id).maybeSingle();
  if (error) fail("RECEIVABLE_LOAD_FAILED", error.code);
  return data as (Record<string, unknown> & { pacientes: { nome: string }; atendimentos: { iniciado_em: string } | null; orcamentos: { numero: number } | null }) | null;
}
export async function listFinancialInstallments(receivableId: string): Promise<FinancialInstallment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_financial_installments", { p_recebivel_id: receivableId });
  if (error) fail("INSTALLMENTS_LIST_FAILED", error.code);
  return (data ?? []) as FinancialInstallment[];
}
