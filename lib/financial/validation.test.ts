import { describe, expect, it } from "vitest";
import { isPaymentMethod, isPaymentStatus, parsePaymentCents } from "./validation";

describe("payment validation", () => {
  it("accepts only the approved payment methods and statuses", () => {
    expect(isPaymentMethod("pix")).toBe(true);
    expect(isPaymentMethod("cartao")).toBe(false);
    expect(isPaymentStatus("pago")).toBe(true);
    expect(isPaymentStatus("pendente")).toBe(false);
  });

  it("accepts only safe positive cent values", () => {
    expect(parsePaymentCents(1)).toBe(1);
    expect(parsePaymentCents(12345)).toBe(12345);
    expect(parsePaymentCents(0)).toBeNull();
    expect(parsePaymentCents(-1)).toBeNull();
    expect(parsePaymentCents(12.5)).toBeNull();
    expect(parsePaymentCents(100_000_001)).toBeNull();
  });
});
