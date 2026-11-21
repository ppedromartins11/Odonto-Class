import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialPaymentActionState } from "../../../lib/financial/types";

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

import { registerPayment } from "./actions";

const patientId = "11111111-1111-4111-8111-111111111111";
const referenceId = "22222222-2222-4222-8222-222222222222";
function paymentForm(type: string, id: string, confirm = false) {
  const form = new FormData();
  form.set("patientId", patientId);
  form.set("referenceType", type);
  form.set("referenceId", id);
  form.set("valueCents", "1234");
  form.set("method", "pix");
  form.set("date", "2026-11-14");
  if (confirm) form.set("confirmNoReference", "yes");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ perfil: "recepcao" });
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("registro de pagamento", () => {
  it("recusa referência inválida ou confirmação ausente antes de chamar a RPC", async () => {
    expect((await registerPayment(initialPaymentActionState, paymentForm("orcamento", "inválido"))).error).toMatch(/referência/);
    expect((await registerPayment(initialPaymentActionState, paymentForm("none", ""))).error).toMatch(/Confirme/);
    expect((await registerPayment(initialPaymentActionState, paymentForm("none", referenceId, true))).error).toMatch(/referência/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserva a referência válida na submissão", async () => {
    await registerPayment(initialPaymentActionState, paymentForm("orcamento", referenceId));
    expect(mocks.rpc).toHaveBeenCalledWith("create_payment", expect.objectContaining({
      p_paciente_id: patientId, p_orcamento_id: referenceId, p_atendimento_id: null,
    }));
    expect(mocks.redirect).toHaveBeenCalledWith("/financeiro");
  });

  it("permite pagamento só do paciente após confirmação explícita", async () => {
    await registerPayment(initialPaymentActionState, paymentForm("none", "", true));
    expect(mocks.rpc).toHaveBeenCalledWith("create_payment", expect.objectContaining({
      p_atendimento_id: null, p_orcamento_id: null,
    }));
  });

  it("recusa dentista e propaga falha da RPC sem redirecionar", async () => {
    mocks.requireUser.mockResolvedValueOnce({ perfil: "dentista" });
    expect((await registerPayment(initialPaymentActionState, paymentForm("orcamento", referenceId))).error).toMatch(/autorizada/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ error: { code: "23514" } });
    expect((await registerPayment(initialPaymentActionState, paymentForm("orcamento", referenceId))).error).toMatch(/referência/);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
