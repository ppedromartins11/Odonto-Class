"use client";

import { useState } from "react";
import { serializeFdiTeeth, type FdiTooth } from "@/lib/odontogram/fdi";
import { Odontogram } from "./Odontogram";

export function ProcedureTeethField({ initialValue = [], disabled = false }: {
  initialValue?: readonly FdiTooth[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState<FdiTooth[]>([...initialValue]);
  return (
    <div className="space-y-2">
      <input type="hidden" name="teeth" value={serializeFdiTeeth(value)} />
      <Odontogram value={value} onChange={setValue} disabled={disabled} />
      <p className="text-xs text-muted-foreground">A seleção é clínica e não altera quantidade, valor ou consumo de estoque.</p>
    </div>
  );
}
