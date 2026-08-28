import type { PaymentMethod, PaymentStatus } from "./types";

export const PAYMENT_METHODS: PaymentMethod[] = ["pix", "dinheiro", "cartao_credito", "cartao_debito", "transferencia", "outro"];
export const PAYMENT_STATUSES: PaymentStatus[] = ["pago", "estornado", "cancelado"];
export const isPaymentMethod = (value: string): value is PaymentMethod => PAYMENT_METHODS.includes(value as PaymentMethod);
export const isPaymentStatus = (value: string): value is PaymentStatus => PAYMENT_STATUSES.includes(value as PaymentStatus);
export const parsePaymentCents = (value: unknown): number | null => { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100_000_000 ? parsed : null; };
export const formatCents = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
