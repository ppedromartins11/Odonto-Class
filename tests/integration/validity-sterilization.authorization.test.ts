import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
type Role = "administrador" | "recepcao" | "dentista";
type Identity = { id: string; email: string; password: string; role: Role };
let service: SupabaseClient, admin: SupabaseClient, reception: SupabaseClient, dentist: SupabaseClient;
let url: string, anon: string, adminId: string, controlledMaterialId: string, concurrentMaterialId: string;
let inactive: Identity, orphan: Identity;
const users: Identity[] = [], materialIds: string[] = [], movementIds: string[] = [], lotIds: string[] = [], equipmentIds: string[] = [], cycleIds: string[] = [], packageIds: string[] = [];

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} nao configurada em .env.test.local.`); return value; }
function client() { return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } }); }
async function login(identity: Pick<Identity, "email" | "password">) { const session = client(); expect((await session.auth.signInWithPassword(identity)).error).toBeNull(); return session; }
function addDays(value: string, days: number) { return new Date(Date.parse(`${value}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10); }
async function createIdentity(role: Role) {
  const suffix = randomUUID(); const candidate = { email: `qa_vld_${role}_${suffix}@example.com`, password: `Tmp-${randomUUID()}-A9!`, role };
  const { data, error } = await service.auth.admin.createUser({ email: candidate.email, password: candidate.password, email_confirm: true, user_metadata: { nome: `QA_VLD_${role}_${suffix}`, perfil: role, created_by: adminId } });
  if (error || !data.user) throw error ?? new Error("Usuario QA_VLD ausente."); const identity = { ...candidate, id: data.user.id }; users.push(identity); return identity;
}
async function createMaterial(name: string, quantity: number) {
  const { data, error } = await admin.rpc("create_stock_material", { p_nome: name, p_categoria: "QA_VLD", p_unidade: "unidade", p_quantidade_inicial: quantity, p_estoque_minimo: 0, p_validade: null, p_fornecedor: null, p_ativo: true });
  if (error || !data) throw error ?? new Error("Material QA_VLD ausente."); const id = (data as { id: string }).id; materialIds.push(id); return id;
}
function rememberMovement(result: { data: unknown; error: unknown }) { if (!result.error && result.data) movementIds.push((result.data as { id: string }).id); return result; }

