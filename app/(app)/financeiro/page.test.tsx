import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), listPayments: vi.fn(), listFinancialReceivables: vi.fn(), getPaymentSummary: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agenda/dates", () => ({ todayInClinic: () => "2026-11-20" }));
vi.mock("@/lib/financial/validation", async () => vi.importActual("../../../lib/financial/validation"));
vi.mock("@/lib/financial/pagination", async () => vi.importActual("../../../lib/financial/pagination"));
vi.mock("@/lib/financial/queries", () => ({
  listPayments: mocks.listPayments,
  listFinancialReceivables: mocks.listFinancialReceivables,
  getPaymentSummary: mocks.getPaymentSummary,
}));
vi.mock("./PaymentStatusActions", () => ({ PaymentStatusActions: () => null }));

import FinancialPage from "./page";

const receivables = Array.from({ length: 55 }, (_, index) => ({
  id: `recebivel-${String(index + 1).padStart(2, "0")}`,
  paciente_id: "11111111-1111-4111-8111-111111111111",
  paciente_nome: `Paciente fictício ${index + 1}`,
  referencia: "Paciente",
  valor_total_centavos: 1000,
  valor_aberto_centavos: 1000,
  proximo_vencimento: "2026-12-01",
  status: "pendente",
}));
const payments = Array.from({ length: 55 }, (_, index) => ({
  id: `pagamento-${String(index + 1).padStart(2, "0")}`,
  paciente_id: "11111111-1111-4111-8111-111111111111",
  paciente_nome: `Paciente fictício ${index + 1}`,
  referencia: "Paciente",
  valor_centavos: 1000,
  forma: "pix",
  status: "pago",
  data_pagamento: "2026-11-20",
  responsavel_nome: "Operador fictício",
}));

async function render(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await FinancialPage({ searchParams: Promise.resolve(params) }));
}

function nav(html: string, label: string) {
  return html.match(new RegExp(`<nav aria-label="${label}"[^>]*>(.*?)</nav>`))?.[1] ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ perfil: "recepcao" });
  mocks.listFinancialReceivables.mockImplementation(async ({ page, query, status, overdue }) => {
    const filtered = receivables.filter((item) => (!query || item.paciente_nome.includes(query)) && (!status || item.status === status) && (!overdue || item.proximo_vencimento < "2026-11-20"));
    return { receivables: filtered.slice((page - 1) * 20, page * 20), total: filtered.length, pageSize: 20 };
  });
  mocks.listPayments.mockImplementation(async ({ page }) => ({ payments: payments.slice((page - 1) * 20, page * 20), total: payments.length, pageSize: 20 }));
});

describe("lista financeira F2", () => {
  it("navega primeira, segunda e última página de 55 recebíveis sem carregar a lista inteira", async () => {
    const first = await render();
    expect(first).toContain("recebivel-01");
    expect(first).not.toContain("recebivel-21");
    expect(nav(first, "Páginas de recebíveis")).toContain("recebivelPage=2");
    expect(nav(first, "Páginas de recebíveis")).not.toContain("Anterior");

    const second = await render({ recebivelPage: "2" });
    expect(second).toContain("recebivel-21");
    expect(second).not.toContain("recebivel-01");
    expect(nav(second, "Páginas de recebíveis")).toContain("recebivelPage=1");
    expect(nav(second, "Páginas de recebíveis")).toContain("recebivelPage=3");

    const last = await render({ recebivelPage: "3" });
    expect(last).toContain("recebivel-55");
    expect(last).not.toContain("recebivel-40");
    expect(nav(last, "Páginas de recebíveis")).toContain("Anterior");
    expect(nav(last, "Páginas de recebíveis")).not.toContain("Próxima");
    expect(mocks.listFinancialReceivables.mock.calls.every(([options]) => options.page <= 3)).toBe(true);
  });

  it("preserva filtros e parâmetros de página independentes nos links e formulários", async () => {
    const html = await render({ q: "Paciente", page: "2", recebivelPage: "2", recebivel: "pendente", inicio: "2026-11-01", forma: "pix", paciente: "ficticio" });
    const receivableNav = nav(html, "Páginas de recebíveis");
    const paymentNav = nav(html, "Páginas de pagamentos");
    expect(receivableNav).toContain("recebivelPage=3");
    expect(receivableNav).toContain("page=2");
    expect(receivableNav).toContain("recebivel=pendente");
    expect(receivableNav).toContain("q=Paciente");
    expect(paymentNav).toContain("page=3");
    expect(paymentNav).toContain("recebivelPage=2");
    expect(html).toContain('name="recebivelPage" value="2"');
    expect(html).toContain('name="page" value="2"');
    expect(html).toContain('name="inicio" value="2026-11-01"');
    expect(html).toContain('name="paciente" value="ficticio"');
    const forms = [...html.matchAll(/<form[^>]*>(.*?)<\/form>/g)].map((match) => match[1]);
    expect(forms[0]).toContain('name="page" value="2"');
    expect(forms[0]).not.toContain('name="recebivelPage"');
    expect(forms[1]).toContain('name="recebivelPage" value="2"');
    expect(forms[1]).not.toContain('name="page"');
    expect(mocks.listFinancialReceivables).toHaveBeenCalledWith(expect.objectContaining({ query: "Paciente", status: "pendente", page: 2 }));
    expect(mocks.listPayments).toHaveBeenCalledWith(expect.objectContaining({ query: "Paciente", method: "pix", page: 2 }));
  });

  it("corrige índice inválido ou além do total e distingue lista vazia", async () => {
    const invalid = await render({ recebivelPage: "-8", page: "NaN" });
    expect(invalid).toContain("Recebíveis: página 1 de 3");
    expect(invalid).toContain("Pagamentos: página 1 de 3");
    const beyond = await render({ recebivelPage: "9999", page: "9999" });
    expect(beyond).toContain("Recebíveis: página 3 de 3");
    expect(beyond).toContain("Pagamentos: página 3 de 3");
    expect(beyond).toContain("recebivel-55");
    expect(beyond).toContain("Paciente fictício 55");
    expect(nav(beyond, "Páginas de pagamentos")).toContain("recebivelPage=3");
    const empty = await render({ vencidos: "1", recebivelPage: "2" });
    expect(empty).toContain("Nenhum recebível encontrado para os filtros atuais.");
    expect(nav(empty, "Páginas de recebíveis")).toBe("");
    expect(empty).toContain("Pagamentos: página 1 de 3");
  });

  it("mantém a ordem entre páginas e o fluxo F1 acessível apenas ao perfil autorizado", async () => {
    const first = await render();
    const second = await render({ recebivelPage: "2" });
    const last = await render({ recebivelPage: "3" });
    expect(first.indexOf("recebivel-01")).toBeLessThan(first.indexOf("recebivel-20"));
    expect(second.indexOf("recebivel-21")).toBeLessThan(second.indexOf("recebivel-40"));
    expect(last.indexOf("recebivel-41")).toBeLessThan(last.indexOf("recebivel-55"));
    expect(first).toContain('href="/financeiro/novo"');
    mocks.requireUser.mockResolvedValueOnce({ perfil: "dentista" });
    const dentist = await render({ recebivelPage: "3" });
    expect(dentist).not.toContain("Contas a receber");
    expect(dentist).not.toContain('href="/financeiro/novo"');
    expect(mocks.listFinancialReceivables).toHaveBeenCalledTimes(5);
  });
});
