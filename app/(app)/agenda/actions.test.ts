import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/agenda/validation", async () => vi.importActual("../../../lib/agenda/validation"));
vi.mock("@/lib/patients/validation", async () => vi.importActual("../../../lib/patients/validation"));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createAppointment } from "./actions";
import { initialDomainActionState } from "../../../lib/agenda/action-state";

const requestId = "11111111-1111-4111-8111-111111111111";
const patientId = "22222222-2222-4222-8222-222222222222";
const professionalId = "33333333-3333-4333-8333-333333333333";
const returnId = "44444444-4444-4444-8444-444444444444";
const appointmentId = "55555555-5555-4555-8555-555555555555";

function form(linked = false) {
  const data = new FormData();
  data.set("requestId", requestId);
  data.set("pacienteId", patientId);
  data.set("profissionalId", professionalId);
  data.set("inicioLocal", "2027-01-10T09:00");
  data.set("fimLocal", "2027-01-10T10:00");
  if (linked) data.set("returnId", returnId);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ perfil: "recepcao" });
  mocks.rpc.mockResolvedValue({ data: { id: appointmentId }, error: null });
});

describe("criação consistente de agendamento", () => {
  it("cria consulta comum por uma RPC e só confirma após receber o ID", async () => {
    const result = await createAppointment(initialDomainActionState, form());
    expect(result).toEqual({ success: true, error: null, appointmentId });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("create_appointment_consistent", expect.objectContaining({
      p_request_id: requestId, p_retorno_id: null, p_paciente_id: patientId,
      p_profissional_id: professionalId, p_inicio_local: "2027-01-10T09:00",
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("cria consulta de retorno sem segunda RPC e atualiza ambas as listas", async () => {
    expect((await createAppointment(initialDomainActionState, form(true))).appointmentId).toBe(appointmentId);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("create_appointment_consistent", expect.objectContaining({ p_retorno_id: returnId }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/retornos");
  });

  it("bloqueia payload e chaves inválidos antes da RPC", async () => {
    const invalid = form(true);
    invalid.set("pacienteId", "incorreto");
    expect((await createAppointment(initialDomainActionState, invalid)).fieldErrors?.pacienteId).toBeDefined();
    const invalidKey = form(true);
    invalidKey.set("requestId", "incorreto");
    expect((await createAppointment(initialDomainActionState, invalidKey)).success).toBe(false);
    const invalidReturn = form(true);
    invalidReturn.set("returnId", "incorreto");
    expect((await createAppointment(initialDomainActionState, invalidReturn)).success).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("não envia solicitação sem papel de agenda", async () => {
    mocks.requireUser.mockResolvedValueOnce({ perfil: "dentista" });
    expect((await createAppointment(initialDomainActionState, form(true))).error).toMatch(/permissão/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("distingue retorno já vinculado e conflito de horário sem mostrar sucesso", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "RETURN_ALREADY_SCHEDULED" } });
    expect((await createAppointment(initialDomainActionState, form(true))).error).toMatch(/já possui um agendamento/);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23P01", message: "conflict" } });
    expect((await createAppointment(initialDomainActionState, form(true))).error).toMatch(/horário/);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("distingue retorno concluído de retorno já agendado", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "RETURN_NOT_PENDING" } });
    expect((await createAppointment(initialDomainActionState, form(true))).error).toMatch(/não está pendente/);
  });

  it("mostra erro de falta de permissão e de retorno ausente", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "denied" } });
    expect((await createAppointment(initialDomainActionState, form(true))).error).toMatch(/permissão/);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "missing" } });
    expect((await createAppointment(initialDomainActionState, form(true))).error).toMatch(/Retorno não encontrado/);
  });

  it("preserva a mesma chave após falha de rede e permite retry sem dupla RPC por tentativa", async () => {
    const original = form(true);
    original.set("inicioLocal", "2027-01-10T14:30");
    original.set("fimLocal", "2027-01-10T15:15");
    original.set("observacoesAdministrativas", "Observação operacional fictícia");
    mocks.rpc.mockRejectedValueOnce(new Error("network"));
    const first = await createAppointment(initialDomainActionState, original);
    expect(first.success).toBe(false);
    expect(first.error).toMatch(/resultado é desconhecido/);
    expect(first.submitted).toMatchObject({ inicioLocal: "2027-01-10T14:30", fimLocal: "2027-01-10T15:15", observacoesAdministrativas: "Observação operacional fictícia" });
    const retry = form(true);
    retry.set("inicioLocal", first.submitted!.inicioLocal);
    retry.set("fimLocal", first.submitted!.fimLocal);
    retry.set("observacoesAdministrativas", first.submitted!.observacoesAdministrativas ?? "");
    const second = await createAppointment(first, retry);
    expect(second.appointmentId).toBe(appointmentId);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    for (const [, args] of mocks.rpc.mock.calls) {
      expect(args.p_request_id).toBe(requestId);
      expect(args.p_inicio_local).toBe("2027-01-10T14:30");
      expect(args.p_fim_local).toBe("2027-01-10T15:15");
    }
  });

  it("avisa sobre RPC ausente sem tentar a gravação antiga", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } });
    const result = await createAppointment(initialDomainActionState, form());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/banco precisa de uma atualização/);
    expect(result.error).toMatch(/Nenhum agendamento foi criado/);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("create_appointment_consistent", expect.any(Object));
  });

  it("não inventa confirmação após resposta vazia ou erro desconhecido", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await createAppointment(initialDomainActionState, form())).success).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST999", message: "unknown" } });
    expect((await createAppointment(initialDomainActionState, form())).error).toMatch(/Não foi possível confirmar/);
  });
});
