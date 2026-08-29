import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { StockMaterialForm } from "../StockMaterialForm";

export default async function NewStockMaterialPage() {
  await requireAdmin();
  return <div className="mx-auto max-w-3xl space-y-5"><Link href="/estoque" className="text-sm text-muted-foreground hover:text-foreground">← Voltar para estoque</Link><header><h2 className="text-2xl font-medium">Novo material</h2><p className="mt-1 text-sm text-muted-foreground">Cadastre o material e informe o saldo inicial.</p></header><StockMaterialForm /></div>;
}
