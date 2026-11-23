import type { BudgetStatus } from "./types";

export const BUDGET_STATUSES: BudgetStatus[] = ["rascunho", "enviado", "aprovado", "rejeitado", "expirado", "convertido"];

export function isBudgetStatus(value: string): value is BudgetStatus {
  return BUDGET_STATUSES.includes(value as BudgetStatus);
}

export function parseCents(value: unknown): number | null {
  if (typeof value !== "number") return null;
  const parsed = value;
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100_000_000 ? parsed : null;
}

export function formatCents(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

/** Interpreta o valor em reais sem depender do separador decimal do Safari/iOS. */
export function parseReaisToCents(input: string): number | null {
  const value = input.trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  const grouped = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value);
  const brazilian = /^\d+(?:,\d{1,2})?$/.test(value);
  const decimalPoint = /^\d+\.\d{1,2}$/.test(value);
  if (!grouped && !brazilian && !decimalPoint) return null;
  const normalized = grouped
    ? value.replace(/\./g, "").replace(",", ".")
    : value.replace(",", ".");
  const [whole, fractional = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  return parseCents(cents);
}

export type BudgetItemInput = {
  id?: string;
  descricao: string;
  quantidade: number;
  valorUnitarioCentavos: number;
  removed?: boolean;
};

type ItemParseResult = { items: BudgetItemInput[]; error: null } | { items: null; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Retorna o campo problemático e rejeita valores ausentes/NaN serializados como null. */
export function parseBudgetItems(raw: string | null): ItemParseResult {
  let input: unknown;
  try {
    input = JSON.parse(raw ?? "null");
  } catch {
    return { items: null, error: "Não foi possível interpretar os itens. Revise os valores preenchidos." };
  }
  if (!Array.isArray(input) || input.length > 100) {
    return { items: null, error: "Adicione até 100 itens válidos ao orçamento." };
  }
  const items: BudgetItemInput[] = [];
  let active = 0;
  for (const [index, value] of input.entries()) {
    const number = index + 1;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { items: null, error: `Item ${number}: dados inválidos.` };
    }
    const row = value as Record<string, unknown>;
    const id = row.id === undefined ? undefined : row.id;
    if (id !== undefined && (typeof id !== "string" || !UUID_PATTERN.test(id))) {
      return { items: null, error: `Item ${number}: identificador inválido.` };
    }
    const removed = row.removed === true;
    if (removed) {
      // Itens novos removidos não precisam ser persistidos; itens existentes
      // seguem para a RPC de remoção e não precisam de valor/descrição válidos.
      if (typeof id === "string") {
        items.push({ id, descricao: "", quantidade: 1, valorUnitarioCentavos: 0, removed: true });
      }
      continue;
    }
    active++;
    const descricao = typeof row.descricao === "string" ? row.descricao.trim() : "";
    if (descricao.length < 2 || descricao.length > 300) {
      return { items: null, error: `Item ${number}: informe uma descrição entre 2 e 300 caracteres.` };
    }
    if (typeof row.quantidade !== "number" || !Number.isInteger(row.quantidade) || row.quantidade < 1 || row.quantidade > 999) {
      return { items: null, error: `Item ${number}: informe uma quantidade de 1 a 999.` };
    }
    const valor = parseCents(row.valorUnitarioCentavos);
    if (valor === null) {
      return { items: null, error: `Item ${number}: valor unitário inválido. Utilize o formato 200,00.` };
    }
    items.push({ id: id as string | undefined, descricao, quantidade: row.quantidade, valorUnitarioCentavos: valor });
  }
  if (active === 0) {
    return { items: null, error: "Inclua pelo menos um item ativo no orçamento." };
  }
  return { items, error: null };
}
