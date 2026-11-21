import { randomUUID, randomBytes, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createQaAdmin, createQaUser } from "./helpers";
vi.mock("server-only", () => ({}));
import { renderPatientDocumentPdf } from "../../lib/operational/pdf";

// Tentativas adversariais de signup e corrupcao de fixtures nunca rodam remotamente.
const url = process.env.SUPABASE_TEST_URL ?? "";
const dbUrl = process.env.SUPABASE_TEST_DB_URL ?? "";
const isLocal = (value: string) => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname); } catch { return false; } };
const localOnly = isLocal(url) && isLocal(dbUrl);
const prefix = "QA_HIGH_" + randomUUID();
const users: string[] = [], storage: string[] = [], invitations: string[] = [], proofHashes: string[] = [];
let sql: Client, service: SupabaseClient, admin: SupabaseClient, aal1: SupabaseClient;
let dentist: SupabaseClient, otherDentist: SupabaseClient, reception: SupabaseClient, inactive: SupabaseClient;
let adminId: string, dentistId: string, professional: string, otherProfessional: string, patient: string, patient2: string;
const fresh = () => createClient(url, process.env.SUPABASE_TEST_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc(c: SupabaseClient, name: string, args = {}) {
  const result = await c.rpc(name, args); expect(result.error, name).toBeNull(); return result.data;
}
async function identity(role: string) {
  const email = (prefix + randomUUID() + "@example.test").toLowerCase(), password = "QA-a9!" + randomUUID();
  const created = await createQaUser(service, { email, password, user_metadata: { nome: prefix, perfil: role } });
  expect(created.error).toBeNull(); const id = created.data.user!.id; users.push(id);
  const client = fresh(); expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  return { id, client };
}
async function material() {
  return rpc(admin, "create_stock_material", { p_nome: prefix, p_categoria: "QA", p_unidade: "unidade", p_quantidade_inicial: 10, p_estoque_minimo: 0 });
}
async function procedure() {
  const attendance = await rpc(dentist, "create_direct_attendance", { p_paciente_id: patient });
  const item = await rpc(dentist, "create_procedure", { p_atendimento_id: attendance.id, p_descricao: prefix });
  return { attendance, item };
}
const activate = (id: string) => admin.rpc("set_stock_lot_control", { p_material_id: id, p_controla: true, p_codigo_lote_inicial: prefix, p_data_validade: "2099-01-01" });
const consume = (p: string, m: string, lot: string | null = null) => dentist.rpc("record_clinical_material_consumption", { p_procedimento_id: p, p_material_id: m, p_lote_id: lot, p_quantidade: 2 });
async function balance(id: string) {
  const result = await sql.query("select quantidade_atual, controla_lote_validade, (select coalesce(sum(quantidade_atual),0)::int from public.materiais_lotes where material_id=m.id) lots from public.materiais_estoque m where id=$1", [id]);
  await sql.query("select public.assert_lot_stock_balance($1)", [id]); return result.rows[0];
}
async function budget() {
  return rpc(admin, "create_budget", { p_paciente_id: patient, p_profissional_id: professional, p_validade_em: "2099-01-01", p_observacao_administrativa: prefix });
}
async function prepare(email: string, role = "recepcao") {
  const data = await rpc(admin, "prepare_user_invitation", { p_email: email, p_nome: prefix, p_perfil: role }); invitations.push(data.id); return data;
}
async function invite(email: string, token: string, metadata = {}) {
  const r = await service.auth.admin.generateLink({ type: "invite", email, options: { data: { provisioning_token: token, ...metadata } } });
  if (r.data.user) users.push(r.data.user.id); return r;
}

describe.skipIf(!localOnly).sequential("Sprint 22.7: HIGHs no Supabase local descartavel", () => {
  beforeAll(async () => {
    expect(process.env.SUPABASE_TEST_HOMOLOGATION).toBe("I_ACKNOWLEDGE_FAKE_DATA_ONLY");
    sql = new Client({ connectionString: dbUrl }); await sql.connect();
    service = createClient(url, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const qa = await createQaAdmin(service, url, process.env.SUPABASE_TEST_ANON_KEY!);
    admin = qa.session; adminId = qa.identity.id; users.push(adminId);
    aal1 = fresh(); expect((await aal1.auth.signInWithPassword(qa.identity)).error).toBeNull();
    const d = await identity("dentista"); dentist = d.client; dentistId = d.id;
    const b = await identity("dentista"); otherDentist = b.client;
    reception = (await identity("recepcao")).client;
    const inactiveIdentity = await identity("administrador"); inactive = inactiveIdentity.client;
    await rpc(admin, "update_user_access", { p_usuario_id: inactiveIdentity.id, p_status: "inativo" });
    const professionals = (await sql.query("select id,usuario_id from public.profissionais where usuario_id=any($1::uuid[])", [[d.id,b.id]])).rows;
    professional = professionals.find(p => p.usuario_id === d.id).id; otherProfessional = professionals.find(p => p.usuario_id === b.id).id;
    await sql.query("update public.profissionais set registro_profissional='QA-' || id::text where id=$1", [professional]);
    patient = (await rpc(reception, "create_patient", { p_nome: prefix })).id;
    patient2 = (await rpc(reception, "create_patient", { p_nome: prefix + "2" })).id;
  });

  afterAll(async () => {
    if (!sql) return;
    for (const tokenHash of proofHashes) expect((await service.rpc("cancel_upload_attestation", { p_token_hash: tokenHash })).error).toBeNull();
    if (storage.length) expect((await service.storage.from("arquivos-paciente").remove(storage)).error).toBeNull();
    await sql.query("begin");
    try {
      // UUIDs exclusivamente criados nesta suite; nao limpa prefixos de terceiros.
      if (invitations.length) await sql.query("delete from public.convites_provisionamento where id=any($1::uuid[])", [invitations]);
      const created = "created_by=any($1::uuid[])";
      for (const [table, condition] of [
        ["documento_cid", "documento_id in (select id from public.documentos where " + created + ")"],
        ["documentos", created], ["plano_tratamento_itens", created], ["planos_tratamento", created],
        ["consumos_clinicos_materiais", created], ["movimentacoes_lotes", created], ["movimentacoes_estoque", created],
        ["procedimento_materiais_consumo", created], ["procedimentos", created], ["atendimentos", created],
        ["agendamentos", created], ["orcamento_itens", created], ["orcamentos", created], ["materiais_lotes", created],
        ["materiais_estoque", created], ["paciente_alertas_clinicos", "paciente_id in (select id from public.pacientes where " + created + ")"],
        ["pacientes", created], ["auditoria", "usuario_id=any($1::uuid[]) or entidade_id=any($1::uuid[])"],
        ["profissionais", "usuario_id=any($1::uuid[])"], ["usuarios", "id=any($1::uuid[])"]
      ]) await sql.query("delete from public." + table + " where " + condition, [users]);
      await sql.query("commit");
      for (const id of users) expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
      expect((await sql.query("select id from auth.users where id=any($1::uuid[])", [users])).rows).toEqual([]);
    } catch (error) { await sql.query("rollback"); throw error; }
    finally { await sql.end(); }
  });

  it("H01: autor baixa CID; admin/recepcao nao recebem path; declaracao factual permanece acessivel", async () => {
    const a = await rpc(dentist, "create_direct_attendance", { p_paciente_id: patient });
    expect((await service.storage.getBucket("arquivos-paciente")).data?.public).toBe(false);
    for (const clinical of [true, false]) {
      const bytes = await renderPatientDocumentPdf({ clinicName: "QA", clinicTagline: "Ficticio", patientName: prefix, professionalName: prefix, professionalRegistration: "QA", type: clinical ? "atestado" : "declaracao_comparecimento", issuedAt: "2026-09-24", purpose: prefix, attendanceStart: "2026-09-24T12:00:00Z", attendanceEnd: "2026-09-24T13:00:00Z", cidCode: clinical ? "K04.7" : null });
      const path = patient + "/documentos/" + randomUUID() + ".pdf"; storage.push(path);
      expect((await service.storage.from("arquivos-paciente").upload(path, bytes, { contentType: "application/pdf" })).error).toBeNull();
      const fileHash = createHash("sha256").update(bytes).digest("hex");
      const uploadToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(uploadToken).digest("hex"); proofHashes.push(tokenHash);
      await rpc(service, "prepare_upload_attestation", {
        p_actor_id: dentistId, p_paciente_id: patient,
        p_purpose: clinical ? "document:atestado" : "document:declaracao_comparecimento",
        p_bucket_id: "arquivos-paciente", p_storage_path: path, p_sha256: fileHash,
        p_tamanho_bytes: bytes.length, p_mime_type: "application/pdf", p_token_hash: tokenHash,
      });
      const doc = await rpc(dentist, "create_official_document_verified", { p_paciente_id: patient, p_atendimento_id: a.id, p_profissional_autor_id: professional, p_tipo: clinical ? "atestado" : "declaracao_comparecimento", p_emitido_em: "2026-09-24", p_finalidade: prefix, p_comparecimento_inicio: clinical ? null : "2026-09-24T12:00:00Z", p_comparecimento_fim: clinical ? null : "2026-09-24T13:00:00Z", p_afastamento_quantidade: null, p_afastamento_unidade: null, p_acompanhante_nome: null, p_acompanhante_identificacao: null, p_acompanhante_relacao: null, p_texto_adicional: null, p_cid_codigo: clinical ? "K04.7" : null, p_cid_autorizado: clinical, p_cid_autorizador_tipo: clinical ? "paciente" : null, p_storage_path: path, p_nome_arquivo: "QA_HIGH.pdf", p_tamanho_bytes: bytes.length, p_layout_version: 2, p_pdf_sha256: fileHash, p_upload_token: uploadToken });
      for (const actor of [dentist, admin, reception, otherDentist]) {
        const allowed = actor === dentist || (!clinical && actor !== otherDentist);
        expect(await rpc(actor, "get_document_download_path", { p_documento_id: doc.id })).toBe(allowed ? path : null);
        if (actor === admin || actor === reception) {
          expect((await actor.from("documentos").select("id").eq("id",doc.id)).data).toHaveLength(1);
          expect((await actor.from("documento_cid").select("codigo").eq("documento_id",doc.id)).data).toEqual([]);
        }
        expect((await actor.storage.from("arquivos-paciente").createSignedUrl(path,300)).error).not.toBeNull();
        // Quando a aplicacao local esta em execucao, prova o binario na rota real.
        const appUrl = process.env.SUPABASE_TEST_APP_URL;
        if (appUrl) {
          expect(isLocal(appUrl)).toBe(true);
          const session = (await actor.auth.getSession()).data.session!;
          const jar: Array<{ name: string; value: string }> = [];
          const ssr = createServerClient(url, process.env.SUPABASE_TEST_ANON_KEY!, { cookies: { getAll: () => jar, setAll: items => { for (const item of items) { const i = jar.findIndex(c => c.name === item.name); if (i < 0) jar.push(item); else jar[i] = item; } } } });
          expect((await ssr.auth.setSession(session)).error).toBeNull();
          const response = await fetch(appUrl + "/api/documentos/" + doc.id, { headers: { cookie: jar.map(c => c.name + "=" + c.value).join("; ") }, redirect: "manual" });
          expect(response.status).toBe(allowed ? 307 : 404);
          if (!allowed) { expect(response.headers.get("location")).toBeNull(); expect(await response.text()).toBe(""); }
          else {
            const downloaded = await fetch(response.headers.get("location")!); expect(downloaded.status).toBe(200);
            const data = new Uint8Array(await downloaded.arrayBuffer());
            expect(createHash("sha256").update(data).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
            const pdf = await PDFDocument.load(data); let text = "";
            for (const [,v] of pdf.context.enumerateIndirectObjects()) if (v instanceof PDFRawStream) { try { text += Buffer.from(decodePDFRawStream(v).decode()).toString("latin1"); } catch { /* PNG stream */ } }
            expect(text.toUpperCase().includes(Buffer.from("K04.7").toString("hex").toUpperCase())).toBe(clinical);
          }
        }
      }
    }
  });

  it("H02: reatribui antes; preserva identidade apos inicio e rejeita vinculo historico corrompido", async () => {
    const date = new Date(Date.now()+86400000*20).toISOString().slice(0,10);
    const args = { p_paciente_id: patient, p_profissional_id: otherProfessional, p_inicio_local: date+"T10:00:00", p_fim_local: date+"T10:30:00", p_observacoes_administrativas: prefix };
    const appointment = await rpc(reception,"create_appointment",args);
    const update = { ...args, p_agendamento_id: appointment.id, p_profissional_id: professional };
    await rpc(reception,"update_appointment",update);
    const attendance = await rpc(dentist,"start_attendance",{ p_agendamento_id: appointment.id });
    const evolution = prefix + "_EVOLUCAO";
    await rpc(dentist,"update_attendance",{ p_atendimento_id: attendance.id, p_evolucao: evolution });
    for (const change of [{ p_profissional_id: otherProfessional },{ p_paciente_id: patient2 }]) {
      const denied = await reception.rpc("update_appointment",{ ...update,...change });
      expect(denied.error?.code).toBe("23514"); expect(denied.error?.message).toBe("ATTENDANCE_ALREADY_STARTED"); expect(denied.data).toBeNull();
    }
    await rpc(reception,"update_appointment",{ ...update,p_observacoes_administrativas: prefix+"editado" });
    expect((await rpc(dentist,"start_attendance",{ p_agendamento_id: appointment.id })).evolucao).toBe(evolution);
    expect((await otherDentist.from("atendimentos").select("*").eq("id",attendance.id)).data).toEqual([]);
    for (const mismatch of ["professional","patient"]) {
      await sql.query("update public.agendamentos set profissional_id=$1,paciente_id=$2 where id=$3",[mismatch === "professional" ? otherProfessional : professional,mismatch === "patient" ? patient2 : patient,appointment.id]);
      const denied = await (mismatch === "professional" ? otherDentist : dentist).rpc("start_attendance",{ p_agendamento_id: appointment.id });
      expect(denied.error?.code).toBe("42501"); expect(denied.data).toBeNull(); expect(JSON.stringify(denied.error)).not.toContain(evolution);
    }
    await sql.query("update public.agendamentos set profissional_id=$1,paciente_id=$2 where id=$3",[professional,patient,appointment.id]);
  });

  it("H03: todos overloads legados sem EXECUTE; fluxo atual valido e transicoes proibidas preservados", async () => {
    const grants = (await sql.query("select has_function_privilege('authenticated',p.oid,'EXECUTE') auth, has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='update_budget_status'")).rows;
    expect(grants.length).toBeGreaterThan(0); expect(grants.every(g=>!g.auth&&!g.anon)).toBe(true);
    const b = await budget();
    for (const [from,to] of [["rascunho","aprovado"],["aprovado","rascunho"],["convertido","rascunho"]]) {
      await sql.query("update public.orcamentos set status=$1 where id=$2",[from,b.id]);
      for (const actor of [admin,reception,dentist]) expect((await actor.rpc("update_budget_status",{ p_orcamento_id:b.id,p_status:to })).error?.code).toBe("42501");
      expect((await admin.rpc("set_budget_status",{ p_orcamento_id:b.id,p_status:to })).error?.code).toBe("23514");
    }
    await sql.query("update public.orcamentos set status='rascunho' where id=$1",[b.id]);
    await rpc(admin,"add_budget_item",{p_orcamento_id:b.id,p_descricao:prefix,p_quantidade:1,p_valor_unitario_centavos:100});
    for (const status of ["enviado","aprovado","convertido"]) expect((await rpc(admin,"set_budget_status",{p_orcamento_id:b.id,p_status:status})).status).toBe(status);
  });

  it("H04-A/B/C: sessoes reais AAL1/AAL2 e isolamento de auditoria", async () => {
    expect((await aal1.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel).toBe("aal1");
    expect((await admin.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel).toBe("aal2");
    const m = await material(), b = await budget();
    await rpc(admin,"add_budget_item",{p_orcamento_id:b.id,p_descricao:prefix,p_quantidade:1,p_valor_unitario_centavos:100});
    for (const status of ["enviado","aprovado"]) await rpc(admin,"set_budget_status",{p_orcamento_id:b.id,p_status:status});
    const plan = await rpc(admin,"convert_budget_to_treatment_plan",{p_orcamento_id:b.id});
    for (const [name,args] of [["register_stock_movement",{p_material_id:m.id,p_tipo:"ajuste",p_quantidade:12,p_motivo:prefix}],["cancel_treatment_plan",{p_plano_tratamento_id:plan.id}]] as const) {
      const denied = await aal1.rpc(name,args); expect(denied.error?.code).toBe("42501"); expect(denied.error?.message).toBe("MFA_REQUIRED");
      await rpc(admin,name,args);
    }
    for (const actor of [aal1,dentist,reception,inactive,fresh()]) {
      const result = await actor.from("auditoria").select("id").eq("entidade_id",plan.id);
      expect(result.data ?? []).toEqual([]);
    }
    expect((await admin.from("auditoria").select("id").eq("entidade_id",plan.id)).data?.length).toBeGreaterThan(0);
    await rpc(reception,"register_stock_movement",{p_material_id:m.id,p_tipo:"entrada",p_quantidade:1});
    await rpc(dentist,"register_stock_movement",{p_material_id:m.id,p_tipo:"saida",p_quantidade:1,p_motivo:prefix});
  });

  it("H05: signup forjado nao cria perfil; email de convite sem token nao autoriza", async () => {
    for (const role of ["administrador","dentista","recepcao"]) {
      const email=(prefix+randomUUID()+"@example.test").toLowerCase();
      await prepare(email,role);
      const result=await fresh().auth.signUp({email,password:"QA-a9!"+randomUUID(),options:{data:{nome:prefix,perfil:role,created_by:adminId}}});
      expect(result.error).not.toBeNull(); expect(result.data.session).toBeNull();
      expect((await sql.query("select id from public.usuarios where email=$1",[email])).rows).toEqual([]);
    }
    for (const actor of [aal1,dentist,reception,inactive,fresh()]) {
      const result=await actor.rpc("prepare_user_invitation",{p_email:prefix+"@example.test",p_nome:prefix,p_perfil:"administrador"});
      expect(result.error?.code).toBe("42501");
      if (actor===aal1) expect(result.error?.message).toBe("MFA_REQUIRED");
      expect((await actor.from("convites_provisionamento").select("*")).error).not.toBeNull();
      expect((await actor.from("convites_provisionamento").insert({email:prefix+"@example.test"})).error).not.toBeNull();
    }
  });

  it("H05: convite legitimo ignora perfil/autor forjados e token nao sobrevive/reexecuta", async () => {
    for (const role of ["administrador","dentista","recepcao"]) {
      const email=(prefix+randomUUID()+"@example.test").toLowerCase(); const authorization=await prepare(email,role);
      const response=await invite(email,authorization.token,{perfil:"administrador",created_by:randomUUID(),nome:"FORJADO"});
      expect(response.error).toBeNull(); const id=response.data.user!.id;
      expect((await sql.query("select perfil,nome from public.usuarios where id=$1",[id])).rows[0]).toEqual({perfil:role,nome:prefix});
      expect((await service.auth.admin.getUserById(id)).data.user?.user_metadata.provisioning_token).toBeUndefined();
      expect((await sql.query("select usuario_id from public.auditoria where entidade_id=$1 and evento='usuario_convidado'",[id])).rows[0].usuario_id).toBe(adminId);
      const badEmail=(prefix+randomUUID()+"@example.test").toLowerCase();
      expect((await invite(badEmail,authorization.token)).error).not.toBeNull();
      // Simula novo INSERT no mesmo email sem apagar a identidade legitima.
      // Savepoint rollback preserva fixture e prova consumo unico no trigger.
      await sql.query("begin");
      try {
        await sql.query("update auth.users set email=$1 where id=$2",[badEmail,id]);
        await expect(sql.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",[randomUUID(),email,{provisioning_token:authorization.token}])).rejects.toMatchObject({code:"42501"});
      } finally { await sql.query("rollback"); }
    }
  });

  it("H05: expiracao, revogacao, rotacao e concorrencia impedem replay", async () => {
    const email=(prefix+randomUUID()+"@example.test").toLowerCase(); const expired=await prepare(email);
    await sql.query("update public.convites_provisionamento set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",[expired.id]);
    expect((await invite(email,expired.token)).error).not.toBeNull();
    const revoked=await prepare(email); await rpc(admin,"revoke_user_invitation",{p_convite_id:revoked.id});
    expect((await invite(email,revoked.token)).error).not.toBeNull();
    const old=await prepare(email), current=await prepare(email);
    expect((await invite(email,old.token)).error).not.toBeNull();
    const results=await Promise.all([invite(email,current.token),invite(email,current.token)]);
    // Auth pode reenviar para uma conta ja convidada; apenas um perfil/evento existe.
    expect(results.some(r=>!r.error)).toBe(true);
    const rows=(await sql.query("select id from public.usuarios where email=$1",[email])).rows;
    expect(rows).toHaveLength(1);
    expect((await sql.query("select id from public.auditoria where entidade_id=$1 and evento='usuario_convidado'",[rows[0].id])).rows).toHaveLength(1);
    const unique=[...new Set(users)]; users.splice(0,users.length,...unique);
  });

  it("H05: inviteUserByEmail real preserva perfil e updateUser nao promove o convidado", async () => {
    const email=(prefix+randomUUID()+"@example.test").toLowerCase();
    const authorization=await prepare(email,"recepcao");
    const invited=await service.auth.admin.inviteUserByEmail(email,{data:{provisioning_token:authorization.token}});
    expect(invited.error).toBeNull(); const id=invited.data.user!.id; users.push(id);
    expect((await sql.query("select perfil from public.usuarios where id=$1",[id])).rows[0].perfil).toBe("recepcao");
    const password="QA-a9!"+randomUUID();
    expect((await service.auth.admin.updateUserById(id,{password,email_confirm:true})).error).toBeNull();
    const client=fresh(); expect((await client.auth.signInWithPassword({email,password})).error).toBeNull();
    for (const perfil of ["administrador","dentista"]) {
      expect((await client.auth.updateUser({data:{perfil,created_by:adminId}})).error).toBeNull();
      expect((await client.from("usuarios").select("perfil").eq("id",id).single()).data?.perfil).toBe("recepcao");
      expect((await client.rpc("prepare_user_invitation",{p_email:prefix+"@example.test",p_nome:prefix,p_perfil:perfil})).error?.code).toBe("42501");
    }
  });

  it("H06: bloqueia transicao aberta; estorno anterior permite ativacao e consumo normal por lote", async () => {
    const m=await material(),p=await procedure(); const consumed=await consume(p.item.id,m.id); expect(consumed.error).toBeNull();
    expect((await balance(m.id)).quantidade_atual).toBe(8);
    expect((await activate(m.id)).error?.message).toBe("LOT_CONTROL_PENDING_REVERSIBLE_CONSUMPTION");
    expect((await balance(m.id)).controla_lote_validade).toBe(false);
    await rpc(dentist,"reverse_clinical_material_consumption",{p_consumo_id:consumed.data.id});
    expect((await activate(m.id)).error).toBeNull(); expect(await balance(m.id)).toMatchObject({quantidade_atual:10,lots:10});
    expect((await activate(m.id)).error).toBeNull();
    const lot=(await sql.query("select id from public.materiais_lotes where material_id=$1",[m.id])).rows[0].id;
    const normal=await consume(p.item.id,m.id,lot); expect(normal.error).toBeNull(); expect(await balance(m.id)).toMatchObject({quantidade_atual:8,lots:8});
    await rpc(dentist,"reverse_clinical_material_consumption",{p_consumo_id:normal.data.id});
    expect(await balance(m.id)).toMatchObject({quantidade_atual:10,lots:10});
  });

  it("H06: historico finalizado permite controle, mas nunca estorno; defesa cobre legado inconsistente", async () => {
    const m=await material(),p=await procedure(); const consumed=await consume(p.item.id,m.id); expect(consumed.error).toBeNull();
    await rpc(dentist,"finalize_attendance",{p_atendimento_id:p.attendance.id,p_evolucao:prefix});
    expect((await activate(m.id)).error).toBeNull();
    expect((await dentist.rpc("reverse_clinical_material_consumption",{p_consumo_id:consumed.data.id})).error?.code).toBe("42501");
    expect(await balance(m.id)).toMatchObject({quantidade_atual:8,lots:8});
    // Fixture local simula estado antigo ja inconsistente com a nova regra.
    await sql.query("update public.atendimentos set status='em_andamento',finalizado_em=null where id=$1",[p.attendance.id]);
    const denied=await dentist.rpc("reverse_clinical_material_consumption",{p_consumo_id:consumed.data.id});
    expect(denied.error?.message).toBe("LOT_CONTROL_LEGACY_REVERSAL_DENIED");
    expect(await balance(m.id)).toMatchObject({quantidade_atual:8,lots:8});
    expect((await sql.query("select estornado_em from public.consumos_clinicos_materiais where id=$1",[consumed.data.id])).rows[0].estornado_em).toBeNull();
  });

  it("H06: consumo/ativacao e estorno/ativacao concorrentes preservam saldo", async () => {
    for (let i=0;i<3;i++) {
      const m=await material(),p=await procedure();
      const [consumed,activated]=await Promise.all([consume(p.item.id,m.id),activate(m.id)]);
      expect([consumed,activated].filter(r=>!r.error)).toHaveLength(1);
      await balance(m.id);
      if (!consumed.error) {
        const [reversed,transition]=await Promise.all([dentist.rpc("reverse_clinical_material_consumption",{p_consumo_id:consumed.data.id}),activate(m.id)]);
        expect(reversed.error).toBeNull();
        if (transition.error) expect(transition.error.message).toBe("LOT_CONTROL_PENDING_REVERSIBLE_CONSUMPTION");
        expect((await activate(m.id)).error).toBeNull();
        expect(await balance(m.id)).toMatchObject({quantidade_atual:10,lots:10});
      }
    }
  });
});
