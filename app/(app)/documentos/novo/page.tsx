import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPatient } from "@/lib/patients/queries";
import { listActiveProfessionals } from "@/lib/agenda/queries";
import { DocumentForm } from "../DocumentForm";
export default async function NewDocument({searchParams}:{searchParams:Promise<{paciente?:string}>}){await requireUser();const {paciente}=await searchParams;if(!paciente)notFound();const [patient,professionals]=await Promise.all([getPatient(paciente),listActiveProfessionals()]);if(!patient)notFound();return <div className="mx-auto max-w-3xl space-y-4"><div><h2 className="text-2xl font-medium">Novo documento</h2><p className="text-sm text-muted-foreground">Paciente: {patient.nome}</p></div><DocumentForm patientId={patient.id} professionals={professionals}/></div>}
