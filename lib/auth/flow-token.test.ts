import { describe, expect, it } from "vitest";
import { signAuthFlowToken, verifyAuthFlowToken } from "./flow-token";

const SECRET = "test-secret-with-at-least-thirty-two-characters";

describe("auth flow token", () => {
  it("accepts a valid non-expired token", () => {
    const token = signAuthFlowToken(
      { sub: "user-1", flow: "recovery", exp: 2_000 },
      SECRET
    );

    expect(verifyAuthFlowToken(token, SECRET, 1_000)).toEqual({
      sub: "user-1",
      flow: "recovery",
      exp: 2_000,
    });
  });

  it("rejects expired, tampered and wrongly signed tokens", () => {
    const token = signAuthFlowToken(
      { sub: "user-1", flow: "invite", exp: 2_000 },
      SECRET
    );

    expect(verifyAuthFlowToken(token, SECRET, 2_000)).toBeNull();
    expect(verifyAuthFlowToken(`${token}x`, SECRET, 1_000)).toBeNull();
    expect(
      verifyAuthFlowToken(
        token,
        "another-secret-with-at-least-thirty-two-characters",
        1_000
      )
    ).toBeNull();
  });

  it("requires a strong signing secret", () => {
    expect(() =>
      signAuthFlowToken(
        { sub: "user-1", flow: "recovery", exp: 2_000 },
        "short"
      )
    ).toThrow(/32 caracteres/);
  });
});
