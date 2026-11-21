import { describe, expect, it } from "vitest";
import {
  isClinicalConsumptionReversed,
  mapClinicalMaterialError,
  parseClinicalQuantity,
  sortClinicalLotsByExpiry,
} from "./material-consumption";

describe("consumo clínico de materiais", () => {
  it("aceita somente quantidade inteira positiva dentro do domínio", () => {
    expect(parseClinicalQuantity("1")).toBe(1);
    expect(parseClinicalQuantity("1000000")).toBe(1_000_000);
    expect(parseClinicalQuantity("0")).toBeNull();
    expect(parseClinicalQuantity("1.5")).toBeNull();
    expect(parseClinicalQuantity("1000001")).toBeNull();
  });

  it("ordena lotes por validade e usa o código como desempate", () => {
    const lots = sortClinicalLotsByExpiry([
      { id: "3", material_id: "m", codigo_lote: "C", data_validade: "2028-01-01", quantidade_atual: 2 },
      { id: "2", material_id: "m", codigo_lote: "B", data_validade: "2027-02-01", quantidade_atual: 1 },
      { id: "1", material_id: "m", codigo_lote: "A", data_validade: "2027-02-01", quantidade_atual: 3 },
    ]);
    expect(lots.map((lot) => lot.id)).toEqual(["1", "2", "3"]);
  });

  it("diferencia consumo ativo de consumo estornado", () => {
    expect(isClinicalConsumptionReversed({ estornado_em: null })).toBe(false);
    expect(isClinicalConsumptionReversed({ estornado_em: "2026-09-17T12:00:00Z" })).toBe(true);
  });

  it("mapeia erros de domínio sem expor detalhes internos", () => {
    expect(mapClinicalMaterialError("23514", "LOT_CONTROL_LEGACY_REVERSAL_DENIED")).toContain("não pode ser estornado");
    expect(mapClinicalMaterialError("23514", "Material controlado exige lote.")).toContain("Selecione um lote");
    expect(mapClinicalMaterialError("23514", "Saldo insuficiente no lote.")).toContain("saldo disponível foi alterado");
    expect(mapClinicalMaterialError("23514", "Consumo clinico ja estornado.")).toBe("Este consumo já foi estornado.");
    expect(mapClinicalMaterialError("42501", "Acesso clinico negado.")).toContain("não tem permissão");
    expect(mapClinicalMaterialError("XX000", "select * from segredo")).toBe("Não foi possível atualizar o consumo de materiais.");
  });
});