describe.sequential("Sprint 15: lotes, validade e esterilizacao", () => {
  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologacao ficticia nao confirmada.");
    url = required("SUPABASE_TEST_URL"); anon = required("SUPABASE_TEST_ANON_KEY"); service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const qaAdmin = await createQaAdmin(service, url, anon); admin = qaAdmin.session; adminId = qaAdmin.identity.id; users.push(qaAdmin.identity);
    const receptionIdentity = await createIdentity("recepcao"); const dentistIdentity = await createIdentity("dentista"); inactive = await createIdentity("recepcao"); orphan = await createIdentity("recepcao");
    reception = await login(receptionIdentity); dentist = await login(dentistIdentity);
    expect((await admin.rpc("update_user_access", { p_usuario_id: inactive.id, p_perfil: null, p_status: "inativo" })).error).toBeNull();
    expect((await service.from("usuarios").delete().eq("id", orphan.id)).error).toBeNull();
    controlledMaterialId = await createMaterial(`QA_VLD_Material_${randomUUID()}`, 5);
    concurrentMaterialId = await createMaterial(`QA_VLD_Concorrencia_${randomUUID()}`, 10);
  });

  afterAll(async () => {
    if (!service) return;
    if (packageIds.length) await service.from("pacotes_esterilizacao").delete().in("id", packageIds);
    if (cycleIds.length) await service.from("ciclos_esterilizacao").delete().in("id", cycleIds);
    if (equipmentIds.length) await service.from("equipamentos_esterilizacao").delete().in("id", equipmentIds);
    if (lotIds.length) await service.from("movimentacoes_lotes").delete().in("lote_id", lotIds);
    if (movementIds.length) await service.from("auditoria").delete().in("entidade_id", movementIds);
    if (materialIds.length) await service.from("movimentacoes_estoque").delete().in("material_id", materialIds);
    if (lotIds.length) await service.from("materiais_lotes").delete().in("id", lotIds);
    if (materialIds.length) { await service.from("auditoria").delete().in("entidade_id", materialIds); await service.from("materiais_estoque").delete().in("id", materialIds); }
    if (users.length) await service.from("auditoria").delete().in("usuario_id", users.map(item => item.id));
    for (const identity of [...users].reverse()) { await service.from("profissionais").delete().eq("usuario_id", identity.id); await service.from("usuarios").delete().eq("id", identity.id); await service.auth.admin.deleteUser(identity.id); }
  });

  it("ativa controle com lote inicial e preserva o invariante de saldo", async () => {
    const { data: todayData, error: todayError } = await admin.rpc("clinic_today"); expect(todayError).toBeNull(); const today = String(todayData);
    const emptyMaterialId = await createMaterial(`QA_VLD_SemSaldo_${randomUUID()}`, 0);
    expect((await admin.rpc("set_stock_lot_control", { p_material_id: emptyMaterialId, p_controla: true, p_codigo_lote_inicial: null, p_data_validade: null, p_data_fabricacao: null, p_fornecedor: null })).error).toBeNull();
    expect((await admin.rpc("set_stock_lot_control", { p_material_id: emptyMaterialId, p_controla: false, p_codigo_lote_inicial: null, p_data_validade: null, p_data_fabricacao: null, p_fornecedor: null })).error).toBeNull();
    expect((await admin.rpc("set_stock_lot_control", { p_material_id: controlledMaterialId, p_controla: true, p_codigo_lote_inicial: null, p_data_validade: null, p_data_fabricacao: null, p_fornecedor: null })).error).not.toBeNull();
    expect((await admin.rpc("set_stock_lot_control", { p_material_id: controlledMaterialId, p_controla: true, p_codigo_lote_inicial: "QA_VLD_INICIAL", p_data_validade: addDays(today, 60), p_data_fabricacao: today, p_fornecedor: "QA_VLD_FORNECEDOR" })).error).toBeNull();
    expect((await admin.rpc("set_stock_lot_control", { p_material_id: concurrentMaterialId, p_controla: true, p_codigo_lote_inicial: "QA_VLD_CONCORRENTE", p_data_validade: addDays(today, 90), p_data_fabricacao: null, p_fornecedor: null })).error).toBeNull();
    const { data: lots } = await service.from("materiais_lotes").select("id,material_id,quantidade_atual").in("material_id", materialIds); lotIds.push(...(lots ?? []).map(item => item.id));
    const initial = lots?.find(item => item.material_id === controlledMaterialId); expect(initial?.quantidade_atual).toBe(5);
    const { data: material } = await service.from("materiais_estoque").select("quantidade_atual,controla_lote_validade").eq("id", controlledMaterialId).single(); expect(material).toMatchObject({ quantidade_atual: 5, controla_lote_validade: true });
    expect((await admin.rpc("set_stock_lot_control", { p_material_id: controlledMaterialId, p_controla: false, p_codigo_lote_inicial: null, p_data_validade: null, p_data_fabricacao: null, p_fornecedor: null })).error).not.toBeNull();
  });

  it("aplica entrada, saida, vencimento, ajuste e concorrencia sem divergencia", async () => {
    const today = String((await admin.rpc("clinic_today")).data); const validDate = addDays(today, 20); const expiredDate = addDays(today, -1);
    const entry = rememberMovement(await reception.rpc("register_stock_lot_entry", { p_material_id: controlledMaterialId, p_codigo_lote: "QA_VLD_VENCENDO", p_quantidade: 4, p_data_validade: validDate, p_data_fabricacao: null, p_fornecedor: null, p_motivo: "QA_VLD entrada", p_referencia: null })); expect(entry.error).toBeNull();
    const expired = rememberMovement(await reception.rpc("register_stock_lot_entry", { p_material_id: controlledMaterialId, p_codigo_lote: "QA_VLD_VENCIDO", p_quantidade: 2, p_data_validade: expiredDate, p_data_fabricacao: null, p_fornecedor: null, p_motivo: "QA_VLD entrada", p_referencia: null })); expect(expired.error).toBeNull();
    const { data: createdLots } = await service.from("materiais_lotes").select("id,codigo_lote").eq("material_id", controlledMaterialId); for (const lot of createdLots ?? []) if (!lotIds.includes(lot.id)) lotIds.push(lot.id);
    const expiringLot = createdLots?.find(item => item.codigo_lote === "QA_VLD_VENCENDO")?.id; const expiredLot = createdLots?.find(item => item.codigo_lote === "QA_VLD_VENCIDO")?.id; expect(expiringLot && expiredLot).toBeTruthy();
    expect((await reception.rpc("register_stock_lot_entry", { p_material_id: controlledMaterialId, p_codigo_lote: "QA_VLD_VENCENDO", p_quantidade: 1, p_data_validade: validDate, p_data_fabricacao: null, p_fornecedor: "QA_VLD_FORNECEDOR_DIVERGENTE", p_motivo: null, p_referencia: null })).error).not.toBeNull();
    const { data: listedLots, error: listError } = await admin.rpc("list_validity_lots", { p_query: "QA_VLD", p_status: null, p_page: 1, p_page_size: 50 }); expect(listError).toBeNull();
    const listed = (listedLots ?? []) as Array<{ codigo_lote: string; quantidade_atual: number; saldo_disponivel: number; status: string }>;
    expect(listed.find(item => item.codigo_lote === "QA_VLD_VENCENDO")).toMatchObject({ status: "proximo_do_vencimento", quantidade_atual: 4, saldo_disponivel: 4 });
    expect(listed.find(item => item.codigo_lote === "QA_VLD_VENCIDO")).toMatchObject({ status: "vencido", quantidade_atual: 2, saldo_disponivel: 0 });
    expect(rememberMovement(await reception.rpc("register_stock_lot_exit", { p_material_id: controlledMaterialId, p_lote_id: expiringLot, p_quantidade: 1, p_finalidade: "uso", p_motivo: null, p_referencia: null })).error).toBeNull();
    expect((await reception.rpc("register_stock_lot_exit", { p_material_id: controlledMaterialId, p_lote_id: expiredLot, p_quantidade: 1, p_finalidade: "uso", p_motivo: null, p_referencia: null })).error).not.toBeNull();
    expect(rememberMovement(await reception.rpc("register_stock_lot_exit", { p_material_id: controlledMaterialId, p_lote_id: expiredLot, p_quantidade: 1, p_finalidade: "descarte", p_motivo: "QA_VLD vencido", p_referencia: null })).error).toBeNull();
    expect((await reception.rpc("adjust_stock_lot", { p_material_id: controlledMaterialId, p_lote_id: expiringLot, p_nova_quantidade: 2, p_motivo: "QA_VLD ajuste", p_referencia: null })).error).not.toBeNull();
    expect(rememberMovement(await admin.rpc("adjust_stock_lot", { p_material_id: controlledMaterialId, p_lote_id: expiringLot, p_nova_quantidade: 2, p_motivo: "QA_VLD ajuste", p_referencia: null })).error).toBeNull();
    expect(rememberMovement(await admin.rpc("adjust_stock_lot", { p_material_id: controlledMaterialId, p_lote_id: expiringLot, p_nova_quantidade: 0, p_motivo: "QA_VLD zerar para inativacao", p_referencia: null })).error).toBeNull();
    expect((await admin.rpc("set_stock_lot_active", { p_lote_id: expiringLot, p_ativo: false })).error).toBeNull();
    const concurrentLot = (await service.from("materiais_lotes").select("id").eq("material_id", concurrentMaterialId).single()).data?.id; expect(concurrentLot).toBeTruthy();
    const [first, second] = await Promise.all([reception.rpc("register_stock_lot_exit", { p_material_id: concurrentMaterialId, p_lote_id: concurrentLot, p_quantidade: 6, p_finalidade: "uso", p_motivo: null, p_referencia: null }), admin.rpc("register_stock_lot_exit", { p_material_id: concurrentMaterialId, p_lote_id: concurrentLot, p_quantidade: 6, p_finalidade: "uso", p_motivo: null, p_referencia: null })]);
    expect([first, second].filter(result => !result.error)).toHaveLength(1); [first, second].forEach(rememberMovement);
    const { data: balance } = await service.from("materiais_estoque").select("quantidade_atual").eq("id", concurrentMaterialId).single(); expect(balance?.quantidade_atual).toBe(4);
    const { data: lotBalance } = await service.from("materiais_lotes").select("quantidade_atual").eq("id", concurrentLot).single(); expect(lotBalance?.quantidade_atual).toBe(4);
  });

  it("aplica RLS e RBAC de lotes sem permitir DML direto", async () => {
    expect((await dentist.rpc("list_validity_lots", { p_page: 1, p_page_size: 20 })).error).toBeNull();
    expect((await dentist.rpc("register_stock_lot_entry", { p_material_id: controlledMaterialId, p_codigo_lote: "QA_VLD_NEGADO", p_quantidade: 1, p_data_validade: "2099-12-31", p_data_fabricacao: null, p_fornecedor: null, p_motivo: null, p_referencia: null })).error).not.toBeNull();
    expect((await reception.rpc("update_stock_lot_metadata", { p_lote_id: lotIds[0], p_codigo_lote: "QA_VLD_NEGADO", p_data_validade: "2099-12-31", p_data_fabricacao: null, p_fornecedor: null })).error).not.toBeNull();
    expect((await reception.from("materiais_lotes").insert({ material_id: controlledMaterialId, codigo_lote: "QA_VLD_DML", quantidade_inicial: 1, quantidade_atual: 1, data_validade: "2099-12-31", created_by: adminId, updated_by: adminId })).error).not.toBeNull();
    expect((await reception.from("materiais_lotes").update({ quantidade_atual: 999 }).eq("id", lotIds[0])).error).not.toBeNull();
    expect((await reception.from("materiais_lotes").delete().eq("id", lotIds[0])).error).not.toBeNull();
    expect((await admin.rpc("set_stock_lot_active", { p_lote_id: lotIds[0], p_ativo: false })).error).not.toBeNull();
    expect((await dentist.rpc("get_validity_sterilization_summary")).error).not.toBeNull(); expect((await admin.rpc("get_validity_sterilization_summary")).error).toBeNull(); expect((await reception.rpc("get_validity_sterilization_summary")).error).toBeNull();
    for (const identity of [inactive, orphan]) { const blocked = await login(identity); expect((await blocked.from("materiais_lotes").select("id")).data).toEqual([]); expect((await blocked.rpc("list_validity_lots", { p_page: 1, p_page_size: 20 })).error).not.toBeNull(); }
  });

  it("controla equipamentos, ciclos e pacotes com transicoes irreversiveis", async () => {
    expect((await reception.rpc("create_sterilization_equipment", { p_nome: "QA_STER_Bloqueado", p_identificacao: `QA_STER_${randomUUID()}`, p_modelo: null, p_fabricante: null, p_numero_serie: null })).error).not.toBeNull();
    const equipmentResult = await admin.rpc("create_sterilization_equipment", { p_nome: "QA_STER_Autoclave", p_identificacao: `QA_STER_${randomUUID()}`, p_modelo: "QA_STER_Modelo", p_fabricante: null, p_numero_serie: null }); expect(equipmentResult.error).toBeNull(); const equipmentId = (equipmentResult.data as { id: string }).id; equipmentIds.push(equipmentId);
    const collisionResult = await admin.rpc("create_sterilization_equipment", { p_nome: "QA_STER_Reserva", p_identificacao: `QA_STER_RESERVA_${randomUUID()}`, p_modelo: null, p_fabricante: null, p_numero_serie: null }); expect(collisionResult.error).toBeNull(); const collisionId = (collisionResult.data as { id: string }).id; equipmentIds.push(collisionId);
    const collisionIdentification = (collisionResult.data as { identificacao: string }).identificacao;
    const edited = await admin.rpc("update_sterilization_equipment", { p_equipamento_id: equipmentId, p_nome: "QA_STER_Autoclave Corrigida", p_identificacao: `QA_STER_EDITADA_${randomUUID()}`, p_modelo: "QA_STER_Modelo Corrigido", p_fabricante: "QA_STER_Fabricante", p_numero_serie: "QA_STER_Serie" }); expect(edited.error).toBeNull(); expect(edited.data).toMatchObject({ nome: "QA_STER_Autoclave Corrigida", modelo: "QA_STER_Modelo Corrigido", fabricante: "QA_STER_Fabricante", numero_serie: "QA_STER_Serie" });
    expect((await admin.rpc("update_sterilization_equipment", { p_equipamento_id: equipmentId, p_nome: "QA_STER_Autoclave Corrigida", p_identificacao: collisionIdentification, p_modelo: null, p_fabricante: null, p_numero_serie: null })).error).not.toBeNull();
    const cycleResult = await reception.rpc("start_sterilization_cycle", { p_equipamento_id: equipmentId, p_observacoes: "QA_STER observacao" }); expect(cycleResult.error).toBeNull(); const cycleId = (cycleResult.data as { id: string }).id; cycleIds.push(cycleId);
    const today = String((await admin.rpc("clinic_today")).data);
    const packageResult = await reception.rpc("create_sterilization_package", { p_ciclo_id: cycleId, p_codigo: `QA_STER_${randomUUID()}`, p_descricao: "QA_STER_Kit clinico", p_validade_ate: addDays(today, 60) }); expect(packageResult.error).toBeNull(); const packageId = (packageResult.data as { id: string }).id; packageIds.push(packageId);
    expect((await reception.rpc("finish_sterilization_cycle", { p_ciclo_id: cycleId, p_status: "concluido", p_observacoes: null })).error).toBeNull();
    expect((await reception.rpc("set_sterilization_package_status", { p_pacote_id: packageId, p_status: "utilizado" })).error).toBeNull();
    expect((await reception.rpc("set_sterilization_package_status", { p_pacote_id: packageId, p_status: "descartado" })).error).not.toBeNull();
    const rejectedCycle = await reception.rpc("start_sterilization_cycle", { p_equipamento_id: equipmentId, p_observacoes: null }); expect(rejectedCycle.error).toBeNull(); const rejectedId = (rejectedCycle.data as { id: string }).id; cycleIds.push(rejectedId);
    const rejectedPackage = await reception.rpc("create_sterilization_package", { p_ciclo_id: rejectedId, p_codigo: `QA_STER_${randomUUID()}`, p_descricao: "QA_STER_Kit reprovado", p_validade_ate: addDays(today, 30) }); expect(rejectedPackage.error).toBeNull(); const rejectedPackageId = (rejectedPackage.data as { id: string }).id; packageIds.push(rejectedPackageId);
    expect((await reception.rpc("finish_sterilization_cycle", { p_ciclo_id: rejectedId, p_status: "reprovado", p_observacoes: "QA_STER reprovado" })).error).toBeNull();
    const { data: rejectedState } = await service.from("pacotes_esterilizacao").select("status_operacional,esterilizado_em").eq("id", rejectedPackageId).single(); expect(rejectedState).toMatchObject({ status_operacional: "descartado", esterilizado_em: null });
    expect((await reception.rpc("set_sterilization_equipment_active", { p_equipamento_id: equipmentId, p_ativo: false })).error).not.toBeNull(); expect((await admin.rpc("set_sterilization_equipment_active", { p_equipamento_id: equipmentId, p_ativo: false })).error).toBeNull();
    const inactiveEdit = await admin.rpc("update_sterilization_equipment", { p_equipamento_id: equipmentId, p_nome: "QA_STER_Autoclave Inativa", p_identificacao: `QA_STER_INATIVA_${randomUUID()}`, p_modelo: "", p_fabricante: "", p_numero_serie: "" }); expect(inactiveEdit.error).toBeNull(); expect(inactiveEdit.data).toMatchObject({ nome: "QA_STER_Autoclave Inativa", modelo: null, fabricante: null, numero_serie: null });
  });

  it("nega mutacoes de esterilizacao a dentista, inativo e DML direto; auditoria omite texto livre", async () => {
    expect((await dentist.from("equipamentos_esterilizacao").select("id")).error).toBeNull();
    expect((await dentist.rpc("start_sterilization_cycle", { p_equipamento_id: equipmentIds[0], p_observacoes: null })).error).not.toBeNull();
    expect((await reception.rpc("update_sterilization_equipment", { p_equipamento_id: equipmentIds[0], p_nome: "QA_STER_NEGADO", p_identificacao: "QA_STER_NEGADO", p_modelo: null, p_fabricante: null, p_numero_serie: null })).error).not.toBeNull();
    expect((await dentist.rpc("update_sterilization_equipment", { p_equipamento_id: equipmentIds[0], p_nome: "QA_STER_NEGADO", p_identificacao: "QA_STER_NEGADO", p_modelo: null, p_fabricante: null, p_numero_serie: null })).error).not.toBeNull();
    expect((await reception.from("equipamentos_esterilizacao").update({ nome: "QA_STER_DML" }).eq("id", equipmentIds[0])).error).not.toBeNull();
    expect((await reception.from("ciclos_esterilizacao").insert({ codigo: "EST-20990101-999999", equipamento_id: equipmentIds[0], iniciado_em: new Date().toISOString(), responsavel_id: adminId, created_by: adminId, updated_by: adminId })).error).not.toBeNull();
    expect((await reception.from("pacotes_esterilizacao").delete().eq("id", packageIds[0])).error).not.toBeNull();
    const blocked = await login(inactive); expect((await blocked.from("ciclos_esterilizacao").select("id")).data).toEqual([]); expect((await blocked.rpc("start_sterilization_cycle", { p_equipamento_id: equipmentIds[0], p_observacoes: null })).error).not.toBeNull(); expect((await blocked.rpc("update_sterilization_equipment", { p_equipamento_id: equipmentIds[0], p_nome: "QA_STER_NEGADO", p_identificacao: "QA_STER_NEGADO", p_modelo: null, p_fabricante: null, p_numero_serie: null })).error).not.toBeNull();
    const orphanSession = await login(orphan); expect((await orphanSession.rpc("update_sterilization_equipment", { p_equipamento_id: equipmentIds[0], p_nome: "QA_STER_NEGADO", p_identificacao: "QA_STER_NEGADO", p_modelo: null, p_fabricante: null, p_numero_serie: null })).error).not.toBeNull();
    const { data: audit } = await service.from("auditoria").select("evento,dados").in("usuario_id", users.map(item => item.id)); expect(JSON.stringify(audit)).not.toContain("QA_STER observacao"); expect(JSON.stringify(audit)).not.toContain("QA_VLD entrada"); expect(audit?.some(item => item.evento === "equipamento_esterilizacao_atualizado" && Array.isArray((item.dados as { campos_alterados?: unknown })?.campos_alterados))).toBe(true);
  });
});
