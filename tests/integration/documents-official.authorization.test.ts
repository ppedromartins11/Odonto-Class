import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
type Role = "administrador" | "recepcao" | "dentista";
type Identity = { id: string; email: string; password: string; role: Role };
const users: Identity[] = [], paths: string[] = [], documentIds: string[] = [], budgetIds: string[] = [], versionIds: string[] = [];
let url: string, anon: string, service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentistA: SupabaseClient, dentistB: SupabaseClient;
let adminId: string, patientId: string, professionalA: string, professionalB: string, attendanceA: string, inactive: Identity, orphan: Identity;

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} não configurada em .env.test.local.`); return value; }
function fresh() { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function login(identity: Pick<Identity, "email" | "password">) { const client = fresh(); expect((await client.auth.signInWithPassword(identity)).error).toBeNull(); return client; }
async function createIdentity(role: Role) { const suffix = randomUUID(); const email = `qa_doc_${role}_${suffix}@example.com`; const password = `Tmp-${randomUUID()}-A9!`; const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome: `QA_DOC_${role}_${suffix}`, perfil: role, created_by: adminId } }); if (error || !data.user) throw error ?? new Error("QA_DOC usuário ausente."); const identity = { id: data.user.id, email, password, role }; users.push(identity); return identity; }
async function upload(path: string, content = "%PDF-QA_DOC") { paths.push(path); expect((await service.storage.from("arquivos-paciente").upload(path, new TextEncoder().encode(content), { contentType: "application/pdf", upsert: false })).error).toBeNull(); }
const sha = (digit: string) => digit.repeat(64);
function officialArgs(overrides: Record<string, unknown> = {}) {
  const path = `${patientId}/documentos/${randomUUID()}.pdf`;
  return { path, args: {
    p_paciente_id: patientId, p_atendimento_id: attendanceA, p_profissional_autor_id: professionalA,
    p_tipo: "atestado", p_emitido_em: "2026-09-01", p_finalidade: "QA_DOC_justificativa odontológica",
    p_comparecimento_inicio: null, p_comparecimento_fim: null, p_afastamento_quantidade: 1,
    p_afastamento_unidade: "dias", p_acompanhante_nome: null, p_acompanhante_identificacao: null,
    p_acompanhante_relacao: null, p_texto_adicional: null, p_cid_codigo: null, p_cid_autorizado: false,
    p_cid_autorizador_tipo: null, p_storage_path: path, p_nome_arquivo: "QA_DOC_atestado.pdf",
    p_tamanho_bytes: 11, p_layout_version: 2, p_pdf_sha256: sha("a"), ...overrides,
  } };
}

describe("QA_DOC_: documentos oficiais e snapshots privados", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologação fictícia não confirmada.");
    url = required("SUPABASE_TEST_URL"); anon = required("SUPABASE_TEST_ANON_KEY"); service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon); admin = qaAdmin.session; adminId = qaAdmin.identity.id; users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao"); const dentistAIdentity = await createIdentity("dentista"); const dentistBIdentity = await createIdentity("dentista"); inactive = await createIdentity("recepcao"); orphan = await createIdentity("recepcao");
    reception = await login(receptionIdentity); dentistA = await login(dentistAIdentity); dentistB = await login(dentistBIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
    const { data: professionals, error: professionalError } = await service.from("profissionais").select("id,usuario_id").in("usuario_id", [dentistAIdentity.id, dentistBIdentity.id]); expect(professionalError).toBeNull();
    professionalA = professionals?.find((row) => row.usuario_id === dentistAIdentity.id)?.id ?? ""; professionalB = professionals?.find((row) => row.usuario_id === dentistBIdentity.id)?.id ?? "";
    expect((await service.from("profissionais").update({ registro_profissional: "CRO-MT 12345" }).eq("id", professionalA)).error).toBeNull();
    expect((await service.from("profissionais").update({ registro_profissional: "CRO-MT 54321" }).eq("id", professionalB)).error).toBeNull();
    const patient = await reception.rpc("create_patient", { p_nome: `QA_DOC_Paciente_${randomUUID()}`, p_data_nascimento: null, p_telefone_contato: null, p_documento_identificacao: null, p_alergias: null, p_intolerancias: null, p_medicamentos_em_uso: null }); expect(patient.error).toBeNull(); patientId = (patient.data as { id: string }).id;
    const attendance = await service.from("atendimentos").insert({ paciente_id: patientId, profissional_id: professionalA, iniciado_em: "2026-09-01T13:00:00-04:00", status: "em_andamento", created_by: dentistAIdentity.id, updated_by: dentistAIdentity.id }).select("id").single(); expect(attendance.error).toBeNull(); attendanceA = attendance.data!.id;
  });

  afterAll(async () => {
    if (!service) return;
    if (paths.length) {
      expect((await service.storage.from("arquivos-paciente").remove(paths)).error).toBeNull();
      const listedPaths = await Promise.all(paths.map(async (path) => {
        const separator = path.lastIndexOf("/");
        const parent = path.slice(0, separator);
        const name = path.slice(separator + 1);
        const listed = await service.storage.from("arquivos-paciente").list(parent, { limit: 1000 });
        return { listed, name };
      }));
      for (const { listed, name } of listedPaths) {
        expect(listed.error).toBeNull();
        expect(listed.data?.some((item) => item.name === name)).toBe(false);
      }
    }
    if (documentIds.length) await service.from("documento_cid").delete().in("documento_id", documentIds);
    if (versionIds.length) await service.from("orcamento_pdf_versoes").delete().in("id", versionIds);
    if (documentIds.length) await service.from("documentos").delete().in("id", documentIds);
    if (budgetIds.length) { await service.from("orcamento_itens").delete().in("orcamento_id", budgetIds); await service.from("orcamentos").delete().in("id", budgetIds); }
    await service.from("auditoria").delete().or(`usuario_id.in.(${users.map((user) => user.id).join(",")})${documentIds.length ? `,entidade_id.in.(${documentIds.join(",")})` : ""}${budgetIds.length ? `,entidade_id.in.(${budgetIds.join(",")})` : ""}`);
    if (attendanceA) await service.from("atendimentos").delete().eq("id", attendanceA);
    if (patientId) { await service.from("paciente_alertas_clinicos").delete().eq("paciente_id", patientId); await service.from("pacientes").delete().eq("id", patientId); }
    for (const user of users.reverse()) { await service.from("profissionais").delete().eq("usuario_id", user.id); await service.from("usuarios").delete().eq("id", user.id); await service.auth.admin.deleteUser(user.id); }
  });

  it("permite ao dentista A emitir atestado e trata CID somente com autorização", async () => {
    const first = officialArgs(); await upload(first.path); const created = await dentistA.rpc("create_official_document", first.args); expect(created.error).toBeNull(); documentIds.push((created.data as { id: string }).id);
    const denied = officialArgs({ p_cid_codigo: "K04.7", p_cid_autorizado: false }); await upload(denied.path); expect((await dentistA.rpc("create_official_document", denied.args)).error).not.toBeNull();
    const allowed = officialArgs({ p_cid_codigo: "K04.7", p_cid_autorizado: true, p_cid_autorizador_tipo: "paciente", p_storage_path: `${patientId}/documentos/${randomUUID()}.pdf`, p_pdf_sha256: sha("b") }); await upload(allowed.args.p_storage_path as string); const withCid = await dentistA.rpc("create_official_document", allowed.args); expect(withCid.error).toBeNull(); const cidDocumentId = (withCid.data as { id: string }).id; documentIds.push(cidDocumentId);
    expect((await dentistA.from("documento_cid").select("codigo").eq("documento_id", cidDocumentId)).data).toEqual([{ codigo: "K04.7" }]);
    expect((await reception.from("documento_cid").select("codigo").eq("documento_id", cidDocumentId)).data).toEqual([]);
    expect((await admin.from("documento_cid").select("codigo").eq("documento_id", cidDocumentId)).data).toEqual([]);
    expect((await dentistB.from("documento_cid").select("codigo").eq("documento_id", cidDocumentId)).data).toEqual([]);
    const { data: audit } = await service.from("auditoria").select("evento,dados").eq("entidade_id", cidDocumentId); expect(audit?.some((row) => row.evento === "documento_emitido")).toBe(true); expect(JSON.stringify(audit)).not.toContain("K04.7");
  });

  it("permite declarações factuais e bloqueia autoria clínica arbitrária", async () => {
    const declaration = officialArgs({ p_tipo: "declaracao_comparecimento", p_comparecimento_inicio: "2026-09-01T13:00:00-04:00", p_comparecimento_fim: "2026-09-01T14:00:00-04:00", p_afastamento_quantidade: null, p_afastamento_unidade: null }); await upload(declaration.path); const prepared = await reception.rpc("create_official_document", declaration.args); expect(prepared.error).toBeNull(); documentIds.push((prepared.data as { id: string }).id);
    const companion = officialArgs({ p_tipo: "declaracao_acompanhamento", p_comparecimento_inicio: "2026-09-01T13:00:00-04:00", p_comparecimento_fim: "2026-09-01T14:00:00-04:00", p_afastamento_quantidade: null, p_afastamento_unidade: null, p_acompanhante_nome: "QA_DOC_Acompanhante" }); await upload(companion.path); const adminPrepared = await admin.rpc("create_official_document", companion.args); expect(adminPrepared.error).toBeNull(); documentIds.push((adminPrepared.data as { id: string }).id);
    expect((await reception.rpc("create_official_document", officialArgs().args)).error).not.toBeNull();
    expect((await admin.rpc("create_official_document", officialArgs().args)).error).not.toBeNull();
    expect((await dentistB.rpc("create_official_document", officialArgs().args)).error).not.toBeNull();
    expect((await reception.rpc("create_official_document", officialArgs({ p_profissional_autor_id: professionalB }).args)).error).not.toBeNull();
    const { data: audit } = await service.from("auditoria").select("evento,dados").in("entidade_id", documentIds); expect(audit?.some((row) => row.evento === "documento_preparado")).toBe(true); expect(JSON.stringify(audit)).not.toContain("QA_DOC_Acompanhante");
  });

  it("nega inativo, sem perfil, DML direto e o RPC legado", async () => {
    for (const identity of [inactive, orphan]) { const blocked = await login(identity); expect((await blocked.rpc("create_official_document", officialArgs({ p_tipo: "declaracao_comparecimento", p_comparecimento_inicio: "2026-09-01T13:00:00-04:00", p_comparecimento_fim: "2026-09-01T14:00:00-04:00", p_afastamento_quantidade: null, p_afastamento_unidade: null }).args)).error).not.toBeNull(); }
    expect((await reception.rpc("create_document_metadata", { p_paciente_id: patientId, p_profissional_id: professionalA, p_tipo: "atestado", p_emitido_em: "2026-09-01", p_periodo_inicio: null, p_periodo_fim: null, p_texto_adicional: null, p_storage_path: `${patientId}/documentos/${randomUUID()}.pdf`, p_nome_arquivo: "QA_DOC_legacy.pdf", p_tamanho_bytes: 11 })).error).not.toBeNull();
    expect((await dentistA.from("documentos").insert({ paciente_id: patientId })).error).not.toBeNull();
    expect((await dentistA.from("documento_cid").insert({ documento_id: randomUUID(), codigo: "K04.7", autorizado: true, autorizador_tipo: "paciente", autorizado_em: new Date().toISOString(), registrado_por: users[0].id })).error).not.toBeNull();
  });

  it("valida CRO, atendimento elegível e entradas estruturadas sem persistência parcial", async () => {
    expect((await dentistA.rpc("list_document_author_attendances", { p_paciente_id: patientId })).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: attendanceA, profissional_id: professionalA }),
    ]));
    expect((await dentistB.rpc("list_document_author_attendances", { p_paciente_id: patientId })).data).toEqual([]);

    const noCro = officialArgs({ p_storage_path: `${patientId}/documentos/${randomUUID()}.pdf`, p_pdf_sha256: sha("f") });
    await upload(noCro.path);
    expect((await service.from("profissionais").update({ registro_profissional: null }).eq("id", professionalA)).error).toBeNull();
    try {
      expect((await dentistA.rpc("create_official_document", noCro.args)).error).not.toBeNull();
      expect((await service.from("documentos").select("id").eq("storage_path", noCro.path)).data).toEqual([]);
    } finally {
      expect((await service.from("profissionais").update({ registro_profissional: "CRO-MT 12345" }).eq("id", professionalA)).error).toBeNull();
    }

    const invalidInterval = officialArgs({
      p_tipo: "declaracao_comparecimento", p_comparecimento_inicio: "2026-09-01T14:00:00-04:00", p_comparecimento_fim: "2026-09-01T13:00:00-04:00",
      p_afastamento_quantidade: null, p_afastamento_unidade: null, p_storage_path: `${patientId}/documentos/${randomUUID()}.pdf`, p_pdf_sha256: sha("1"),
    });
    await upload(invalidInterval.path);
    expect((await reception.rpc("create_official_document", invalidInterval.args)).error).not.toBeNull();

    for (const quantity of [0, -1]) {
      const invalidAbsence = officialArgs({ p_afastamento_quantidade: quantity, p_storage_path: `${patientId}/documentos/${randomUUID()}.pdf`, p_pdf_sha256: sha(String(Math.abs(quantity) + 2)) });
      await upload(invalidAbsence.path);
      expect((await dentistA.rpc("create_official_document", invalidAbsence.args)).error).not.toBeNull();
    }

    const hours = officialArgs({ p_afastamento_quantidade: 2, p_afastamento_unidade: "horas", p_storage_path: `${patientId}/documentos/${randomUUID()}.pdf`, p_pdf_sha256: sha("9") });
    await upload(hours.path);
    const issuedInHours = await dentistA.rpc("create_official_document", hours.args);
    expect(issuedInHours.error).toBeNull();
    documentIds.push((issuedInHours.data as { id: string }).id);
    expect((issuedInHours.data as { afastamento_quantidade: number; afastamento_unidade: string }).afastamento_quantidade).toBe(2);
    expect((issuedInHours.data as { afastamento_quantidade: number; afastamento_unidade: string }).afastamento_unidade).toBe("horas");
  });

  it("preserva o binário histórico e incrementa versões concorrentes sem sobrescrita", async () => {
    const snapshotContent = "%PDF-QA_DOC-snapshot";
    const snapshotHash = createHash("sha256").update(snapshotContent).digest("hex");
    const snapshot = officialArgs({ p_storage_path: `${patientId}/documentos/${randomUUID()}.pdf`, p_pdf_sha256: snapshotHash, p_tamanho_bytes: snapshotContent.length });
    await upload(snapshot.path, snapshotContent);
    const created = await dentistA.rpc("create_official_document", snapshot.args);
    expect(created.error).toBeNull();
    documentIds.push((created.data as { id: string }).id);
    expect((created.data as { pdf_sha256: string }).pdf_sha256).toBe(snapshotHash);
    expect((await service.storage.from("arquivos-paciente").upload(snapshot.path, new TextEncoder().encode(snapshotContent), { contentType: "application/pdf", upsert: false })).error).not.toBeNull();
    const before = await service.storage.from("arquivos-paciente").download(snapshot.path);
    expect(before.error).toBeNull();
    const beforeHash = createHash("sha256").update(new Uint8Array(await before.data!.arrayBuffer())).digest("hex");
    expect((await service.from("pacientes").update({ nome: `QA_DOC_Paciente_atualizado_${randomUUID()}` }).eq("id", patientId)).error).toBeNull();
    const after = await service.storage.from("arquivos-paciente").download(snapshot.path);
    expect(after.error).toBeNull();
    expect(createHash("sha256").update(new Uint8Array(await after.data!.arrayBuffer())).digest("hex")).toBe(beforeHash);

    const budget = await reception.rpc("create_budget", { p_paciente_id: patientId, p_profissional_id: professionalA, p_validade_em: null, p_observacao_administrativa: "QA_DOC_concorrencia" });
    expect(budget.error).toBeNull();
    const budgetId = (budget.data as { id: string }).id; budgetIds.push(budgetId);
    expect((await reception.rpc("add_budget_item", { p_orcamento_id: budgetId, p_descricao: "QA_DOC_Item concorrente", p_quantidade: 1, p_valor_unitario_centavos: 100 })).error).toBeNull();
    const concurrent = ["3", "4"].map(async (digit) => {
      const path = `${budgetId}/orcamentos/${randomUUID()}.pdf`;
      await upload(path, `%PDF-QA_DOC-concorrencia-${digit}`);
      return reception.rpc("register_budget_pdf_version", { p_orcamento_id: budgetId, p_storage_path: path, p_pdf_sha256: sha(digit), p_layout_version: 2, p_tamanho_bytes: 22 });
    });
    const results = await Promise.all(concurrent);
    expect(results.every((result) => result.error === null)).toBe(true);
    versionIds.push(...results.map((result) => (result.data as { id: string }).id));
    const { data: versions, error } = await service.from("orcamento_pdf_versoes").select("id,versao").eq("orcamento_id", budgetId).order("versao");
    expect(error).toBeNull();
    expect(versions?.map((row) => row.versao)).toEqual([1, 2]);
  });

  it("registra versões imutáveis do orçamento sob RLS", async () => {
    const budget = await reception.rpc("create_budget", { p_paciente_id: patientId, p_profissional_id: professionalA, p_validade_em: null, p_observacao_administrativa: null }); expect(budget.error).toBeNull(); const budgetId = (budget.data as { id: string }).id; budgetIds.push(budgetId);
    expect((await reception.rpc("add_budget_item", { p_orcamento_id: budgetId, p_descricao: "QA_DOC_Procedimento", p_quantidade: 1, p_valor_unitario_centavos: 10000 })).error).toBeNull();
    for (const [index, digit] of [[1, "c"], [2, "d"]] as const) { const path = `${budgetId}/orcamentos/${randomUUID()}.pdf`; await upload(path, `%PDF-QA_DOC-v${index}`); const version = await reception.rpc("register_budget_pdf_version", { p_orcamento_id: budgetId, p_storage_path: path, p_pdf_sha256: sha(digit), p_layout_version: 2, p_tamanho_bytes: 14 }); expect(version.error).toBeNull(); versionIds.push((version.data as { id: string }).id); }
    const { data: versions } = await reception.from("orcamento_pdf_versoes").select("id,versao,pdf_sha256").eq("orcamento_id", budgetId).order("versao"); expect(versions?.map((row) => row.versao)).toEqual([1, 2]); expect(versions?.[0].pdf_sha256).not.toBe(versions?.[1].pdf_sha256);
    expect((await dentistA.from("orcamento_pdf_versoes").select("id").eq("orcamento_id", budgetId)).data).toHaveLength(2);
    expect((await dentistB.from("orcamento_pdf_versoes").select("id").eq("orcamento_id", budgetId)).data).toEqual([]);
    expect((await dentistB.rpc("register_budget_pdf_version", { p_orcamento_id: budgetId, p_storage_path: `${budgetId}/orcamentos/${randomUUID()}.pdf`, p_pdf_sha256: sha("e"), p_layout_version: 2, p_tamanho_bytes: 10 })).error).not.toBeNull();
    expect((await reception.from("orcamento_pdf_versoes").update({ versao: 99 }).eq("id", versionIds[0])).error).not.toBeNull();
    expect((await reception.from("orcamento_pdf_versoes").delete().eq("id", versionIds[0])).error).not.toBeNull();
    expect((await reception.storage.from("arquivos-paciente").download(paths.at(-1)!)).error).not.toBeNull();
  });
});
