import Link from "next/link";

export default function AttendanceNotFound() {
  return <div className="rounded-lg border border-border bg-card p-8 text-center"><h2 className="text-lg font-medium">Atendimento não encontrado</h2><p className="mt-2 text-sm text-muted-foreground">O registro não existe ou não pertence ao profissional autenticado.</p><Link href="/agenda" className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Voltar para agenda</Link></div>;
}
