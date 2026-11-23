import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/agenda" }));
vi.mock("@/lib/config/clinic", () => ({ CLINIC_NAME: "Odonto Class", CLINIC_TAGLINE: "Clínica" }));
vi.mock("@/components/brand/BrandLogo", () => ({
  BrandLogo: () => <span aria-hidden="true">Marca</span>,
}));

import { Sidebar } from "./Sidebar";

const usuario = {
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Usuário de teste",
  perfil: "recepcao",
} as Parameters<typeof Sidebar>[0]["usuario"];

describe("navegação móvel de módulos", () => {
  it("mantém atalhos inferiores e botão hambúrguer acessível", () => {
    const html = renderToStaticMarkup(
      <Sidebar usuario={usuario} menuOpen={false} onMenuOpenChange={() => {}} />
    );
    expect(html).toContain('aria-label="Menu de módulos"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Agenda");
    expect(html).toContain("Retornos");
    expect(html).not.toContain('role="dialog"');
  });

  it("lista módulos autorizados no painel e identifica a página ativa", () => {
    const html = renderToStaticMarkup(
      <Sidebar usuario={usuario} menuOpen onMenuOpenChange={() => {}} />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Menu de módulos");
    expect(html).toContain("Financeiro");
    expect(html).toContain("Esterilização");
    expect(html).not.toContain(">Usuários</span>");
    expect(html).toContain('aria-current="page"');
  });
});
