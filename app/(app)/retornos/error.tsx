"use client";

import { Button } from "@/components/ui/Button";

export default function ReturnsError({ reset }: { reset: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-card p-8 text-center">
      <h2 className="text-lg font-medium text-foreground">
        Não foi possível carregar retornos
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Tente novamente. Nenhuma alteração foi realizada.
      </p>
      <Button type="button" className="mt-4" onClick={reset}>
        Tentar novamente
      </Button>
    </div>
  );
}
