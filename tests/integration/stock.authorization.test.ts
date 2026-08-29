import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
type Role = "administrador" | "recepcao" | "dentista";
type Identity = { id: string; email: string; password: string; role: Role };
let service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentistA: SupabaseClient, dentistB: SupabaseClient;
let url: string, anon: string, adminId: string, materialId: string, concurrentMaterialId: string;
let inactive: Identity, orphan: Identity;
const users: Identity[] = [], materialIds: string[] = [], movementIds: string[] = [];

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} não configurada em .env.test.local.`); return value; }
function client() { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function login(identity: Pick<Identity, "email" | "password">) { const session = client(); expect((await session.auth.signInWithPassword(identity)).error).toBeNull(); return session; }
async function createIdentity(role: Role) {
  const suffix = randomUUID(); const candidate = { email: `qa_est_${role}_${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role };
  const { data, error } = await service.auth.admin.createUser({ email: candidate.email, password: candidate.password, email_confirm: true, user_metadata: { nome: `QA_EST_${role}_${suffix}`, perfil: role, created_by: adminId } });
  if (error || !data.user) throw error ?? new Error("Usuário QA_EST ausente."); const identity = { ...candidate, id: data.user.id }; users.push(identity); return identity;
}
async function createMaterial(name: string, quantity = 10) {
  const { data, error } = await admin.rpc("create_stock_material", { p_nome: name, p_categoria: "QA_EST", p_unidade: "unidade", p_quantidade_inicial: quantity, p_estoque_minimo: 5, p_validade: null, p_fornecedor: null, p_ativo: true });
  if (error || !data) throw error ?? new Error("Material QA_EST ausente."); const id = (data as { id: string }).id; materialIds.push(id); return id;
}
function remember(result: { data: unknown; error: unknown }) { if (!result.error && result.data) movementIds.push((result.data as { id: string }).id); return result; }

