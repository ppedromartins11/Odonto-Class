"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isPaymentMethod, isPaymentStatus, parsePaymentCents } from "@/lib/financial/validation";
import type { PaymentActionState, ReceivableActionState } from "@/lib/financial/types";
const result = (error: string | null): PaymentActionState => ({ success: !error, error });
const receivableResult = (error: string | null): ReceivableActionState => ({ success: !error, error });
export async function registerPayment(_: PaymentActionState, form: FormData): Promise<PaymentActionState> { await requireUser(); const patientId=String(form.get("patientId") ?? form.get("pacienteId") ?? ""); const type=String(form.get("referenceType") ?? "none"); const referenceId=String(form.get("referenceId") ?? ""); const cents=parsePaymentCents(form.get("valueCents")); const method=String(form.get("method") ?? ""); const date=String(form.get("date") ?? ""); if(!isValidUuid(patientId)||!cents||!isPaymentMethod(method)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||(type!=="none"&&type!=="atendimento"&&type!=="orcamento")||(type!=="none"&&!isValidUuid(referenceId))) return result("Revise os dados do pagamento."); const supabase=await createSupabaseServerClient(); const {error}=await supabase.rpc("create_payment",{p_paciente_id:patientId,p_atendimento_id:type==="atendimento"?referenceId:null,p_orcamento_id:type==="orcamento"?referenceId:null,p_valor_centavos:cents,p_forma:method,p_data_pagamento:date,p_observacao_administrativa:String(form.get("observation")??"")||null}); if(error)return result("Não foi possível registrar o pagamento."); revalidatePath("/financeiro");revalidatePath(`/pacientes/${patientId}`);redirect("/financeiro"); }
export async function changePaymentStatus(_: PaymentActionState, form: FormData): Promise<PaymentActionState> { const user=await requireUser(); if(user.perfil!=="administrador") return result("Ação não autorizada."); const id=String(form.get("paymentId")??"");const patientId=String(form.get("patientId")??"");const status=String(form.get("status")??""); if(!isValidUuid(id)||!isPaymentStatus(status)||status==="pago")return result("Status inválido.");const supabase=await createSupabaseServerClient();const {error}=await supabase.rpc("set_payment_status",{p_pagamento_id:id,p_status:status});if(error)return result("Não foi possível alterar o pagamento.");revalidatePath("/financeiro");if(isValidUuid(patientId))revalidatePath(`/pacientes/${patientId}`);return result(null); }

export async function createFinancialReceivable(_: ReceivableActionState, form: FormData): Promise<ReceivableActionState> {
  const user = await requireUser();
  if (user.perfil === "dentista") return receivableResult("Ação não autorizada.");
  const patientId = String(form.get("patientId") ?? "");
  const referenceType = String(form.get("referenceType") ?? "none");
  const referenceId = String(form.get("referenceId") ?? "");
  const cents = parsePaymentCents(form.get("totalCents"));
  const dueDate = String(form.get("firstDueDate") ?? "");
  const installments = Number(form.get("installments") ?? 1);
  const interval = Number(form.get("intervalMonths") ?? 1);
  const observation = String(form.get("observation") ?? "");
  if (!isValidUuid(patientId) || !cents || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isInteger(installments) || installments < 1 || installments > 120 || !Number.isInteger(interval) || interval < 1 || interval > 24 || !["none", "atendimento", "orcamento"].includes(referenceType) || (referenceType !== "none" && !isValidUuid(referenceId))) return receivableResult("Revise os dados do recebível.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_financial_receivable", {
    p_paciente_id: patientId,
    p_atendimento_id: referenceType === "atendimento" ? referenceId : null,
    p_orcamento_id: referenceType === "orcamento" ? referenceId : null,
    p_valor_total_centavos: cents,
    p_primeiro_vencimento: dueDate,
    p_numero_parcelas: installments,
    p_intervalo_meses: interval,
    p_observacao_administrativa: observation || null,
  });
  if (error || !data) return receivableResult("Não foi possível criar o recebível.");
  const id = (data as { id: string }).id;
  revalidatePath("/financeiro");
  revalidatePath(`/pacientes/${patientId}`);
  redirect(`/financeiro/recebiveis/${id}`);
}

export async function registerInstallmentPayment(_: ReceivableActionState, form: FormData): Promise<ReceivableActionState> {
  const user = await requireUser();
  if (user.perfil === "dentista") return receivableResult("Ação não autorizada.");
  const installmentId = String(form.get("installmentId") ?? "");
  const receivableId = String(form.get("receivableId") ?? "");
  const patientId = String(form.get("patientId") ?? "");
  const method = String(form.get("method") ?? "");
  const date = String(form.get("date") ?? "");
  if (!isValidUuid(installmentId) || !isValidUuid(receivableId) || !isPaymentMethod(method) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return receivableResult("Revise os dados do pagamento.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("register_installment_payment", { p_parcela_id: installmentId, p_forma: method, p_data_pagamento: date, p_observacao_administrativa: null });
  if (error) return receivableResult("Não foi possível registrar o pagamento desta parcela.");
  revalidatePath("/financeiro");
  revalidatePath(`/financeiro/recebiveis/${receivableId}`);
  if (isValidUuid(patientId)) revalidatePath(`/pacientes/${patientId}`);
  return receivableResult(null);
}

export async function cancelFinancialReceivable(_: ReceivableActionState, form: FormData): Promise<ReceivableActionState> {
  const user = await requireUser();
  if (user.perfil !== "administrador") return receivableResult("Ação não autorizada.");
  const receivableId = String(form.get("receivableId") ?? "");
  const patientId = String(form.get("patientId") ?? "");
  if (!isValidUuid(receivableId)) return receivableResult("Recebível inválido.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_financial_receivable", { p_recebivel_id: receivableId });
  if (error) return receivableResult("Não foi possível cancelar o recebível. Estorne pagamentos confirmados antes de cancelar.");
  revalidatePath("/financeiro");
  revalidatePath(`/financeiro/recebiveis/${receivableId}`);
  if (isValidUuid(patientId)) revalidatePath(`/pacientes/${patientId}`);
  return receivableResult(null);
}
