export default function PatientsLoading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse space-y-5" aria-label="Carregando pacientes">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-36 rounded bg-secondary" />
          <div className="h-4 w-64 rounded bg-secondary" />
        </div>
        <div className="h-8 w-32 rounded bg-secondary" />
      </div>
      <div className="h-20 rounded-lg border border-border bg-card" />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-16 border-b border-border p-4 last:border-b-0">
            <div className="h-4 w-1/3 rounded bg-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}