describe("estoque: RLS, RPCs, integridade e auditoria", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologação fictícia não confirmada.");
    url = required("SUPABASE_TEST_URL"); anon = required("SUPABASE_TEST_ANON_KEY"); service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon); admin = qaAdmin.session; adminId = qaAdmin.identity.id; users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao"); const dentistAIdentity = await createIdentity("dentista"); const dentistBIdentity = await createIdentity("dentista"); inactive = await createIdentity("recepcao"); orphan = await createIdentity("recepcao");
    reception = await login(receptionIdentity); dentistA = await login(dentistAIdentity); dentistB = await login(dentistBIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
    materialId = await createMaterial(`QA_EST_Material_${randomUUID()}`); concurrentMaterialId = await createMaterial(`QA_EST_Concorrencia_${randomUUID()}`, 10);
  });

  afterAll(async () => {
    if (!service) return;
    if (movementIds.length) await service.from("auditoria").delete().in("entidade_id", movementIds);
    if (materialIds.length) { await service.from("auditoria").delete().in("entidade_id", materialIds); await service.from("movimentacoes_estoque").delete().in("material_id", materialIds); await service.from("materiais_estoque").delete().in("id", materialIds); }
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map((user) => user.id));
    for (const user of users.reverse()) { await service.from("profissionais").delete().eq("usuario_id", user.id); await service.from("usuarios").delete().eq("id", user.id); await service.auth.admin.deleteUser(user.id); }
  });

  it("permite cadastro e ajuste somente ao administrador, sem DML direto", async () => {
    for (const session of [admin, reception, dentistA]) {
      expect((await session.rpc("list_stock_materials", { p_page: 1, p_page_size: 20 })).error).toBeNull();
    }
    expect((await reception.rpc("create_stock_material", { p_nome: "QA_EST_Bloqueado", p_categoria: "QA_EST", p_unidade: "unidade", p_quantidade_inicial: 1, p_estoque_minimo: 0, p_validade: null, p_fornecedor: null, p_ativo: true })).error).not.toBeNull();
    expect((await dentistA.rpc("update_stock_material", { p_material_id: materialId, p_nome: "Alterado", p_categoria: "QA", p_unidade: "unidade", p_estoque_minimo: 0, p_validade: null, p_fornecedor: null })).error).not.toBeNull();
    expect((await dentistA.rpc("set_stock_material_active", { p_material_id: materialId, p_ativo: false })).error).not.toBeNull();
    expect((await reception.from("materiais_estoque").insert({ nome: "QA_EST_DML", categoria: "QA_EST", unidade: "unidade", quantidade_atual: 0, estoque_minimo: 0, created_by: adminId, updated_by: adminId })).error).not.toBeNull();
    expect((await reception.from("materiais_estoque").update({ quantidade_atual: 999 }).eq("id", materialId)).error).not.toBeNull();
    expect((await reception.from("materiais_estoque").delete().eq("id", materialId)).error).not.toBeNull();
    expect((await admin.rpc("update_stock_material", { p_material_id: materialId, p_nome: "QA_EST_Material editado", p_categoria: "QA_EST", p_unidade: "unidade", p_estoque_minimo: 5, p_validade: null, p_fornecedor: null })).error).toBeNull();
    expect(remember(await admin.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "ajuste", p_quantidade: 0, p_motivo: "QA_EST conferência", p_referencia: null })).error).toBeNull();
    expect((await admin.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "ajuste", p_quantidade: -1, p_motivo: "QA_EST", p_referencia: null })).error).not.toBeNull();
    expect((await admin.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "ajuste", p_quantidade: 1, p_motivo: null, p_referencia: null })).error).not.toBeNull();
  });

  it("aplica entradas e saídas autorizadas e bloqueia saldo negativo", async () => {
    expect(remember(await reception.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "entrada", p_quantidade: 10, p_motivo: "QA_EST recebimento", p_referencia: null })).error).toBeNull();
    expect(remember(await reception.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "saida", p_quantidade: 3, p_motivo: "QA_EST uso", p_referencia: null })).error).toBeNull();
    expect(remember(await dentistA.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "saida", p_quantidade: 2, p_motivo: "QA_EST consumo", p_referencia: null })).error).toBeNull();
    expect((await dentistA.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "saida", p_quantidade: 1, p_motivo: null, p_referencia: null })).error).not.toBeNull();
    expect((await dentistA.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "entrada", p_quantidade: 1, p_motivo: null, p_referencia: null })).error).not.toBeNull();
    expect((await reception.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "entrada", p_quantidade: 0, p_motivo: null, p_referencia: null })).error).not.toBeNull();
    expect((await reception.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "saida", p_quantidade: 0, p_motivo: null, p_referencia: null })).error).not.toBeNull();
    expect((await reception.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "saida", p_quantidade: 999999, p_motivo: null, p_referencia: null })).error).not.toBeNull();
    expect((await reception.from("movimentacoes_estoque").insert({ material_id: materialId, tipo: "entrada", quantidade: 1, quantidade_anterior: 0, quantidade_posterior: 1, created_by: adminId })).error).not.toBeNull();
  });

  it("mantém histórico global para recepção/admin e próprio para dentista", async () => {
    const all = await reception.rpc("list_stock_movements", { p_material_id: materialId, p_page: 1, p_page_size: 50 }); expect(all.error).toBeNull(); expect((all.data as unknown[]).length).toBeGreaterThan(1);
    const own = await dentistA.rpc("list_stock_movements", { p_material_id: materialId, p_page: 1, p_page_size: 50 }); expect(own.error).toBeNull(); expect((own.data as Array<{ usuario_nome: string }>).length).toBe(1);
    const other = await dentistB.rpc("list_stock_movements", { p_material_id: materialId, p_page: 1, p_page_size: 50 }); expect(other.error).toBeNull(); expect(other.data).toEqual([]);
  });

  it("serializa saídas concorrentes para impedir estoque negativo", async () => {
    const adminSummary = await admin.rpc("get_stock_summary");
    const receptionSummary = await reception.rpc("get_stock_summary");
    const dentistSummary = await dentistA.rpc("get_stock_summary");
    expect(adminSummary.error).toBeNull();
    expect(receptionSummary.error).toBeNull();
    expect(dentistSummary.error).not.toBeNull();
    expect((adminSummary.data as Array<{ total_ativos: number }>)[0]?.total_ativos).toEqual(expect.any(Number));
    const [first, second] = await Promise.all([
      reception.rpc("register_stock_movement", { p_material_id: concurrentMaterialId, p_tipo: "saida", p_quantidade: 6, p_motivo: "QA_EST concorrência", p_referencia: null }),
      admin.rpc("register_stock_movement", { p_material_id: concurrentMaterialId, p_tipo: "saida", p_quantidade: 6, p_motivo: "QA_EST concorrência", p_referencia: null }),
    ]);
    const successes = [first, second].filter((item) => !item.error); expect(successes).toHaveLength(1); successes.forEach(remember);
    const { data, error } = await service.from("materiais_estoque").select("quantidade_atual").eq("id", concurrentMaterialId).single(); expect(error).toBeNull(); expect(data?.quantidade_atual).toBe(4);
  });

  it("impede movimentação de material inativo e permite reativação somente ao administrador", async () => {
    expect((await admin.rpc("set_stock_material_active", { p_material_id: materialId, p_ativo: false })).error).toBeNull();
    expect((await reception.rpc("register_stock_movement", { p_material_id: materialId, p_tipo: "entrada", p_quantidade: 1, p_motivo: "QA_EST bloqueado", p_referencia: null })).error).not.toBeNull();
    expect((await admin.rpc("set_stock_material_active", { p_material_id: materialId, p_ativo: true })).error).toBeNull();
  });

  it("nega acesso a inativo, sem perfil e UUID inexistente; auditoria não contém motivo", async () => {
    for (const identity of [inactive, orphan]) { const blocked = await login(identity); expect((await blocked.from("materiais_estoque").select("id")).data).toEqual([]); expect((await blocked.rpc("list_stock_materials", { p_page: 1, p_page_size: 20 })).error).not.toBeNull(); }
    expect((await reception.rpc("register_stock_movement", { p_material_id: randomUUID(), p_tipo: "saida", p_quantidade: 1, p_motivo: "QA_EST", p_referencia: null })).error).not.toBeNull();
    const { data: audit } = await admin.from("auditoria").select("dados").in("entidade_id", movementIds); expect(JSON.stringify(audit)).not.toContain("QA_EST consumo");
  });
});
