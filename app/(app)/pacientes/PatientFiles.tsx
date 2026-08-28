"use client";

import { useActionState } from "react";
import { Download, FileImage, FileText, Upload } from "lucide-react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import type { FileCategory, PatientFile } from "@/lib/operational/types";
import { uploadPatientFile } from "./file-actions";

export function PatientFiles({
  patientId,
  files,
  canUpload,
  category,
  title,
  description,
}: {
  patientId: string;
  files: PatientFile[];
  canUpload: boolean;
  category: FileCategory;
  title: string;
  description: string;
}) {
  const [state, action, pending] = useActionState(uploadPatientFile, initialDomainActionState);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">{files.length} arquivo{files.length === 1 ? "" : "s"}</span>
      </div>

      {canUpload && (
        <form action={action} className="mt-5 flex flex-col gap-3 rounded-lg border border-dashed border-border bg-secondary/30 p-4 sm:flex-row sm:items-center">
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="category" value={category} />
          <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="min-w-0 flex-1 text-sm" />
          <button disabled={pending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><Upload className="h-4 w-4" />{pending ? "Enviando..." : "Enviar arquivo"}</button>
          {state.error && <p role="alert" className="w-full text-xs text-destructive sm:basis-full">{state.error}</p>}
        </form>
      )}

      {files.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-border px-5 py-10 text-center"><FileText className="mx-auto h-7 w-7 text-muted-foreground/50" /><p className="mt-2 text-sm text-muted-foreground">Nenhum arquivo visível nesta categoria.</p></div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((file) => {
            const ImageIcon = file.mime_type === "image/jpeg" || file.mime_type === "image/png" ? FileImage : FileText;
            return <a key={file.id} href={`/api/arquivos/${file.id}`} className="group flex min-w-0 items-center gap-3 rounded-lg border border-border p-3 hover:border-blue-200 hover:bg-blue-50/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-primary"><ImageIcon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">{file.nome_original}</span><span className="mt-0.5 block text-xs text-muted-foreground">{file.mime_type.replace("application/", "").replace("image/", "").toUpperCase()}</span></span><Download className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" /></a>;
          })}
        </div>
      )}
    </section>
  );
}
