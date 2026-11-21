import type { ClinicalLotOption, ClinicalMaterialConsumption } from "./types";

export function parseClinicalQuantity(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000
    ? parsed
    : null;
}

export function sortClinicalLotsByExpiry(lots: readonly ClinicalLotOption[]) {
  return [...lots].sort((left, right) => {
    const dateComparison = left.data_validade.localeCompare(right.data_validade);
    return dateComparison !== 0
      ? dateComparison
      : left.codigo_lote.localeCompare(right.codigo_lote, "pt-BR");
  });
}

export function isClinicalConsumptionReversed(
  consumption: Pick<ClinicalMaterialConsumption, "estornado_em">
) {
  return consumption.estornado_em !== null;
}

export function mapClinicalMaterialError(code?: string, message?: string) {
  const normalized = (message ?? "").toUpperCase();

  if (normalized === "LOT_CONTROL_LEGACY_REVERSAL_DENIED") {
    return "Este consumo foi registrado sem lote e não pode ser estornado após a ativação do controle por lote. Solicite a revisão do estoque ao administrador.";
  }

  if (normalized.includes("MATERIAL CONTROLADO EXIGE LOTE")) {
    return "Selecione um lote válido para este material.";
  }
  if (normalized.includes("LOTE VENCIDO")) {
    return "O lote selecionado está vencido. Atualize a lista e escolha outro lote.";
  }
  if (normalized.includes("LOTE INVALIDO") || normalized.includes("LOTE INATIVO")) {
    return "O lote selecionado não está mais disponível. Atualize a lista e tente novamente.";
  }
  if (normalized.includes("SALDO INSUFICIENTE")) {
    return "O saldo disponível foi alterado. Atualize os lotes e tente novamente.";
  }
  if (normalized.includes("MATERIAL INVALIDO") || normalized.includes("MATERIAL INATIVO")) {
    return "O material selecionado não está disponível para consumo.";
  }
  if (normalized.includes("SNAPSHOT") || normalized.includes("MATERIAL SEM CONTROLE DE LOTE")) {
    return "O material não corresponde à previsão selecionada. Atualize a página e tente novamente.";
  }
  if (normalized.includes("JA ESTORNADO")) {
    return "Este consumo já foi estornado.";
  }
  if (normalized.includes("ATENDIMENTO NAO PERMITE")) {
    return "O atendimento não está em andamento ou não permite esta operação.";
  }
  if (code === "42501" || normalized.includes("ACESSO CLINICO NEGADO")) {
    return "Você não tem permissão para alterar os materiais deste atendimento.";
  }
  if (code === "P0002") {
    return "O consumo, procedimento ou atendimento não está mais disponível.";
  }
  if (code === "23514" || code === "22023") {
    return "A operação não é válida para o estado atual. Atualize a página e tente novamente.";
  }
  return "Não foi possível atualizar o consumo de materiais.";
}
