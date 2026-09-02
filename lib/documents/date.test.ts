import { describe, expect, it } from "vitest";
import { dateInputValueInCuiaba, dateTimeInputValueInCuiaba } from "./date";

describe("datas documentais em America/Cuiaba", () => {
  it("mantém 01/09/2026 no input yyyy-MM-dd", () => {
    expect(dateInputValueInCuiaba(new Date("2026-09-01T12:00:00Z"))).toBe("2026-09-01");
    expect(dateTimeInputValueInCuiaba("2026-09-01T13:00:00-04:00")).toBe("2026-09-01T13:00");
  });
});
