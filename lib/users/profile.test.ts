import { describe, expect, it } from "vitest";
import { normalizeUserProfileInput } from "./profile";

describe("normalizeUserProfileInput", () => {
  it("normaliza nome e CRO sem inventar valor", () => {
    expect(normalizeUserProfileInput({ nome: "  Dra. Ana  ", registroProfissional: "  CRO-MS 12345 " })).toEqual({
      data: { nome: "Dra. Ana", registroProfissional: "CRO-MS 12345" },
    });
  });

  it("converte CRO vazio em null e recusa nome vazio", () => {
    expect(normalizeUserProfileInput({ nome: "Dra. Ana", registroProfissional: "   " })).toEqual({
      data: { nome: "Dra. Ana", registroProfissional: null },
    });
    expect(normalizeUserProfileInput({ nome: " ", registroProfissional: null })).toEqual({ error: "Informe um nome completo entre 2 e 160 caracteres." });
  });
});
