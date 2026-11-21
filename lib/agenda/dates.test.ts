import { describe, expect, it } from "vitest";
import { todayInClinic } from "./dates";

describe("todayInClinic", () => {
  it("mantem a data civil em horario normal no formato YYYY-MM-DD", () => {
    const result = todayInClinic(new Date("2026-09-20T15:00:00.000Z"));

    expect(result).toBe("2026-09-20");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("mantem a data civil de Cuiaba quando o UTC ja virou o dia", () => {
    expect(todayInClinic(new Date("2026-09-21T02:30:00.000Z"))).toBe("2026-09-20");
  });

  it("avanca a data somente quando o dia virou na clinica", () => {
    expect(todayInClinic(new Date("2026-09-21T04:30:00.000Z"))).toBe("2026-09-21");
  });
});
