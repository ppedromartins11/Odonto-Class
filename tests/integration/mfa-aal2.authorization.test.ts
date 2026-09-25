import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaUser, createQaAdmin, type QaIdentity } from "./helpers";

const url = process.env.SUPABASE_TEST_URL;
const anon = process.env.SUPABASE_TEST_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anon && serviceKey);
const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("MFA AAL2 nas RPCs administrativas", () => {
  let service: SupabaseClient;
  let adminAal2: SupabaseClient;
  let adminAal1: SupabaseClient;
  let identity: QaIdentity;
  let accessTarget: { id: string; email: string; password: string };
  let materialId: string;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const qa = await createQaAdmin(service, url!, anon!);
    identity = qa.identity;
    adminAal2 = qa.session;
    const targetSuffix = randomUUID();
    const targetCredentials = {
      email: `qa_mfa_access-${targetSuffix}@example.com`,
      password: `Tmp-${randomUUID()}-A9!`,
    };
    const { data: targetData, error: targetError } = await createQaUser(service, {
      ...targetCredentials,
      email_confirm: true,
      user_metadata: {
        nome: `QA_MFA_ACCESS_${targetSuffix}`,
        perfil: "recepcao",
        created_by: identity.id,
      },
    });
    if (targetError || !targetData.user) throw new Error(`Falha ao criar alvo de acesso: ${targetError?.code ?? "sem_usuario"}`);
    accessTarget = { id: targetData.user.id, ...targetCredentials };
    adminAal1 = createClient(url!, anon!, { auth: { autoRefreshToken: false, persistSession: false } });
    expect((await adminAal1.auth.signInWithPassword(identity)).error).toBeNull();
    const created = await adminAal2.rpc("create_stock_material", {
      p_nome: `QA_MFA_Material_${identity.id}`,
      p_categoria: "QA_MFA",
      p_unidade: "unidade",
      p_quantidade_inicial: 1,
      p_estoque_minimo: 0,
      p_validade: null,
      p_fornecedor: null,
      p_ativo: true,
    });
    expect(created.error).toBeNull();
    materialId = (created.data as { id: string }).id;
  });

  afterAll(async () => {
    if (!service || !identity) return;
    await service.from("movimentacoes_estoque").delete().eq("material_id", materialId);
    await service.from("materiais_lotes").delete().eq("material_id", materialId);
    await service.from("materiais_estoque").delete().eq("id", materialId);
    if (accessTarget) {
      await service.from("profissionais").delete().eq("usuario_id", accessTarget.id);
      await service.from("auditoria").delete().eq("entidade_id", accessTarget.id);
      await service.from("usuarios").delete().eq("id", accessTarget.id);
      await service.auth.admin.deleteUser(accessTarget.id);
    }
    await service.from("profissionais").delete().eq("usuario_id", identity.id);
    await service.from("usuarios").delete().eq("id", identity.id);
    await service.auth.admin.deleteUser(identity.id);
  });

  it("bloqueia admin AAL1 em usuario, financeiro e ajuste de estoque", async () => {
    const user = await adminAal1.rpc("update_user_profile", { p_usuario_id: identity.id, p_nome: "QA MFA", p_registro_profissional: null });
    const access = await adminAal1.rpc("update_user_access", { p_usuario_id: accessTarget.id, p_perfil: null, p_status: "inativo" });
    const financial = await adminAal1.rpc("set_payment_status", { p_pagamento_id: "00000000-0000-0000-0000-000000000001", p_status: "cancelado" });
    const stock = await adminAal1.rpc("adjust_stock_lot", { p_material_id: materialId, p_lote_id: "00000000-0000-0000-0000-000000000002", p_nova_quantidade: 0, p_motivo: "QA MFA", p_referencia: null });
    for (const response of [user, access, financial, stock]) {
      expect(response.error?.code).toBe("42501");
      expect(response.error?.message).toContain("MFA_REQUIRED");
    }
  });

  it("desativa, repete e reativa o acesso com Admin AAL2", async () => {
    const deactivated = await adminAal2.rpc("update_user_access", {
      p_usuario_id: accessTarget.id,
      p_perfil: null,
      p_status: "inativo",
    });
    expect(deactivated.error).toBeNull();
    expect((await service.auth.admin.updateUserById(accessTarget.id, { ban_duration: "876000h" })).error).toBeNull();

    const repeated = await adminAal2.rpc("update_user_access", {
      p_usuario_id: accessTarget.id,
      p_perfil: null,
      p_status: "inativo",
    });
    expect(repeated.error).toBeNull();

    expect((await service.auth.admin.updateUserById(accessTarget.id, { ban_duration: "none" })).error).toBeNull();
    const reactivated = await adminAal2.rpc("update_user_access", {
      p_usuario_id: accessTarget.id,
      p_perfil: null,
      p_status: "ativo",
    });
    expect(reactivated.error).toBeNull();
    expect((await service.from("usuarios").select("status").eq("id", accessTarget.id).single()).data?.status).toBe("ativo");
  });

  it("retorna erros de dominio para usuario inexistente e autodesativacao", async () => {
    const missing = await adminAal2.rpc("update_user_access", {
      p_usuario_id: "00000000-0000-0000-0000-000000000001",
      p_perfil: null,
      p_status: "inativo",
    });
    expect(missing.error?.code).toBe("P0002");

    const self = await adminAal2.rpc("update_user_access", {
      p_usuario_id: identity.id,
      p_perfil: null,
      p_status: "inativo",
    });
    expect(self.error?.code).toBe("42501");
  });

  it("permite admin AAL2 e nao confunde regra de dominio com MFA", async () => {
    const response = await adminAal2.rpc("update_stock_material", {
      p_material_id: materialId,
      p_nome: "QA MFA Material atualizado",
      p_categoria: "QA_MFA",
      p_unidade: "unidade",
      p_estoque_minimo: 0,
      p_validade: null,
      p_fornecedor: null,
    });
    expect(response.error).toBeNull();
  });
});
