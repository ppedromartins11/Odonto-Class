import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { ServiceForm } from "../ServiceForm";

export default async function NewServicePage() { const user = await requireUser(); if (user.perfil !== "administrador") return <div className="rounded-xl border border-border bg-card p-6 text-sm">Acesso negado.</div>; return <div className="mx-auto max-w-3xl space-y-5"><Link href="/servicos" className="text-sm text-primary">← Voltar para serviços</Link><div><h2 className="text-2xl font-medium">Novo serviço</h2><p className="mt-1 text-sm text-muted-foreground">O valor é salvo em centavos e pode ser ajustado no atendimento pelo dentista.</p></div><ServiceForm /></div>; }
