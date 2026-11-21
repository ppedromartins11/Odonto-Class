import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialReceivableActionState } from "../../../lib/financial/types";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser, requireAdminAal2: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/patients/validation", async () => vi.importActual("../../../lib/patients/validation"));
vi.mock("@/lib/financial/validation", async () => vi.importActual("../../../lib/financial/validation"));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createFinancialReceivable } from "./actions";

const patientId = "11111111-1111-4111-8111-111111111111";
const referenceId = "22222222-2222-4222-8222-222222222222";
function receivableForm(type: string, id: string, confirm = false) {
  const form = new FormData();
  form.set("patientId", patientId);
  form.set("referenceType", type);
  form.set("referenceId", id);
  form.set("totalCents", "12000");
  form.set("firstDueDate", "2026-11-20");
  form.set("installments", "2");
  form.set("intervalMonths", "1");
  if (confirm) form.set("confirmNoReference", "yes");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ perfil: "recepcao" });
  mocks.rpc.mockResolvedValue({ data: { id: "33333333-3333-4333-8333-333333333333" }, error: null });
});

describe("criação de recebível", () => {
  it("recusa ausência de origem sem confirmação e vínculo inconsistente antes da RPC", async () => {
    expect((await createFinancialReceivable(initialReceivableActionState, receivableForm("none", ""))).error).toMatch(/Confirme/);
    expect((await createFinancialReceivable(initialReceivableActionState, receivableForm("none", referenceId, true))).error).toMatch(/origem/);
    expect((await createFinancialReceivable(initialReceivableActionState, receivableForm("orcamento", "inválido"))).error).toMatch(/origem/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("permite origem válida e confirma a criação somente para o paciente", async () => {
    await createFinancialReceivable(initialReceivableActionState, receivableForm("orcamento", referenceId));
    expect(mocks.rpc).toHaveBeenCalledWith("create_financial_receivable", expect.objectContaining({
      p_paciente_id: patientId, p_orcamento_id: referenceId, p_atendimento_id: null,
    }));
    mocks.rpc.mockClear();
    await createFinancialReceivable(initialReceivableActionState, receivableForm("none", "", true));
    expect(mocks.rpc).toHaveBeenCalledWith("create_financial_receivable", expect.objectContaining({
      p_paciente_id: patientId, p_orcamento_id: null, p_atendimento_id: null,
    }));
  });

  it("recusa dentista e não redireciona se a RPC falhar", async () => {
    mocks.requireUser.mockResolvedValueOnce({ perfil: "dentista" });
    expect((await createFinancialReceivable(initialReceivableActionState, receivableForm("orcamento", referenceId))).error).toMatch(/autorizada/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23514" } });
    expect((await createFinancialReceivable(initialReceivableActionState, receivableForm("orcamento", referenceId))).error).toMatch(/Não foi possível/);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
