"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isBudgetStatus, parseBudgetItems } from "@/lib/budgets/validation";
import type { BudgetActionState } from "@/lib/budgets/types";
import { getBudget } from "@/lib/budgets/queries";
import { renderBudgetPdf } from "@/lib/budgets/pdf";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CLINIC_NAME, CLINIC_TAGLINE } from "@/lib/config/clinic";
import { DOCUMENT_LAYOUT_VERSION } from "@/lib/documents/theme";
import { reconcileFailedBudgetPdfRegistration, verifyBudgetPdfObject } from "@/lib/budgets/pdf-integrity";

const result = (error: string | null, fieldErrors?: Record<string, string>): BudgetActionState => ({ success: !error, error, fieldErrors });

export async function saveBudget(_: BudgetActionState, form: FormData): Promise<BudgetActionState> {
  await requireUser();
  const budgetId = String(form.get("budgetId") ?? "");
  const patientId = String(form.get("patientId") ?? form.get("pacienteId") ?? "");
  const professionalId = String(form.get("professionalId") ?? "");
  const validity = String(form.get("validity") ?? "") || null;
  const observation = String(form.get("observation") ?? "");
  const desiredStatus = String(form.get("desiredStatus") ?? "rascunho");
  const parsedItems = parseBudgetItems(String(form.get("items") ?? ""));
  const fieldErrors: Record<string, string> = {};
  if (!isValidUuid(patientId)) fieldErrors.patientId = "Selecione um paciente válido na lista.";
  if (!isValidUuid(professionalId)) fieldErrors.professionalId = "Selecione um profissional responsável.";
  if (parsedItems.error) fieldErrors.items = parsedItems.error;
  if (Object.keys(fieldErrors).length > 0) {
    return result("Confira os campos destacados para salvar o orçamento.", fieldErrors);
  }
  const items = parsedItems.items!;

  if (validity && !/^\d{4}-\d{2}-\d{2}$/.test(validity)) return result("Informe uma validade válida.");
  if (desiredStatus !== "rascunho" && desiredStatus !== "enviado") return result("Status inicial inválido.");
  if (desiredStatus === "enviado" && !validity) return result("A validade é obrigatória para enviar o orçamento.", { validity: "Informe a validade." });
  if (budgetId && !isValidUuid(budgetId)) return result("Orçamento inválido.");

  // A7: uma única RPC PostgreSQL aplica cabeçalho, itens e status sob a MESMA
  // transação. Sem fallback para chamadas individuais que gravam parcialmente.
  const supabase = await createSupabaseServerClient();
  let saved;
  try {
    saved = await supabase.rpc("save_budget_atomic", {
      p_orcamento_id: budgetId || null,
      p_paciente_id: patientId,
      p_profissional_id: professionalId,
      p_validade_em: validity,
      p_observacao_administrativa: observation || null,
      p_itens: items,
      p_status: desiredStatus,
    });
  } catch {
    // Timeout/rede não confirmam rollback; não induzir envio duplicado.
    return result("Não foi possível confirmar o salvamento. Consulte a lista antes de tentar novamente.");
  }
  if (saved.error) {
    if (saved.error.code === "PGRST202" || saved.error.code === "42883") {
      return result("Salvamento transacional indisponível neste ambiente. Avise a administração.");
    }
    if (saved.error.code === "42501") return result("Você não tem permissão para salvar este orçamento.");
    if (saved.error.code === "23514") return result("O orçamento contém dados ou uma transição de status inválidos.");
    return result("Não foi possível concluir o orçamento. Nenhuma alteração parcial foi confirmada.");
  }
  const id = typeof saved.data === "string" && isValidUuid(saved.data) ? saved.data : null;
  if (!id) return result("Não foi possível confirmar o salvamento. Consulte a lista antes de tentar novamente.");
  revalidatePath("/orcamentos"); revalidatePath(`/orcamentos/${id}`); revalidatePath(`/pacientes/${patientId}`);
  if (!budgetId) redirect(`/orcamentos/${id}`);
  return result(null);
}

