import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/agenda/action-state", () => ({ initialDomainActionState: {
  success: false,
  error: "Resultado desconhecido",
  submitted: {
    pacienteId: "22222222-2222-4222-8222-222222222222",
    profissionalId: "33333333-3333-4333-8333-333333333333",
    inicioLocal: "2027-01-10T14:30",
    fimLocal: "2027-01-10T15:15",
    observacoesAdministrativas: "Observação operacional fictícia",
  },
} }));
vi.mock("@/lib/agenda/dates", () => ({ toClinicLocalInput: (value: string) => value }));
vi.mock("@/components/ui/Button", async () => vi.importActual("../../../components/ui/Button"));
vi.mock("@/components/ui/Input", async () => vi.importActual("../../../components/ui/Input"));
vi.mock("./PatientPicker", () => ({ PatientPicker: () => null }));
vi.mock("./actions", () => ({ createAppointment: vi.fn(), updateAppointment: vi.fn() }));

import { AppointmentForm } from "./AppointmentForm";

describe("formulário de agendamento após resultado desconhecido", () => {
  it("mantém valores submetidos, chave e paciente fixo do retorno para retry", () => {
    const html = renderToStaticMarkup(<AppointmentForm
      professionals={[{ id: "33333333-3333-4333-8333-333333333333", usuario_id: "44444444-4444-4444-8444-444444444444", nome: "Dentista fictício", registro_profissional: null }]}
      patient={{ id: "22222222-2222-4222-8222-222222222222", nome: "Paciente fictício", telefone_contato: null } as Parameters<typeof AppointmentForm>[0]["patient"]}
      defaultStart="2027-01-10T09:00"
      defaultEnd="2027-01-10T10:00"
      returnId="11111111-1111-4111-8111-111111111111"
      requestId="55555555-5555-4555-8555-555555555555"
    />);
    expect(html).toContain('name="requestId" value="55555555-5555-4555-8555-555555555555"');
    expect(html).toContain('name="pacienteId" value="22222222-2222-4222-8222-222222222222"');
    expect(html.match(/<input[^>]*name="inicioLocal"[^>]*>/)?.[0]).toContain('value="2027-01-10T14:30"');
    expect(html.match(/<input[^>]*name="fimLocal"[^>]*>/)?.[0]).toContain('value="2027-01-10T15:15"');
    expect(html).toContain('value="33333333-3333-4333-8333-333333333333" selected=""');
    expect(html).toContain("Observação operacional fictícia");
    expect(html).toContain("Paciente do retorno");
    expect(html).not.toContain("Trocar paciente");
  });
});
