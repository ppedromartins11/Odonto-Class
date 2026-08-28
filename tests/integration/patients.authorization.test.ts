import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin } from "./helpers";

type Role = "administrador" | "dentista" | "recepcao";
type Identity = { id: string; email: string; password: string; role: Role };

const REQUIRED_MARKER = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const createdUsers: Identity[] = [];
const createdPatientIds: string[] = [];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

function userClient(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("pacientes Sprint 2: autorizacao, RLS e RPCs", () => {
  let url: string;
  let anonKey: string;
  let service: SupabaseClient;
  let adminSession: SupabaseClient;
  let adminId: string;
  let dentist: Identity;
  let reception: Identity;
  let inactive: Identity;
  let orphan: Identity;
  let dentistSession: SupabaseClient;
  let receptionSession: SupabaseClient;
  let patientId: string;

  async function createIdentity(role: Role): Promise<Identity> {
    const suffix = randomUUID();
    const identity = {
      email: `qa_rc_sprint2-${role}-${suffix}@example.com`,
      password: `Tmp-${randomUUID()}-A9!`,
      role,
    };
    const { data, error } = await service.auth.admin.createUser({
      email: identity.email,
      password: identity.password,
      email_confirm: true,
      user_metadata: {
        nome: `QA_RC_Usuario_${role}_${suffix}`,
        perfil: role,
        created_by: adminId,
      },
    });
    if (error || !data.user) {
      throw new Error(`Falha ao criar identidade ficticia: ${error?.code}`);
    }
    const result = { ...identity, id: data.user.id };
    createdUsers.push(result);
    return result;
  }

  async function signedIn(identity: Pick<Identity, "email" | "password">) {
    const client = userClient(url, anonKey);
    const { error } = await client.auth.signInWithPassword(identity);
    expect(error).toBeNull();
    return client;
  }

  beforeAll(async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== REQUIRED_MARKER) {
      throw new Error("Homologacao ficticia nao confirmada em .env.test.local.");
    }

    url = requiredEnv("SUPABASE_TEST_URL");
    anonKey = requiredEnv("SUPABASE_TEST_ANON_KEY");
    service = createClient(url, requiredEnv("SUPABASE_TEST_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const qaAdmin = await createQaAdmin(service, url, anonKey);
    adminSession = qaAdmin.session;
    adminId = qaAdmin.identity.id;
    createdUsers.push(qaAdmin.identity);

    dentist = await createIdentity("dentista");
    reception = await createIdentity("recepcao");
    inactive = await createIdentity("recepcao");
    orphan = await createIdentity("recepcao");
    dentistSession = await signedIn(dentist);
    receptionSession = await signedIn(reception);

    const { error: inactiveError } = await adminSession.rpc("update_user_access", {
      p_usuario_id: inactive.id,
      p_perfil: null,
      p_status: "inativo",
    });
    if (inactiveError) throw new Error(`Falha ao preparar inativo: ${inactiveError.code}`);

    const { error: orphanError } = await service.from("usuarios").delete().eq("id", orphan.id);
    if (orphanError) throw new Error(`Falha ao preparar sem perfil: ${orphanError.code}`);
  });

  afterAll(async () => {
    if (!service) return;

    if (createdPatientIds.length > 0) {
      await service.from("auditoria").delete().in("entidade_id", createdPatientIds);
      await service
        .from("paciente_alertas_clinicos")
        .delete()
        .in("paciente_id", createdPatientIds);
      await service.from("pacientes").delete().in("id", createdPatientIds);
    }

    const createdUserIds = createdUsers.map((identity) => identity.id);
    if (createdUserIds.length > 0) {
      await service.from("auditoria").delete().in("entidade_id", createdUserIds);
      await service.from("auditoria").delete().in("usuario_id", createdUserIds);
    }
    for (const identity of [...createdUsers].reverse()) {
      await service.from("profissionais").delete().eq("usuario_id", identity.id);
      await service.from("usuarios").delete().eq("id", identity.id);
      await service.auth.admin.deleteUser(identity.id);
    }
  });

  it("recepcao cria dados administrativos, mas nao injeta alerta clinico", async () => {
    const { data, error } = await receptionSession.rpc("create_patient", {
      p_nome: "QA_RC_Paciente_Principal",
      p_data_nascimento: "1985-04-10",
      p_telefone_contato: "+00 (65) 90000-1234",
      p_documento_identificacao: "DOC-FICTICIO-001",
      p_alergias: null,
      p_intolerancias: null,
      p_medicamentos_em_uso: null,
    });
    expect(error).toBeNull();
    patientId = (data as { id: string }).id;
    createdPatientIds.push(patientId);

    const { error: injectedClinicalError } = await receptionSession.rpc(
      "create_patient",
      {
        p_nome: "QA_RC_Tentativa_Clinica",
        p_data_nascimento: null,
        p_telefone_contato: null,
        p_documento_identificacao: null,
        p_alergias: "conteudo que deve ser recusado",
        p_intolerancias: null,
        p_medicamentos_em_uso: null,
      }
    );
    expect(injectedClinicalError).not.toBeNull();
  });

  it("busca por nome sem acento e por telefone normalizado", async () => {
    const { data: byName, error: nameError } = await receptionSession.rpc(
      "search_patients",
      { p_query: "qa_rc_paciente_principal", p_page: 1, p_page_size: 20, p_include_inactive: false }
    );
    expect(nameError).toBeNull();
    expect((byName as Array<{ id: string }>).some((row) => row.id === patientId)).toBe(true);

    const { data: byPhone, error: phoneError } = await dentistSession.rpc(
      "search_patients",
      { p_query: "90000-1234", p_page: 1, p_page_size: 20, p_include_inactive: false }
    );
    expect(phoneError).toBeNull();
    expect((byPhone as Array<{ id: string }>).some((row) => row.id === patientId)).toBe(true);

    const { data: wildcard, error: wildcardError } = await receptionSession.rpc(
      "search_patients",
      { p_query: "%_", p_page: 1, p_page_size: 20, p_include_inactive: false }
    );
    expect(wildcardError).toBeNull();
    expect(wildcard).toEqual([]);
  });

  it("permite homonimos sem impor unicidade artificial", async () => {
    const { data, error } = await dentistSession.rpc("create_patient", {
      p_nome: "QA_RC_Paciente_Principal",
      p_data_nascimento: "1992-08-20",
      p_telefone_contato: null,
      p_documento_identificacao: null,
      p_alergias: null,
      p_intolerancias: null,
      p_medicamentos_em_uso: null,
    });
    expect(error).toBeNull();
    createdPatientIds.push((data as { id: string }).id);
  });

  it("dentista ve e atualiza alertas; recepcao e administrador puro nao recebem conteudo", async () => {
    const { error: updateError } = await dentistSession.rpc(
      "update_patient_clinical_alerts",
      {
        p_paciente_id: patientId,
        p_alergias: "QA_RC_Alergia",
        p_intolerancias: null,
        p_medicamentos_em_uso: "QA_RC_Medicamento",
      }
    );
    expect(updateError).toBeNull();

    const { data: dentistRows, error: dentistReadError } = await dentistSession
      .from("paciente_alertas_clinicos")
      .select("paciente_id, alergias, medicamentos_em_uso")
      .eq("paciente_id", patientId);
    expect(dentistReadError).toBeNull();
    expect(dentistRows).toHaveLength(1);

    for (const client of [receptionSession, adminSession]) {
      const { data, error } = await client
        .from("paciente_alertas_clinicos")
        .select("paciente_id, alergias, medicamentos_em_uso")
        .eq("paciente_id", patientId);
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { error: rpcError } = await client.rpc("update_patient_clinical_alerts", {
        p_paciente_id: patientId,
        p_alergias: "QA_RC_tentativa_recusada",
        p_intolerancias: null,
        p_medicamentos_em_uso: null,
      });
      expect(rpcError).not.toBeNull();
    }
  });

  it("todos os perfis ativos editam administrativo, mas escrita direta e DELETE falham", async () => {
    for (const client of [adminSession, dentistSession, receptionSession]) {
      const { error } = await client.rpc("update_patient", {
        p_paciente_id: patientId,
        p_nome: "QA_RC_Paciente_Principal",
        p_data_nascimento: "1985-04-10",
        p_telefone_contato: "+00 (65) 90000-1234",
        p_documento_identificacao: "DOC-FICTICIO-001",
      });
      expect(error).toBeNull();
    }

    const { error: insertError } = await receptionSession.from("pacientes").insert({
      nome: "QA_RC_Escrita_direta_recusada",
      created_by: reception.id,
      updated_by: reception.id,
    });
    expect(insertError).not.toBeNull();

    const { error: metadataError } = await dentistSession
      .from("pacientes")
      .update({ updated_by: dentist.id })
      .eq("id", patientId);
    expect(metadataError).not.toBeNull();

    const { error: deleteError } = await adminSession
      .from("pacientes")
      .delete()
      .eq("id", patientId);
    expect(deleteError).not.toBeNull();
  });

  it("somente administrador inativa e reativa paciente", async () => {
    for (const client of [dentistSession, receptionSession]) {
      const { error } = await client.rpc("set_patient_active", {
        p_paciente_id: patientId,
        p_ativo: false,
      });
      expect(error).not.toBeNull();
    }

    const { error: inactiveError } = await adminSession.rpc("set_patient_active", {
      p_paciente_id: patientId,
      p_ativo: false,
    });
    expect(inactiveError).toBeNull();

    const { data: hidden } = await receptionSession.rpc("search_patients", {
      p_query: "900001234",
      p_page: 1,
      p_page_size: 20,
      p_include_inactive: false,
    });
    expect((hidden as Array<{ id: string }>).some((row) => row.id === patientId)).toBe(false);

    const { error: reactivateError } = await adminSession.rpc("set_patient_active", {
      p_paciente_id: patientId,
      p_ativo: true,
    });
    expect(reactivateError).toBeNull();
  });

  it("usuario inativo e usuario sem perfil ficam sem acesso", async () => {
    for (const identity of [inactive, orphan]) {
      const client = await signedIn(identity);
      const { data, error } = await client.from("pacientes").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { error: rpcError } = await client.rpc("search_patients", {
        p_query: "qa_rc",
        p_page: 1,
        p_page_size: 20,
        p_include_inactive: false,
      });
      expect(rpcError).not.toBeNull();
    }
  });

  it("auditoria registra metadados sem conteudo sensivel", async () => {
    const { data, error } = await adminSession
      .from("auditoria")
      .select("evento, dados")
      .eq("entidade_id", patientId)
      .order("created_at");
    expect(error).toBeNull();
    expect(data?.some((row) => row.evento === "paciente_criado")).toBe(true);
    expect(data?.some((row) => row.evento === "alertas_clinicos_atualizados")).toBe(true);

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("QA_RC_Alergia");
    expect(serialized).not.toContain("QA_RC_Medicamento");
    expect(serialized).not.toContain("90000-1234");
    expect(serialized).not.toContain("DOC-FICTICIO-001");
  });
});