export async function changeBudgetStatus(_: BudgetActionState, form: FormData): Promise<BudgetActionState> {
  await requireUser(); const id = String(form.get("budgetId") ?? ""); const status = String(form.get("status") ?? "");
  if (!isValidUuid(id) || !isBudgetStatus(status) || !["enviado", "aprovado", "rejeitado"].includes(status)) return result("Alteração de status inválida.");
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

  // Configuracao ausente no ambiente publicado nao deve derrubar a pagina.
  // Sem a chave privada o bucket continua protegido; nao tentar fallback publico.
  if (!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error("BUDGET_PDF_PRIVATE_STORAGE_NOT_CONFIGURED");
    return result("A emissão de PDFs está temporariamente indisponível. Avise a administração para configurar o armazenamento privado.");
  }

  let bytes: Buffer;
  try {
    bytes = await renderBudgetPdf({ ...budget, clinicName: CLINIC_NAME, clinicTagline: CLINIC_TAGLINE });
  } catch {
    console.error("BUDGET_PDF_RENDER_FAILED");
    return result("Não foi possível gerar o PDF do orçamento. Tente novamente ou avise a administração.");
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `${budget.id}/orcamentos/${randomUUID()}.pdf`;
  const admin = createSupabaseAdminClient();
  const storage = admin.storage.from("arquivos-paciente");
  const upload = await storage.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) return result("Não foi possível armazenar a versão privada do PDF.");

  // O registro de versao so prossegue se os bytes gravados corresponderem
  // aos bytes emitidos, e a identidade do objeto estiver estavel.
  const verified = await verifyBudgetPdfObject({
    budgetId: budget.id,
    path,
    expectedBytes: bytes,
    readInfo: () => storage.info(path),
    readBytes: () => storage.download(path, {}, { cache: "no-store" }),
  });
  if (!verified) {
    const cleanup = await storage.remove([path]);
    if (cleanup.error) console.error("BUDGET_PDF_UPLOAD_CLEANUP_INCOMPLETE");
    return result("Não foi possível verificar a integridade do PDF armazenado.");
  }

  const supabase = await createSupabaseServerClient();
  let registration;
  try {
    registration = await supabase.rpc("register_budget_pdf_version", {
      p_orcamento_id: budget.id,
      p_storage_path: path,
      p_pdf_sha256: hash,
      p_layout_version: DOCUMENT_LAYOUT_VERSION,
      p_tamanho_bytes: bytes.length,
    });
  } catch {
    // Timeout ou falha de rede nao prova rollback: o objeto deve permanecer.
    console.error("BUDGET_PDF_REGISTRATION_UNKNOWN");
    return result("Não foi possível confirmar o registro. Consulte as versões antes de tentar novamente.");
  }

  if (registration.error) {
    const outcome = await reconcileFailedBudgetPdfRegistration({
      rpcError: registration.error,
      metadataForPath: () => admin.from("orcamento_pdf_versoes")
        .select("id").eq("storage_path", path).maybeSingle(),
      removeObject: () => storage.remove([path]),
    });
    if (outcome === "preserved") {
      console.error("BUDGET_PDF_REGISTRATION_RECONCILIATION_REQUIRED", { code: registration.error.code });
      return result("Não foi possível confirmar o registro. Consulte as versões antes de tentar novamente.");
    }
    return result("Não foi possível registrar a versão emitida do orçamento.");
  }
  if (!registration.data) {
    // Resposta sem dados nao autoriza exclusao de um PDF possivelmente registrado.
    console.error("BUDGET_PDF_REGISTRATION_EMPTY_RESPONSE");
    return result("Não foi possível confirmar o registro. Consulte as versões antes de tentar novamente.");
  }
  revalidatePath(`/orcamentos/${budget.id}`);
  return { success: true, error: null };
}
