import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/patients/validation", async () => vi.importActual("../../../lib/patients/validation"));
vi.mock("@/lib/budgets/validation", async () => vi.importActual("../../../lib/budgets/validation"));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/budgets/queries", () => ({ getBudget: vi.fn() }));
vi.mock("@/lib/budgets/pdf", () => ({ renderBudgetPdf: vi.fn() }));
vi.mock("@/lib/budgets/pdf-integrity", () => ({
  verifyBudgetPdfObject: vi.fn(),
  reconcileFailedBudgetPdfRegistration: vi.fn(),
}));
vi.mock("@/lib/config/clinic", () => ({ CLINIC_NAME: "Teste", CLINIC_TAGLINE: "Teste" }));
vi.mock("@/lib/documents/theme", () => ({ DOCUMENT_LAYOUT_VERSION: 1 }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { saveBudget } from "./actions";
import { initialBudgetActionState } from "../../../lib/budgets/types";

const patientId = "22222222-2222-4222-8222-222222222222";
const professionalId = "33333333-3333-4333-8333-333333333333";
const budgetId = "44444444-4444-4444-8444-444444444444";
const existingItemId = "55555555-5555-4555-8555-555555555555";

function validForm(budget = "", items: object[] = [
  { descricao: "Clareamento", quantidade: 1, valorUnitarioCentavos: 20000, removed: false },
]) {
  const form = new FormData();
  form.set("budgetId", budget);
  form.set("patientId", patientId);
  form.set("professionalId", professionalId);
  form.set("items", JSON.stringify(items));
  form.set("validity", "2027-02-20");
  form.set("desiredStatus", "rascunho");
  return form;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ perfil: "recepcao" });
  mocks.rpc.mockResolvedValue({ data: budgetId, error: null });
});

describe("A7 orçamento salva tudo por uma transação RPC", () => {
  it("cria com uma RPC atômica, sem gravar cabeçalho ou itens separadamente", async () => {
    const state = await saveBudget(initialBudgetActionState, validForm());
    expect(state.success).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("save_budget_atomic", expect.objectContaining({
      p_orcamento_id: null, p_paciente_id: patientId, p_profissional_id: professionalId,
      p_status: "rascunho",
      p_itens: [expect.objectContaining({ descricao: "Clareamento", valorUnitarioCentavos: 20000 })],
    }));
    expect(mocks.redirect).toHaveBeenCalledWith(`/orcamentos/${budgetId}`);
  });
  it("edita e remove item existente na mesma RPC", async () => {
    const form = validForm(budgetId, [
      { id: existingItemId, descricao: "", quantidade: 1, valorUnitarioCentavos: 0, removed: true },
      { descricao: "Restauração", quantidade: 1, valorUnitarioCentavos: 70000 },
    ]);
    const state = await saveBudget(initialBudgetActionState, form);
    expect(state.success).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("save_budget_atomic", expect.objectContaining({
      p_orcamento_id: budgetId,
      p_itens: [expect.objectContaining({ id: existingItemId, removed: true }), expect.any(Object)],
    }));
  });
  it("bloqueia IDs e valor inválidos antes de enviar", async () => {
    const invalid = validForm();
    invalid.set("patientId", "id-inválido");
    expect((await saveBudget(initialBudgetActionState, invalid)).fieldErrors?.patientId).toBeDefined();
    const badItem = validForm("", [{ descricao: "Clareamento", quantidade: 1, valorUnitarioCentavos: null }]);
    expect((await saveBudget(initialBudgetActionState, badItem)).fieldErrors?.items).toMatch(/valor unitário/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejeita envio sem validade antes da chamada", async () => {
    const form = validForm();
    form.set("validity", "");
    form.set("desiredStatus", "enviado");
    expect((await saveBudget(initialBudgetActionState, form)).fieldErrors?.validity).toBeDefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("nunca faz fallback para gravação parcial se a função não existir", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } });
    const state = await saveBudget(initialBudgetActionState, validForm());
    expect(state.success).toBe(false);
    expect(state.error).toMatch(/transacional indisponível/);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("não inventa sucesso quando a chamada falha ou a resposta é inconclusiva", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("timeout"));
    expect((await saveBudget(initialBudgetActionState, validForm())).error).toMatch(/Consulte a lista/);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await saveBudget(initialBudgetActionState, validForm())).success).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
