"use client";

import { Check } from "lucide-react";
import {
  FDI_LOWER_LEFT,
  FDI_LOWER_RIGHT,
  FDI_UPPER_LEFT,
  FDI_UPPER_RIGHT,
  toggleFdiTooth,
  type FdiTooth,
} from "@/lib/odontogram/fdi";

type Props = {
  value: readonly FdiTooth[];
  onChange?: (value: FdiTooth[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  label?: string;
};

const UPPER_OFFSETS = [0, 3, 6, 9, 12, 15, 18, 20, 20, 18, 15, 12, 9, 6, 3, 0];
const LOWER_OFFSETS = [20, 18, 15, 12, 9, 6, 3, 0, 0, 3, 6, 9, 12, 15, 18, 20];

function toothPath(tooth: FdiTooth) {
  const position = tooth % 10;
  if (position <= 2) return "M15 3C10 3 7 6 7 11c0 5 2 9 3 14 1 6 1 15 5 15s4-9 5-15c1-5 3-9 3-14 0-5-3-8-8-8Z";
  if (position === 3) return "M15 2 8 8c-2 3-1 8 1 13 2 7 2 19 6 19s4-12 6-19c2-5 3-10 1-13L15 2Z";
  if (position <= 5) return "M15 3C9 3 5 7 6 13c1 4 3 7 3 12 1 7 2 15 6 15s5-8 6-15c0-5 2-8 3-12 1-6-3-10-9-10Z";
  return "M15 3C8 3 4 6 5 13c1 5 4 8 4 13 0 8 2 14 6 14s6-6 6-14c0-5 3-8 4-13 1-7-3-10-10-10Z";
}

function ToothButton({ tooth, selected, disabled, offset, onToggle }: {
  tooth: FdiTooth;
  selected: boolean;
  disabled: boolean;
  offset: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Dente ${tooth}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      style={{ transform: `translateY(${offset}px)` }}
      className={`group relative flex h-[4.75rem] w-10 shrink-0 flex-col items-center justify-start rounded-lg border px-1 pt-1.5 transition duration-150 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:w-11 ${
        selected
          ? "border-primary bg-blue-50 text-primary shadow-sm"
          : "border-transparent bg-transparent text-muted-foreground hover:border-blue-200 hover:bg-blue-50/60 hover:text-primary"
      } ${disabled ? "cursor-default opacity-75" : "cursor-pointer"}`}
    >
      <span className="relative flex h-10 w-8 items-center justify-center" aria-hidden="true">
        <svg viewBox="0 0 30 44" className="h-10 w-8 overflow-visible">
          <path
            d={toothPath(tooth)}
            className={`transition-colors ${selected ? "fill-blue-100 stroke-primary" : "fill-white stroke-slate-400 group-hover:stroke-primary"}`}
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
          <path d="M10 13c3 2 7 2 10 0" fill="none" className={selected ? "stroke-primary" : "stroke-slate-300"} strokeWidth="1" />
        </svg>
        {selected && <span className="absolute inset-0 flex items-center justify-center"><Check className="h-4 w-4 stroke-[3] text-primary" /></span>}
      </span>
      <span className={`mt-0.5 text-[11px] font-semibold tabular-nums ${selected ? "text-primary" : "text-foreground"}`}>{tooth}</span>
    </button>
  );
}

function Arch({ teeth, offsets, selected, disabled, onChange, label }: {
  teeth: readonly FdiTooth[];
  offsets: number[];
  selected: readonly FdiTooth[];
  disabled: boolean;
  onChange?: (value: FdiTooth[]) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex min-w-[42rem] items-start justify-center px-2 pb-5">
      {teeth.map((tooth, index) => (
        <div key={tooth} className={index === 8 ? "ml-3 border-l border-dashed border-blue-200 pl-3" : ""}>
          <ToothButton
            tooth={tooth}
            selected={selected.includes(tooth)}
            disabled={disabled}
            offset={offsets[index] ?? 0}
            onToggle={() => onChange?.(toggleFdiTooth(selected, tooth))}
          />
        </div>
      ))}
    </div>
  );
}

export function Odontogram({ value, onChange, disabled = false, readOnly = false, label = "Dentes relacionados" }: Props) {
  const upper = [...FDI_UPPER_RIGHT, ...FDI_UPPER_LEFT];
  const lower = [...FDI_LOWER_RIGHT, ...FDI_LOWER_LEFT];
  const locked = disabled || readOnly || !onChange;
  const summary = value.length === 0
    ? "Nenhum dente selecionado"
    : `${value.length} ${value.length === 1 ? "dente selecionado" : "dentes selecionados"}: ${value.join(", ")}`;

  return (
    <section aria-label={label} className="overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-b from-white to-slate-50 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-blue-100 px-4 py-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{label}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">Dentição permanente · padrão FDI/ISO</p>
        </div>
        {readOnly && <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Somente leitura</span>}
      </div>
      <div className="overflow-x-auto overscroll-x-contain px-2 pb-3 pt-4" tabIndex={0} aria-label="Arcadas dentárias; role horizontal quando necessário">
        <div className="mx-auto w-max">
          <div className="mb-1 flex min-w-[42rem] items-center justify-between px-5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span>Direito (D)</span><span>Arcada superior</span><span>Esquerdo (E)</span>
          </div>
          <Arch teeth={upper} offsets={UPPER_OFFSETS} selected={value} disabled={locked} onChange={onChange} label="Arcada superior" />
          <div className="mx-auto my-1 h-px w-[88%] bg-gradient-to-r from-transparent via-blue-200 to-transparent" />
          <Arch teeth={lower} offsets={LOWER_OFFSETS} selected={value} disabled={locked} onChange={onChange} label="Arcada inferior" />
          <div className="mt-1 flex min-w-[42rem] items-center justify-between px-5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span>Direito (D)</span><span>Arcada inferior</span><span>Esquerdo (E)</span>
          </div>
        </div>
      </div>
      <p aria-live="polite" className="border-t border-blue-100 bg-white px-4 py-2.5 text-xs font-medium text-foreground">{summary}</p>
    </section>
  );
}
