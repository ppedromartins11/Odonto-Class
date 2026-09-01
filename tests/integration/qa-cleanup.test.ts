import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const QA_EMAIL_PREFIXES = ["qa_rc_", "qa_svc_", "qa_odo_", "qa_est_", "qa_orc_", "qa_fin_", "qa_vld_", "qa_ster_"];
const QA_TEXT_PREFIXES = ["QA_RC_", "QA_SVC_", "QA_ODO_", "QA_EST_", "QA_ORC_", "QA_FIN_", "QA_VLD_", "QA_STER_"];

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

async function deleteWhereIds(client: SupabaseClient, table: string, field: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await client.from(table).delete().in(field, ids);
  expect(error, `limpeza de ${table}.${field}`).toBeNull();
}

async function listAuthUsers(client: SupabaseClient) {
  const users: Array<{ id: string; email?: string }> = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    expect(error).toBeNull();
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

describe("limpeza de fixtures QA da homologacao", () => {
  it("remove somente fixtures QA identificaveis, inclusive Auth sem perfil", async () => {
    expect(process.env.SUPABASE_TEST_HOMOLOGATION).toBe("I_ACKNOWLEDGE_FAKE_DATA_ONLY");
    const service = createClient(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const authUsers = await listAuthUsers(service);
    const userIds = authUsers
      .filter((user) => QA_EMAIL_PREFIXES.some((prefix) => user.email?.startsWith(prefix)))
      .map((user) => user.id);

    const idFilter = userIds.join(",");
    const users = userIds.length
      ? await service.from("usuarios").select("id").in("id", userIds)
      : { data: [], error: null };
    expect(users.error).toBeNull();

    const patientsCreatedByQa = userIds.length
      ? await service.from("pacientes").select("id").in("created_by", userIds)
      : { data: [], error: null };
    const patientsUpdatedByQa = userIds.length
      ? await service.from("pacientes").select("id").in("updated_by", userIds)
      : { data: [], error: null };
    expect(patientsCreatedByQa.error).toBeNull();
    expect(patientsUpdatedByQa.error).toBeNull();
    const patientIds = [...new Set([...(patientsCreatedByQa.data ?? []), ...(patientsUpdatedByQa.data ?? [])].map((row) => row.id))];

    const professionalRows = userIds.length
      ? await service.from("profissionais").select("id").in("usuario_id", userIds)
      : { data: [], error: null };
    expect(professionalRows.error).toBeNull();
    const professionalIds = (professionalRows.data ?? []).map((row) => row.id);

    const attendanceRows = userIds.length
      ? await service.from("atendimentos").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    const attendanceByProfessional = professionalIds.length
      ? await service.from("atendimentos").select("id").in("profissional_id", professionalIds)
      : { data: [], error: null };
    expect(attendanceRows.error).toBeNull();
    expect(attendanceByProfessional.error).toBeNull();
    const attendanceIds = [...new Set([...(attendanceRows.data ?? []), ...(attendanceByProfessional.data ?? [])].map((row) => row.id))];

    const procedureRows = userIds.length
      ? await service.from("procedimentos").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})${attendanceIds.length ? `,atendimento_id.in.(${attendanceIds.join(",")})` : ""}`)
      : { data: [], error: null };
    expect(procedureRows.error).toBeNull();
    const procedureIds = (procedureRows.data ?? []).map((row) => row.id);

    const serviceRows = userIds.length
      ? await service.from("servicos").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    expect(serviceRows.error).toBeNull();
    const serviceIds = (serviceRows.data ?? []).map((row) => row.id);

    const materialRows = userIds.length
      ? await service.from("materiais_estoque").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    expect(materialRows.error).toBeNull();
    const materialIds = (materialRows.data ?? []).map((row) => row.id);

    const movementRows = materialIds.length
      ? await service.from("movimentacoes_estoque").select("id").in("material_id", materialIds)
      : { data: [], error: null };
    expect(movementRows.error).toBeNull();
    const movementIds = (movementRows.data ?? []).map((row) => row.id);

    const lotRows = materialIds.length
      ? await service.from("materiais_lotes").select("id").in("material_id", materialIds)
      : { data: [], error: null };
    expect(lotRows.error).toBeNull();
    const lotIds = (lotRows.data ?? []).map((row) => row.id);

    const cycleRows = userIds.length
      ? await service.from("ciclos_esterilizacao").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    expect(cycleRows.error).toBeNull();
    const cycleIds = (cycleRows.data ?? []).map((row) => row.id);

    const equipmentRows = userIds.length
      ? await service.from("equipamentos_esterilizacao").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    expect(equipmentRows.error).toBeNull();
    const equipmentIds = (equipmentRows.data ?? []).map((row) => row.id);

    const budgetRows = patientIds.length
      ? await service.from("orcamentos").select("id").in("paciente_id", patientIds)
      : { data: [], error: null };
    expect(budgetRows.error).toBeNull();
    const budgetIds = (budgetRows.data ?? []).map((row) => row.id);

    const paymentFilters = [
      patientIds.length ? `paciente_id.in.(${patientIds.join(",")})` : "",
      budgetIds.length ? `orcamento_id.in.(${budgetIds.join(",")})` : "",
    ].filter(Boolean).join(",");
    const paymentRows = paymentFilters
      ? await service.from("pagamentos").select("id").or(paymentFilters)
      : { data: [], error: null };
    expect(paymentRows.error).toBeNull();
    const paymentIds = (paymentRows.data ?? []).map((row) => row.id);

    const fileRows = userIds.length
      ? await service.from("arquivos_paciente").select("storage_path").or(`uploaded_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    expect(fileRows.error).toBeNull();
    const storagePaths = (fileRows.data ?? []).map((row) => row.storage_path);
    if (storagePaths.length) expect((await service.storage.from("arquivos-paciente").remove(storagePaths)).error).toBeNull();

    if (cycleIds.length) await deleteWhereIds(service, "pacotes_esterilizacao", "ciclo_id", cycleIds);
    if (cycleIds.length) await deleteWhereIds(service, "ciclos_esterilizacao", "id", cycleIds);
    if (equipmentIds.length) await deleteWhereIds(service, "equipamentos_esterilizacao", "id", equipmentIds);
    if (movementIds.length) await deleteWhereIds(service, "movimentacoes_lotes", "movimentacao_id", movementIds);
    if (lotIds.length) await deleteWhereIds(service, "materiais_lotes", "id", lotIds);
    if (materialIds.length) await deleteWhereIds(service, "movimentacoes_estoque", "material_id", materialIds);
    if (procedureIds.length) await deleteWhereIds(service, "procedimento_dentes", "procedimento_id", procedureIds);
    if (procedureIds.length) await deleteWhereIds(service, "procedimento_materiais_consumo", "procedimento_id", procedureIds);
    if (userIds.length) await deleteWhereIds(service, "auditoria", "usuario_id", userIds);
    if (paymentIds.length) await deleteWhereIds(service, "pagamentos", "id", paymentIds);
    if (budgetIds.length) await deleteWhereIds(service, "orcamento_itens", "orcamento_id", budgetIds);
    if (budgetIds.length) await deleteWhereIds(service, "orcamentos", "id", budgetIds);
    if (procedureIds.length) await deleteWhereIds(service, "procedimentos", "id", procedureIds);
    if (attendanceIds.length) await deleteWhereIds(service, "atendimentos", "id", attendanceIds);
    if (serviceIds.length) await deleteWhereIds(service, "servico_materiais", "servico_id", serviceIds);
    if (serviceIds.length) await deleteWhereIds(service, "servicos", "id", serviceIds);
    if (materialIds.length) await deleteWhereIds(service, "materiais_estoque", "id", materialIds);
    if (userIds.length) {
      await deleteWhereIds(service, "documentos", "created_by", userIds);
      await deleteWhereIds(service, "arquivos_paciente", "uploaded_by", userIds);
      await deleteWhereIds(service, "retornos", "created_by", userIds);
      await deleteWhereIds(service, "tarefas", "created_by", userIds);
      await deleteWhereIds(service, "agendamentos", "created_by", userIds);
    }
    if (patientIds.length) {
      await deleteWhereIds(service, "paciente_alertas_clinicos", "paciente_id", patientIds);
      await deleteWhereIds(service, "pacientes", "id", patientIds);
    }
    if (userIds.length) {
      await deleteWhereIds(service, "profissionais", "usuario_id", userIds);
      await deleteWhereIds(service, "usuarios", "id", userIds);
      for (const userId of userIds) {
        const { error } = await service.auth.admin.deleteUser(userId);
        expect(error?.code === "user_not_found" ? null : error).toBeNull();
      }
    }

    let finalAuthUsers = await listAuthUsers(service);
    for (let attempt = 0; attempt < 15 && finalAuthUsers.some((user) => QA_EMAIL_PREFIXES.some((prefix) => user.email?.startsWith(prefix))); attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      finalAuthUsers = await listAuthUsers(service);
    }
    expect(finalAuthUsers.filter((user) => QA_EMAIL_PREFIXES.some((prefix) => user.email?.startsWith(prefix)))).toHaveLength(0);
    for (const [table, column] of [["usuarios", "nome"], ["pacientes", "nome"], ["tarefas", "titulo"], ["agendamentos", "observacoes_administrativas"], ["procedimentos", "descricao"], ["servicos", "nome"], ["materiais_estoque", "nome"], ["equipamentos_esterilizacao", "nome"], ["pacotes_esterilizacao", "descricao"]] as const) {
      for (const prefix of QA_TEXT_PREFIXES) {
        const { count, error } = await service.from(table).select("id", { count: "exact", head: true }).ilike(column, `${prefix.replace(/_/g, "\\_")}%`);
        expect(error).toBeNull();
        expect(count, `residuos ${prefix} em ${table}`).toBe(0);
      }
    }
  }, 60_000);
});
