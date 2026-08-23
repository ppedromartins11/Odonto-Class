"use client";

import { Button } from "@/components/ui/Button";

export default function PatientsError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6 text-center">
      <h2 className="text-lg font-medium text-foreground">Não foi possível carregar pacientes</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Tente novamente. Se o problema continuar, verifique a conexão com a homologação.
      </p>
      <Button type="button" className="mt-4" onClick={reset}>
        Tentar novamente
      </Button>
    </div>
  );
}
