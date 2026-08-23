export default function AttendanceLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4" aria-label="Carregando atendimento">
      <div className="h-10 w-64 animate-pulse rounded bg-secondary" />
      <div className="h-72 animate-pulse rounded-lg bg-secondary" />
      <div className="h-48 animate-pulse rounded-lg bg-secondary" />
    </div>
  );
}
