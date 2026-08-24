function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-secondary ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-5" aria-busy="true" aria-label="Carregando Dashboard">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-52" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28" />)}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,1fr)]">
        <Skeleton className="h-96" />
        <div className="space-y-5"><Skeleton className="h-52" /><Skeleton className="h-40" /></div>
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
