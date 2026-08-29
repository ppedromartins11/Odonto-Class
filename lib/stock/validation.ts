import { STOCK_MOVEMENT_TYPES, STOCK_STATUSES, STOCK_UNITS, type StockMovementType, type StockStatus, type StockUnit } from "./types";

export const isStockUnit = (value: string): value is StockUnit => STOCK_UNITS.includes(value as StockUnit);
export const isStockMovementType = (value: string): value is StockMovementType => STOCK_MOVEMENT_TYPES.includes(value as StockMovementType);
export const isStockStatus = (value: string): value is StockStatus => STOCK_STATUSES.includes(value as StockStatus);

export function parseStockQuantity(value: unknown, allowZero = true): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= (allowZero ? 0 : 1) && parsed <= 1_000_000 ? parsed : null;
}

export function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const unitLabels: Record<StockUnit, string> = { unidade: "Unidade", caixa: "Caixa", pacote: "Pacote", frasco: "Frasco", kit: "Kit", outro: "Outro" };
export const movementLabels: Record<StockMovementType, string> = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste" };
