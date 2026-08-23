"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { setPatientActive } from "./actions";

export function PatientStatusControl({
  patientId,
  active,
}: {
  patientId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function updateStatus() {
    const verb = active ? "inativar" : "reativar";
    if (!window.confirm(`Deseja realmente ${verb} este paciente?`)) return;

    const formData = new FormData();
    formData.set("patientId", patientId);
    formData.set("active", String(!active));
    setError(null);
    startTransition(async () => {
      const result = await setPatientActive(formData);
      setError(result.error);
      if (result.success) router.refresh();
    });
  }

  return (
    <div className="text-right">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={updateStatus}
      >
        {pending ? "Salvando..." : active ? "Inativar paciente" : "Reativar paciente"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 max-w-72 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
