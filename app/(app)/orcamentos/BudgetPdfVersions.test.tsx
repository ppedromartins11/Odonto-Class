import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/budgets/types", () => ({
  initialBudgetActionState: { success: false, error: null },
}));

vi.mock("./actions", () => ({
  issueBudgetPdf: async () => ({ success: false, error: null }),
}));

import { BudgetPdfVersions } from "./BudgetPdfVersions";

const id = "11111111-1111-4111-8111-111111111111";

describe("budget PDF unavailable state", () => {
  it("disables immutable issuance and exposes a clearly marked unarchived preview", () => {
    const html = renderToStaticMarkup(
      <BudgetPdfVersions budgetId={id} versions={[]} storageConfigured={false} />
    );
    expect(html).toContain("Baixar prévia em PDF (não registrada)");
    expect(html).toContain(`/api/orcamentos/${id}/pdf/preview`);
    expect(html).toContain("A emissão de versões imutáveis está indisponível");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("keeps the regular issuance button when private storage is configured", () => {
    const html = renderToStaticMarkup(
      <BudgetPdfVersions budgetId={id} versions={[]} storageConfigured={true} />
    );
    expect(html).toContain("Emitir PDF");
    expect(html).not.toContain("Baixar prévia em PDF");
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });
});
