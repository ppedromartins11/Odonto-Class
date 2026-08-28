import { describe, expect, it } from "vitest";
import { appointmentBlocksSchedule, splitAppointmentsByOccupancy } from "./visual";

describe("layout visual da agenda", () => {
  it.each(["agendado", "confirmado", "atendido"] as const)(
    "%s participa da ocupacao do horario",
    (status) => {
      expect(appointmentBlocksSchedule(status)).toBe(true);
    }
  );

  it.each(["cancelado", "faltou"] as const)(
    "%s aparece apenas no historico visual",
    (status) => {
      expect(appointmentBlocksSchedule(status)).toBe(false);
    }
  );

  it("mantem cancelado no historico sem competir pelo mesmo horario ativo", () => {
    const events = [
      { id: "cancelada", status: "cancelado" as const },
      { id: "confirmada", status: "confirmado" as const },
    ];

    const result = splitAppointmentsByOccupancy(events);

    expect(result.occupying.map((item) => item.id)).toEqual(["confirmada"]);
    expect(result.historical.map((item) => item.id)).toEqual(["cancelada"]);
  });
});
