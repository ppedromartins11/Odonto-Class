import type { PaymentReference } from "./types";

export type ReferenceLoadResult =
  | { status: "success"; references: PaymentReference[] }
  | { status: "empty"; references: [] }
  | { status: "session" | "http" | "network"; references: [] };

export function isPaymentReferenceAvailable(reference: string, references: PaymentReference[]): boolean {
  return reference === "none" || references.some((item) => `${item.tipo}:${item.id}` === reference);
}

export async function loadPaymentReferences(patientId: string, signal: AbortSignal): Promise<ReferenceLoadResult> {
  try {
    const response = await fetch(`/api/financeiro/referencias?paciente=${encodeURIComponent(patientId)}`, {
      signal,
      cache: "no-store",
    });
    if (response.status === 401 || response.redirected) return { status: "session", references: [] };
    if (!response.ok) return { status: "http", references: [] };
    let payload: unknown;
    try { payload = await response.json(); }
    catch { return { status: "http", references: [] }; }
    if (!payload || typeof payload !== "object" || !("references" in payload) || !Array.isArray(payload.references) ||
      !payload.references.every((item) => item && typeof item === "object" &&
        (item.tipo === "atendimento" || item.tipo === "orcamento") && typeof item.id === "string" && typeof item.descricao === "string")) {
      return { status: "http", references: [] };
    }
    return payload.references.length
      ? { status: "success", references: payload.references as PaymentReference[] }
      : { status: "empty", references: [] };
  } catch {
    return { status: "network", references: [] };
  }
}
