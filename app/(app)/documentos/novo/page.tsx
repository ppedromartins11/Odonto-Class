import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPatient } from "@/lib/patients/queries";
import { listActiveProfessionals } from "@/lib/agenda/queries";
import { DocumentForm } from "../DocumentForm";
export default async function NewDocument({searchParams}:{searchParams:Promise<{paciente?:string}>}){await requireUser();const {paciente}=await searchParams;const [patient,professionals]=await Promise.all([paciente?getPatient(paciente):Promise.resolve(null),listActiveProfessionals()]);if(paciente&&!patient)notFound();return <div className="mx-auto max-w-3xl space-y-4"><div><h2 className="text-2xl font-medium">Novo documento</h2><p className="text-sm text-muted-foreground">Selecione o paciente, escolha o tipo e gere o PDF privado.</p></div><DocumentForm patient={patient} professionals={professionals}/></div>}
