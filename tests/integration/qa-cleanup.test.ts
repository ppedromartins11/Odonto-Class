import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const QA_EMAIL_PREFIXES = ["qa_rc_", "qa_svc_", "qa_est_", "qa_orc_", "qa_fin_"];
const QA_TEXT_PREFIXES = ["QA_RC_", "QA_SVC_", "QA_EST_", "QA_ORC_", "QA_FIN_"];

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

describe("limpeza de fixtures QA da homologacao", () => {
  it("remove somente fixtures QA identificaveis, inclusive Auth sem perfil", async () => {
    expect(process.env.SUPABASE_TEST_HOMOLOGATION).toBe("I_ACKNOWLEDGE_FAKE_DATA_ONLY");
    const service = createClient(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authRows, error: authError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(authError).toBeNull();
    const userIds = authRows.users
      .filter((user) => QA_EMAIL_PREFIXES.some((prefix) => user.email?.startsWith(prefix)))
      .map((user) => user.id);

    const idFilter = userIds.join(",");
    const users = userIds.length
      ? await service.from("usuarios").select("id").in("id", userIds)
      : { data: [], error: null };
    expect(users.error).toBeNull();

    const patientRows = userIds.length
      ? await service.from("pacientes").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    expect(patientRows.error).toBeNull();
    const patientIds = (patientRows.data ?? []).map((row) => row.id);

    const attendanceRows = userIds.length
      ? await service.from("atendimentos").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    expect(attendanceRows.error).toBeNull();
    const attendanceIds = (attendanceRows.data ?? []).map((row) => row.id);

    const procedureRows = userIds.length
      ? await service.from("procedimentos").select("id").or(`created_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
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

    const budgetRows = patientIds.length
      ? await service.from("orcamentos").select("id").in("paciente_id", patientIds)
      : { data: [], error: null };
    expect(budgetRows.error).toBeNull();
    const budgetIds = (budgetRows.data ?? []).map((row) => row.id);

    const paymentRows = patientIds.length
      ? await service.from("pagamentos").select("id").in("paciente_id", patientIds)
      : { data: [], error: null };
    expect(paymentRows.error).toBeNull();
    const paymentIds = (paymentRows.data ?? []).map((row) => row.id);

    const fileRows = userIds.length
      ? await service.from("arquivos_paciente").select("storage_path").or(`uploaded_by.in.(${idFilter}),updated_by.in.(${idFilter})`)
      : { data: [], error: null };
    expect(fileRows.error).toBeNull();
    const storagePaths = (fileRows.data ?? []).map((row) => row.storage_path);
    if (storagePaths.length) expect((await service.storage.from("arquivos-paciente").remove(storagePaths)).error).toBeNull();

    if (materialIds.length) await deleteWhereIds(service, "movimentacoes_estoque", "material_id", materialIds);
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
      for (const userId of userIds) expect((await service.auth.admin.deleteUser(userId)).error).toBeNull();
    }

    const { data: finalAuthRows, error: finalAuthError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(finalAuthError).toBeNull();
    expect(finalAuthRows.users.filter((user) => QA_EMAIL_PREFIXES.some((prefix) => user.email?.startsWith(prefix)))).toHaveLength(0);
    for (const [table, column] of [["usuarios", "nome"], ["pacientes", "nome"], ["tarefas", "titulo"], ["agendamentos", "observacoes_administrativas"], ["procedimentos", "descricao"], ["servicos", "nome"], ["materiais_estoque", "nome"]] as const) {
      for (const prefix of QA_TEXT_PREFIXES) {
        const { count, error } = await service.from(table).select("id", { count: "exact", head: true }).ilike(column, `${prefix.replace(/_/g, "\\_")}%`);
        expect(error).toBeNull();
        expect(count, `residuos ${prefix} em ${table}`).toBe(0);
      }
    }
  });
});
