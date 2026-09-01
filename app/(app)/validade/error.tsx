"use client";

import { Button } from "@/components/ui/Button";

export default function ValidityError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-8 text-center"><h2 className="text-lg font-medium">Não foi possível carregar Validade</h2><p className="mt-2 text-sm text-muted-foreground">Tente novamente. Se o problema continuar, informe o administrador.</p><Button className="mt-4" onClick={reset}>Tentar novamente</Button></section>;
}
