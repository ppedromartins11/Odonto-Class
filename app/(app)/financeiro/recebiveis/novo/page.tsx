import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { ReceivableForm } from "../../ReceivableForm";

export default async function NewReceivablePage() {
  const user = await requireUser();
  if (user.perfil === "dentista") redirect("/financeiro");
  return <div className="mx-auto max-w-3xl space-y-5"><div><h2 className="text-2xl font-medium">Novo recebível</h2><p className="mt-1 text-sm text-muted-foreground">Crie uma conta à vista ou parcelada. O recebimento é registrado somente ao quitar cada parcela.</p></div><ReceivableForm /></div>;
}
