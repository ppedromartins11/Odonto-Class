import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderBudgetPdf } from "./pdf";

describe("budget PDF", () => {
  it("generates a server-side PDF from structured values", async () => {
    const bytes = await renderBudgetPdf({ id: "11111111-1111-4111-8111-111111111111", numero: 42, paciente_id: "", profissional_id: "", data_orcamento: "2026-08-27", validade_em: "2026-09-27", observacao_administrativa: "Observação administrativa", status: "rascunho", effective_status: "rascunho", total_centavos: 2500, created_at: "2026-08-27T00:00:00Z", paciente_nome: "QA_ORC Paciente", profissional_nome: "QA_ORC Profissional", clinicName: "Clínica QA", items: [{ id: "item", orcamento_id: "", descricao: "Avaliação", quantidade: 1, valor_unitario_centavos: 2500, total_centavos: 2500, ativo: true }] });
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  });
});
