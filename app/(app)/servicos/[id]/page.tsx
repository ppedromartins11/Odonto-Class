import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { listStockMaterials } from "@/lib/stock/queries";
import { getService, listServiceMaterials } from "@/lib/services/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { ServiceForm } from "../ServiceForm";
import { ServiceMaterials } from "./ServiceMaterials";
import { ServiceStatusControl } from "./ServiceStatusControl";

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); if (user.perfil !== "administrador") return <div className="rounded-xl border border-border bg-card p-6 text-sm">Acesso negado.</div>;
  const { id } = await params; if (!isValidUuid(id)) notFound();
  const [service, materials, stock] = await Promise.all([getService(id), listServiceMaterials(id), listStockMaterials({ page: 1, pageSize: 100 })]); if (!service) notFound();
  return <div className="mx-auto max-w-5xl space-y-5"><Link href="/servicos" className="text-sm text-primary">← Voltar para serviços</Link><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-medium">{service.nome}</h2><p className="mt-1 text-sm text-muted-foreground">{service.ativo ? "Ativo" : "Inativo"} · mudanças não alteram serviços já registrados.</p></div><ServiceStatusControl serviceId={id} active={service.ativo} /></div><ServiceForm service={service} /><ServiceMaterials serviceId={id} materials={materials} stockMaterials={stock.materials.filter((material) => material.ativo).map((material) => ({ id: material.id, nome: material.nome }))} /></div>;
}
