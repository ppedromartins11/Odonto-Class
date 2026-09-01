import type { FdiTooth } from "@/lib/odontogram/fdi";

export function ToothChips({ teeth, label = "Dentes" }: { teeth: readonly FdiTooth[]; label?: string }) {
  if (teeth.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={`${label}: ${teeth.join(", ")}`}>
      <span className="mr-0.5 text-xs text-muted-foreground">{label}:</span>
      {teeth.map((tooth) => <span key={tooth} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-blue-700">{tooth}</span>)}
    </div>
  );
}
