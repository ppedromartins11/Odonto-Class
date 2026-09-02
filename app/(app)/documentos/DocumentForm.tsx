"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { initialDomainActionState } from "@/lib/agenda/action-state";
import { PatientPicker } from "@/app/(app)/agenda/PatientPicker";
import { dateInputValueInCuiaba, dateTimeInputValueInCuiaba } from "@/lib/documents/date";
import type { PerfilUsuario } from "@/lib/auth/session";
import type { DocumentAuthorAttendance, NewDocumentType } from "@/lib/operational/types";
import { createDocument } from "./actions";

type PatientOption = { id: string; nome: string; telefone_contato: string | null };

function attendanceLabel(attendance: DocumentAuthorAttendance) {
  const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Cuiaba" }).format(new Date(attendance.iniciado_em));
  return `${date} · ${attendance.profissional_nome} · ${attendance.status === "finalizado" ? "Finalizado" : "Em andamento"}`;
}

export function DocumentForm({ patient, initialAttendances, profile, professionalUserIds = {} }: {
  patient?: PatientOption | null;
  initialAttendances: DocumentAuthorAttendance[];
  profile: PerfilUsuario;
  professionalUserIds?: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(createDocument, initialDomainActionState);
  const [attendances, setAttendances] = useState(initialAttendances);
  const [authorUserIds, setAuthorUserIds] = useState(professionalUserIds);
  const [selectedAttendanceId, setSelectedAttendanceId] = useState(initialAttendances[0]?.id ?? "");
  const [type, setType] = useState<NewDocumentType>(profile === "dentista" ? "atestado" : "declaracao_comparecimento");
  const [loadingAttendances, setLoadingAttendances] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [attendanceStart, setAttendanceStart] = useState("");
  const [attendanceEnd, setAttendanceEnd] = useState("");
  const [absenceQuantity, setAbsenceQuantity] = useState("");
  const [absenceUnit, setAbsenceUnit] = useState("");
  const [cidCode, setCidCode] = useState("");
  const [cidAuthorized, setCidAuthorized] = useState(false);
  const [cidAuthorizerType, setCidAuthorizerType] = useState("");
  const selectedAttendance = attendances.find((item) => item.id === selectedAttendanceId);
  const authorUserId = selectedAttendance ? authorUserIds[selectedAttendance.profissional_id] : undefined;

  const blockedReason = useMemo(() => {
    if (!selectedAttendanceId || !selectedAttendance) return "Selecione um atendimento elegível para continuar.";
    if (!selectedAttendance.registro_profissional?.trim()) return "Não é possível emitir este documento porque o registro profissional (CRO) da profissional autora não está cadastrado.";
    if (!purpose.trim()) return "Informe a finalidade do documento.";
    const start = attendanceStart || dateTimeInputValueInCuiaba(selectedAttendance.iniciado_em);
    const end = attendanceEnd || dateTimeInputValueInCuiaba(selectedAttendance.finalizado_em);
    if (type !== "atestado" && (!start || !end || new Date(end) <= new Date(start))) return "Informe um período de comparecimento válido.";
    if ((absenceQuantity && (!Number.isInteger(Number(absenceQuantity)) || Number(absenceQuantity) <= 0 || !absenceUnit)) || (!absenceQuantity && absenceUnit)) return "Informe um afastamento válido ou deixe os dois campos vazios.";
    if (cidCode && (!cidAuthorized || !cidAuthorizerType)) return "A inclusão do CID exige a autorização e quem a concedeu.";
    return null;
  }, [absenceQuantity, absenceUnit, attendanceEnd, attendanceStart, cidAuthorized, cidAuthorizerType, cidCode, purpose, selectedAttendance, selectedAttendanceId, type]);

  async function selectPatient(nextPatient: PatientOption | null) {
    setAttendances([]); setSelectedAttendanceId(""); setAttendanceStart(""); setAttendanceEnd("");
    if (!nextPatient) return;
    setLoadingAttendances(true);
    try {
      const response = await fetch(`/api/documentos/atendimentos?paciente=${encodeURIComponent(nextPatient.id)}`, { cache: "no-store" });
      const payload = (await response.json()) as { attendances?: DocumentAuthorAttendance[]; professionalUserIds?: Record<string, string> };
      const next = response.ok ? payload.attendances ?? [] : [];
      setAttendances(next); setAuthorUserIds(response.ok ? payload.professionalUserIds ?? {} : {}); setSelectedAttendanceId(next[0]?.id ?? "");
    } finally { setLoadingAttendances(false); }
  }

  return <form action={action} className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
    {patient ? <><input type="hidden" name="patientId" value={patient.id} /><div className="rounded-lg bg-secondary px-4 py-3 text-sm"><span className="text-muted-foreground">Paciente: </span><span className="font-medium">{patient.nome}</span></div></> : <PatientPicker searchLabel="Buscar paciente para documento" error={state.fieldErrors?.patientId} onSelect={selectPatient} />}
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm">Tipo de documento<select name="type" value={type} onChange={(event) => setType(event.target.value as NewDocumentType)} className="mt-1 block h-10 w-full rounded-md border bg-background px-3">{profile === "dentista" && <option value="atestado">Atestado odontológico</option>}<option value="declaracao_comparecimento">Declaração de comparecimento</option><option value="declaracao_acompanhamento">Declaração de acompanhamento</option></select></label>
      <label className="text-sm">Data de emissão<input name="issuedAt" type="date" required defaultValue={dateInputValueInCuiaba()} className="mt-1 block h-10 w-full rounded-md border bg-background px-3" /></label>
    </div>
    <label className="block text-sm">Atendimento que justifica a autoria<select name="attendanceId" required value={selectedAttendanceId} onChange={(event) => { setSelectedAttendanceId(event.target.value); setAttendanceStart(""); setAttendanceEnd(""); }} disabled={loadingAttendances || attendances.length === 0} className="mt-1 block h-10 w-full rounded-md border bg-background px-3 disabled:opacity-60"><option value="">{loadingAttendances ? "Carregando atendimentos..." : "Selecione um atendimento"}</option>{attendances.map((attendance) => <option key={attendance.id} value={attendance.id}>{attendanceLabel(attendance)}</option>)}</select></label>
    <input type="hidden" name="professionalId" value={selectedAttendance?.profissional_id ?? ""} />
    {selectedAttendance && <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2"><span><span className="text-muted-foreground">Autor: </span>{selectedAttendance.profissional_nome}</span><span className={selectedAttendance.registro_profissional ? "" : "text-destructive"}><span className="text-muted-foreground">Registro: </span>{selectedAttendance.registro_profissional || "Não cadastrado"}</span></div>}
    {selectedAttendance && !selectedAttendance.registro_profissional?.trim() && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p>Não é possível emitir este documento porque o registro profissional (CRO) da profissional autora não está cadastrado.</p>{profile === "administrador" && authorUserId ? <Link href={`/usuarios?editar=${authorUserId}`} className="mt-2 inline-block font-medium underline underline-offset-2">Cadastrar CRO</Link> : <p className="mt-1 text-xs">Solicite ao administrador o cadastro do seu CRO.</p>}</div>}
    {!loadingAttendances && attendances.length === 0 && <p role="alert" className="text-sm text-destructive">Nenhum atendimento autorizado foi encontrado para este paciente.</p>}
    <label className="block text-sm">Finalidade<input name="purpose" required minLength={2} maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Ex.: justificar ausência no trabalho" className="mt-1 block h-10 w-full rounded-md border bg-background px-3" /></label>
    {type !== "atestado" && <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Início do comparecimento<input name="attendanceStart" type="datetime-local" required value={attendanceStart || dateTimeInputValueInCuiaba(selectedAttendance?.iniciado_em ?? null)} onChange={(event) => setAttendanceStart(event.target.value)} key={`start-${selectedAttendanceId}`} className="mt-1 block h-10 w-full rounded-md border bg-background px-3" /></label><label className="text-sm">Fim do comparecimento<input name="attendanceEnd" type="datetime-local" required value={attendanceEnd || dateTimeInputValueInCuiaba(selectedAttendance?.finalizado_em ?? null)} onChange={(event) => setAttendanceEnd(event.target.value)} key={`end-${selectedAttendanceId}`} className="mt-1 block h-10 w-full rounded-md border bg-background px-3" /></label></div>}
    {type === "atestado" && <div className="space-y-4 rounded-lg border p-4"><h3 className="font-medium">Informações clínicas mínimas</h3><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Afastamento (opcional)<input name="absenceQuantity" type="number" min={1} max={365} value={absenceQuantity} onChange={(event) => setAbsenceQuantity(event.target.value)} placeholder="Quantidade" className="mt-1 block h-10 w-full rounded-md border bg-background px-3" /></label><label className="text-sm">Unidade<select name="absenceUnit" value={absenceUnit} onChange={(event) => setAbsenceUnit(event.target.value)} className="mt-1 block h-10 w-full rounded-md border bg-background px-3"><option value="">Sem afastamento</option><option value="horas">Horas</option><option value="dias">Dias</option></select></label></div><label className="block text-sm">Informação complementar objetiva (opcional)<textarea name="additionalText" maxLength={2000} className="mt-1 block min-h-20 w-full rounded-md border bg-background p-3" /></label><div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4"><label className="block text-sm">CID (opcional e sensível)<input name="cidCode" maxLength={12} autoComplete="off" value={cidCode} onChange={(event) => setCidCode(event.target.value.toUpperCase())} className="mt-1 block h-10 w-full rounded-md border bg-white px-3 uppercase" /></label><label className="mt-3 flex items-start gap-2 text-sm"><input name="cidAuthorized" type="checkbox" checked={cidAuthorized} onChange={(event) => setCidAuthorized(event.target.checked)} className="mt-0.5" /><span>O paciente ou responsável solicitou/autorizou a inclusão do CID.</span></label><label className="mt-3 block text-sm">Quem autorizou<select name="cidAuthorizerType" value={cidAuthorizerType} onChange={(event) => setCidAuthorizerType(event.target.value)} className="mt-1 block h-10 w-full rounded-md border bg-white px-3"><option value="">Selecione se houver CID</option><option value="paciente">Paciente</option><option value="responsavel">Responsável</option></select></label><p className="mt-2 text-xs text-muted-foreground">Este registro não representa assinatura digital e o CID não é incluído em auditoria.</p></div></div>}
    {type === "declaracao_acompanhamento" && <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-2"><label className="text-sm md:col-span-2">Nome do acompanhante<input name="companionName" required maxLength={160} className="mt-1 block h-10 w-full rounded-md border bg-background px-3" /></label><label className="text-sm">Identificação mínima (opcional)<input name="companionIdentification" maxLength={120} placeholder="Somente se necessário" className="mt-1 block h-10 w-full rounded-md border bg-background px-3" /></label><label className="text-sm">Relação/responsabilidade (opcional)<input name="companionRelationship" maxLength={120} className="mt-1 block h-10 w-full rounded-md border bg-background px-3" /></label></div>}
    {profile !== "dentista" && <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>O documento será marcado como <strong>preparado para assinatura física</strong>. O profissional vinculado ao atendimento permanece como autor.</p></div>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {blockedReason && <p role="alert" className="text-sm text-destructive">{blockedReason}</p>}
    <button disabled={pending || Boolean(blockedReason)} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"><FileCheck2 className="h-4 w-4" />{pending ? "Gerando documento..." : profile === "dentista" ? "Emitir PDF para assinatura" : "Preparar PDF para assinatura"}</button>
  </form>;
}
