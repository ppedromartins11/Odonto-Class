export default function ValidityLoading() {
  return <div className="mx-auto max-w-7xl space-y-5" aria-busy="true" aria-label="Carregando validade"><div className="h-16 animate-pulse rounded-xl bg-secondary" /><div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-secondary" />)}</div><div className="h-72 animate-pulse rounded-xl bg-secondary" /></div>;
}
