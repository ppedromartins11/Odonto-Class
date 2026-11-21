import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getReturn: vi.fn(), getPatient: vi.fn(), listProfessionals: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agenda/queries", () => ({ getReturnForScheduling: mocks.getReturn, listActiveProfessionals: mocks.listProfessionals }));
vi.mock("@/lib/patients/queries", () => ({ getPatient: mocks.getPatient }));
vi.mock("@/lib/patients/validation", async () => vi.importActual("../../../../lib/patients/validation"));
vi.mock("@/lib/agenda/dates", () => ({ normalizeDateKey: () => "2027-01-10", todayInClinic: () => "2026-11-20", addDays: () => "2027-01-10" }));
vi.mock("../AppointmentForm", () => ({ AppointmentForm: ({ returnId, requestId, patient }: { returnId?: string; requestId: string; patient?: { id: string } }) =>
  <div data-return={returnId} data-request={requestId} data-patient={patient?.id}>Formulário</div> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));

import NewAppointmentPage from "./page";

const returnId = "11111111-1111-4111-8111-111111111111";
const patientId = "22222222-2222-4222-8222-222222222222";
const appointmentId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ perfil: "recepcao" });
  mocks.getReturn.mockResolvedValue({ id: returnId, paciente_id: patientId, status: "pendente", agendamento_id: null });
  mocks.getPatient.mockResolvedValue({ id: patientId, nome: "Paciente fictício" });
  mocks.listProfessionals.mockResolvedValue([]);
});

describe("nova consulta a partir de retorno", () => {
  it("usa o paciente do retorno e gera chave de idempotência", async () => {
    const html = renderToStaticMarkup(await NewAppointmentPage({ searchParams: Promise.resolve({ retorno: returnId, paciente: appointmentId }) }));
    expect(html).toContain(`data-return="${returnId}"`);
    expect(html).toContain(`data-patient="${patientId}"`);
    expect(html).toMatch(/data-request="[0-9a-f-]{36}"/);
    expect(mocks.getPatient).toHaveBeenCalledWith(patientId);
  });

  it("identifica retorno já agendado e oferece link direto, sem novo formulário", async () => {
    mocks.getReturn.mockResolvedValueOnce({ id: returnId, paciente_id: patientId, status: "agendado", agendamento_id: appointmentId });
    const html = renderToStaticMarkup(await NewAppointmentPage({ searchParams: Promise.resolve({ retorno: returnId }) }));
    expect(html).toContain("Este retorno já possui um agendamento.");
    expect(html).toContain(`/agenda/${appointmentId}/editar`);
    expect(html).not.toContain("Formulário");
    expect(mocks.listProfessionals).not.toHaveBeenCalled();
  });

  it("não oferece formulário para retorno concluído ou ID inválido", async () => {
    mocks.getReturn.mockResolvedValueOnce({ id: returnId, paciente_id: patientId, status: "concluido", agendamento_id: null });
    const html = renderToStaticMarkup(await NewAppointmentPage({ searchParams: Promise.resolve({ retorno: returnId }) }));
    expect(html).toContain("não está pendente");
    expect(html).not.toContain("Formulário");
    await expect(NewAppointmentPage({ searchParams: Promise.resolve({ retorno: "inválido" }) })).rejects.toThrow("NOT_FOUND");
  });

  it("reinicializa chave e paciente ao navegar para outro retorno na mesma rota", async () => {
    const otherReturnId = "44444444-4444-4444-8444-444444444444";
    const otherPatientId = "55555555-5555-4555-8555-555555555555";
    const first = await NewAppointmentPage({ searchParams: Promise.resolve({ retorno: returnId }) });
    mocks.getReturn.mockResolvedValueOnce({ id: otherReturnId, paciente_id: patientId, status: "pendente", agendamento_id: null });
    const samePatient = await NewAppointmentPage({ searchParams: Promise.resolve({ retorno: otherReturnId }) });
    mocks.getReturn.mockResolvedValueOnce({ id: otherReturnId, paciente_id: otherPatientId, status: "pendente", agendamento_id: null });
    const otherPatient = await NewAppointmentPage({ searchParams: Promise.resolve({ retorno: otherReturnId }) });
    const form = (page: Awaited<ReturnType<typeof NewAppointmentPage>>) => page.props.children[1];
    expect(form(first).key).not.toBe(form(samePatient).key);
    expect(form(samePatient).key).not.toBe(form(otherPatient).key);
    expect(form(first).props.requestId).not.toBe(form(samePatient).props.requestId);
  });
});
