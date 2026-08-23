import Link from "next/link";

export default function PatientNotFound() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6 text-center">
      <h2 className="text-lg font-medium text-foreground">Paciente não encontrado</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        O registro não existe ou não está acessível para o seu usuário.
      </p>
      <Link
        href="/pacientes"
        className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Voltar para pacientes
      </Link>
    </div>
  );
}
