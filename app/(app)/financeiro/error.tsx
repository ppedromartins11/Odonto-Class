"use client";

export default function FinancialError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  void error;
  return <div className="mx-auto max-w-2xl rounded-lg border border-destructive/40 bg-card p-6"><h2 className="text-lg font-medium">Não foi possível carregar o Financeiro</h2><p className="mt-2 text-sm text-muted-foreground">Tente novamente. Se o problema persistir, contate o administrador.</p><button onClick={reset} className="mt-4 rounded border px-3 py-2 text-sm font-medium hover:bg-secondary">Tentar novamente</button></div>;
}
