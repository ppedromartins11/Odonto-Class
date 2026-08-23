"use client";

import { Button } from "@/components/ui/Button";

export default function AgendaError({ reset }: { error: Error; reset: () => void }) {
  return <div className="rounded-lg border border-destructive/30 bg-card p-8 text-center"><h2 className="text-lg font-medium">Não foi possível carregar a agenda</h2><p className="mt-2 text-sm text-muted-foreground">Tente novamente. Nenhuma alteração foi realizada.</p><Button className="mt-4" onClick={reset}>Tentar novamente</Button></div>;
}
