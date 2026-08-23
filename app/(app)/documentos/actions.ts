"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CLINIC_NAME } from "@/lib/config/clinic";
import { renderPatientDocumentPdf } from "@/lib/operational/pdf";
import type { DomainActionState, DocumentType } from "@/lib/operational/types";
export async function createDocument(_: DomainActionState, form: FormData): Promise<DomainActionState> {
  await requireUser(); const patientId=String(form.get("patientId")??""); const professionalId=String(form.get("professionalId")??""); const type=String(form.get("type")??"") as DocumentType;
  if(!patientId||!professionalId||!["atestado","declaracao"].includes(type)) return {success:false,error:"Revise os dados do documento."};
  const s=await createSupabaseServerClient(); const [{data:patient},{data:pros}]=await Promise.all([s.from("pacientes").select("nome").eq("id",patientId).maybeSingle(),s.rpc("list_active_professionals")]); const professional=(pros??[]).find((p:{id:string})=>p.id===professionalId) as {nome?:string}|undefined;
  if(!patient||!professional) return {success:false,error:"Paciente ou profissional inválido."}; const issued=String(form.get("issuedAt")??new Date().toISOString().slice(0,10)); const start=String(form.get("periodStart")??"")||null; const end=String(form.get("periodEnd")??"")||null; const text=String(form.get("additionalText")??"").trim()||null;
  const bytes=await renderPatientDocumentPdf({clinicName:CLINIC_NAME,patientName:patient.nome,professionalName:professional.nome??"Profissional",type,issuedAt:issued,periodStart:start,periodEnd:end,additionalText:text}); const path=`${patientId}/documentos/${randomUUID()}.pdf`; const admin=createSupabaseAdminClient(); const upload=await admin.storage.from("arquivos-paciente").upload(path,bytes,{contentType:"application/pdf",upsert:false});
  if(upload.error)return{success:false,error:"Não foi possível gerar o PDF."}; const metadata=await s.rpc("create_document_metadata",{p_paciente_id:patientId,p_profissional_id:professionalId,p_tipo:type,p_emitido_em:issued,p_periodo_inicio:start,p_periodo_fim:end,p_texto_adicional:text,p_storage_path:path,p_nome_arquivo:`${type}-${issued}.pdf`,p_tamanho_bytes:bytes.length}); if(metadata.error){await admin.storage.from("arquivos-paciente").remove([path]);return{success:false,error:"Não foi possível salvar o documento."}} revalidatePath(`/pacientes/${patientId}`);return{success:true,error:null};
}
