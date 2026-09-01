export const FDI_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11] as const;
export const FDI_UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28] as const;
export const FDI_LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41] as const;
export const FDI_LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38] as const;

export const FDI_TEETH = [
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
] as const;

export type FdiTooth = (typeof FDI_TEETH)[number];

const FDI_SET = new Set<number>(FDI_TEETH);

export function isValidFdiTooth(value: unknown): value is FdiTooth {
  return typeof value === "number" && Number.isInteger(value) && FDI_SET.has(value);
}

export function normalizeFdiTeeth(values: readonly number[]): FdiTooth[] {
  if (!values.every(isValidFdiTooth)) throw new Error("INVALID_FDI_TOOTH");
  return [...new Set(values)].sort((a, b) => a - b) as FdiTooth[];
}

export function toggleFdiTooth(values: readonly FdiTooth[], tooth: FdiTooth): FdiTooth[] {
  return values.includes(tooth)
    ? values.filter((value) => value !== tooth)
    : normalizeFdiTeeth([...values, tooth]);
}

export function serializeFdiTeeth(values: readonly number[]): string {
  return JSON.stringify(normalizeFdiTeeth(values));
}

export function parseFdiTeeth(value: FormDataEntryValue | null): FdiTooth[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("INVALID_FDI_PAYLOAD");
  }
  if (!Array.isArray(parsed)) throw new Error("INVALID_FDI_PAYLOAD");
  return normalizeFdiTeeth(parsed);
}
