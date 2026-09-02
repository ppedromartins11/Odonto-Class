"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isBudgetStatus, parseCents } from "@/lib/budgets/validation";
import type { BudgetActionState } from "@/lib/budgets/types";
import { getBudget } from "@/lib/budgets/queries";
import { renderBudgetPdf } from "@/lib/budgets/pdf";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CLINIC_NAME, CLINIC_TAGLINE } from "@/lib/config/clinic";
import { DOCUMENT_LAYOUT_VERSION } from "@/lib/documents/theme";

type ItemInput = { id?: string; descricao: string; quantidade: number; valorUnitarioCentavos: number; removed?: boolean };
const result = (error: string | null, fieldErrors?: Record<string, string>): BudgetActionState => ({ success: !error, error, fieldErrors });

function readItems(raw: FormDataEntryValue | null): ItemInput[] | null {
  try {
    const value = JSON.parse(String(raw ?? "[]")) as unknown;
    if (!Array.isArray(value) || value.length > 100) return null;
    const items = value.map((item) => {
      const row = item as Record<string, unknown>;
      return { id: typeof row.id === "string" ? row.id : undefined, descricao: String(row.descricao ?? "").trim(), quantidade: Number(row.quantidade), valorUnitarioCentavos: Number(row.valorUnitarioCentavos), removed: row.removed === true };
    });
    return items.every((item) => (!item.id || isValidUuid(item.id)) && item.descricao.length >= 2 && item.descricao.length <= 300 && Number.isInteger(item.quantidade) && item.quantidade >= 1 && item.quantidade <= 999 && parseCents(item.valorUnitarioCentavos) !== null) ? items : null;
  } catch { return null; }
}

export async function saveBudget(_: BudgetActionState, form: FormData): Promise<BudgetActionState> {
  await requireUser();
  const budgetId = String(form.get("budgetId") ?? "");
  const patientId = String(form.get("patientId") ?? form.get("pacienteId") ?? "");
  const professionalId = String(form.get("professionalId") ?? "");
  const validity = String(form.get("validity") ?? "") || null;
  const observation = String(form.get("observation") ?? "");
  const desiredStatus = String(form.get("desiredStatus") ?? "rascunho");
  const items = readItems(form.get("items"));
  if (!isValidUuid(patientId) || !isValidUuid(professionalId) || !items || items.filter((item) => !item.removed).length === 0) return result("Revise os dados do orçamento.");
  if (validity && !/^\d{4}-\d{2}-\d{2}$/.test(validity)) return result("Informe uma validade válida.");
  if (desiredStatus !== "rascunho" && desiredStatus !== "enviado") return result("Status inicial inválido.");
  if (desiredStatus === "enviado" && !validity) return result("A validade é obrigatória para enviar o orçamento.", { validity: "Informe a validade." });
  const supabase = await createSupabaseServerClient();
  let id = budgetId;
  if (id) {
    if (!isValidUuid(id)) return result("Orçamento inválido.");
    const { error } = await supabase.rpc("update_budget", { p_orcamento_id: id, p_paciente_id: patientId, p_profissional_id: professionalId, p_validade_em: validity, p_observacao_administrativa: observation || null });
    if (error) return result("Não foi possível atualizar o orçamento.");
  } else {
    const { data, error } = await supabase.rpc("create_budget", { p_paciente_id: patientId, p_profissional_id: professionalId, p_validade_em: validity, p_observacao_administrativa: observation || null });
    if (error || !data) return result("Não foi possível criar o orçamento.");
    id = (data as { id: string }).id;
  }
  for (const item of items) {
    const call = item.id
      ? item.removed
        ? supabase.rpc("remove_budget_item", { p_item_id: item.id })
        : supabase.rpc("update_budget_item", { p_item_id: item.id, p_descricao: item.descricao, p_quantidade: item.quantidade, p_valor_unitario_centavos: item.valorUnitarioCentavos })
      : item.removed ? null : supabase.rpc("add_budget_item", { p_orcamento_id: id, p_descricao: item.descricao, p_quantidade: item.quantidade, p_valor_unitario_centavos: item.valorUnitarioCentavos });
    if (call) { const { error } = await call; if (error) return result("Não foi possível salvar os itens do orçamento."); }
  }
  if (desiredStatus === "enviado") { const { error } = await supabase.rpc("set_budget_status", { p_orcamento_id: id, p_status: "enviado" }); if (error) return result("O orçamento foi salvo como rascunho, mas não pôde ser enviado."); }
  revalidatePath("/orcamentos"); revalidatePath(`/orcamentos/${id}`); revalidatePath(`/pacientes/${patientId}`);
  if (!budgetId) redirect(`/orcamentos/${id}`);
  return result(null);
}

export async function changeBudgetStatus(_: BudgetActionState, form: FormData): Promise<BudgetActionState> {
  await requireUser(); const id = String(form.get("budgetId") ?? ""); const status = String(form.get("status") ?? "");
  if (!isValidUuid(id) || !isBudgetStatus(status) || !["enviado", "aprovado", "rejeitado", "convertido"].includes(status)) return result("Alteração de status inválida.");
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("set_budget_status", { p_orcamento_id: id, p_status: status });
  if (error) return result("Não foi possível alterar o status do orçamento.");
  revalidatePath("/orcamentos"); revalidatePath(`/orcamentos/${id}`); return result(null);
}

export async function issueBudgetPdf(_: BudgetActionState, form: FormData): Promise<BudgetActionState> {
  await requireUser();
  const budgetId = String(form.get("budgetId") ?? "");
  if (!isValidUuid(budgetId)) return result("Orçamento inválido.");
  const budget = await getBudget(budgetId);
  if (!budget) return result("Orçamento não encontrado ou sem acesso.");

  const bytes = await renderBudgetPdf({ ...budget, clinicName: CLINIC_NAME, clinicTagline: CLINIC_TAGLINE });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `${budget.id}/orcamentos/${randomUUID()}.pdf`;
  const admin = createSupabaseAdminClient();
  const upload = await admin.storage.from("arquivos-paciente").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) return result("Não foi possível armazenar a versão privada do PDF.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("register_budget_pdf_version", {
    p_orcamento_id: budget.id,
    p_storage_path: path,
    p_pdf_sha256: hash,
    p_layout_version: DOCUMENT_LAYOUT_VERSION,
    p_tamanho_bytes: bytes.length,
  });
  if (error) {
    await admin.storage.from("arquivos-paciente").remove([path]);
    return result("Não foi possível registrar a versão emitida do orçamento.");
  }
  revalidatePath(`/orcamentos/${budget.id}`);
  return { success: true, error: null };
}
