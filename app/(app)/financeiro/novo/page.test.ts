import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getPatient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/patients/queries", () => ({ getPatient: mocks.getPatient }));
vi.mock("@/lib/patients/validation", async () => vi.importActual("../../../../lib/patients/validation"));
vi.mock("../PaymentForm", () => ({ PaymentForm: () => null }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import NewPaymentPage from "./page";

const patientId = "11111111-1111-4111-8111-111111111111";
const first = "22222222-2222-4222-8222-222222222222";
const second = "33333333-3333-4333-8333-333333333333";

describe("navegação entre referências de pagamento", () => {
  it("reinicializa o formulário ao abrir outra referência do mesmo paciente", async () => {
    mocks.requireUser.mockResolvedValue({ perfil: "recepcao" });
    mocks.getPatient.mockResolvedValue({ id: patientId, nome: "Paciente fictício", telefone_contato: null });
    const firstPage = await NewPaymentPage({ searchParams: Promise.resolve({ paciente: patientId, orcamento: first }) });
    const secondPage = await NewPaymentPage({ searchParams: Promise.resolve({ paciente: patientId, orcamento: second }) });
    const firstForm = firstPage.props.children[1];
    const secondForm = secondPage.props.children[1];
    expect(firstForm.key).not.toBe(secondForm.key);
    expect(firstForm.props.initialReference).toBe(`orcamento:${first}`);
    expect(secondForm.props.initialReference).toBe(`orcamento:${second}`);
  });
});
