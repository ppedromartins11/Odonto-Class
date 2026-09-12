import { describe, expect, it } from "vitest";
import { getAdminMfaRequirement, safeMfaReturnPath } from "../lib/auth/mfa";

describe("requisito MFA administrativo", () => {
  it("distingue fator inexistente, sessao AAL1 e sessao AAL2", () => {
    expect(getAdminMfaRequirement("aal1", "aal1")).toBe("setup");
    expect(getAdminMfaRequirement("aal1", "aal2")).toBe("challenge");
    expect(getAdminMfaRequirement("aal2", "aal2")).toBe("ready");
    expect(getAdminMfaRequirement(undefined, undefined)).toBe("setup");
  });

  it("aceita apenas retornos internos seguros", () => {
    expect(safeMfaReturnPath("/usuarios")).toBe("/usuarios");
    expect(safeMfaReturnPath("https://example.test")).toBe("/dashboard");
    expect(safeMfaReturnPath("//example.test")).toBe("/dashboard");
  });
});
