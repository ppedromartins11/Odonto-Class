import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

describe("limpeza QA_RC_ da homologacao", () => {
  it("nao deixa fixtures identificaveis no banco ou Auth", async () => {
    expect(process.env.SUPABASE_TEST_HOMOLOGATION).toBe("I_ACKNOWLEDGE_FAKE_DATA_ONLY");
    const service = createClient(
      required("SUPABASE_TEST_URL"),
      required("SUPABASE_TEST_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: qaUsers, error: qaUsersError } = await service
      .from("usuarios")
      .select("id,nome")
      .ilike("nome", "QA\\_RC\\_%");
    expect(qaUsersError).toBeNull();
    const qaUserIds = (qaUsers ?? []).map((user) => user.id);
    if (qaUserIds.length > 0) {
      expect((qaUsers ?? []).every((user) => user.nome.startsWith("QA_RC_"))).toBe(true);
      const { data: patientRows, error: patientError } = await service
        .from("pacientes")
        .select("id")
        .or(`nome.ilike.QA\\_RC\\_%,created_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")})`);
      expect(patientError).toBeNull();
      const patientIds = (patientRows ?? []).map((patient) => patient.id);

      const { data: fileRows, error: fileError } = await service
        .from("arquivos_paciente")
        .select("storage_path")
        .or(`uploaded_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")})`);
      expect(fileError).toBeNull();
      const storagePaths = (fileRows ?? []).map((file) => file.storage_path);
      if (storagePaths.length > 0) {
        expect((await service.storage.from("arquivos-paciente").remove(storagePaths)).error).toBeNull();
      }

      expect((await service.from("auditoria").delete().in("entidade_id", qaUserIds)).error).toBeNull();
      expect((await service.from("auditoria").delete().in("usuario_id", qaUserIds)).error).toBeNull();
      expect((await service.from("procedimentos").delete().or(`created_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")})`)).error).toBeNull();
      expect((await service.from("documentos").delete().or(`created_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")})`)).error).toBeNull();
      expect((await service.from("arquivos_paciente").delete().or(`uploaded_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")})`)).error).toBeNull();
      expect((await service.from("retornos").delete().or(`created_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")})`)).error).toBeNull();
      expect((await service.from("tarefas").delete().or(`created_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")}),responsavel_id.in.(${qaUserIds.join(",")})`)).error).toBeNull();
      expect((await service.from("atendimentos").delete().or(`created_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")})`)).error).toBeNull();
      expect((await service.from("agendamentos").delete().or(`created_by.in.(${qaUserIds.join(",")}),updated_by.in.(${qaUserIds.join(",")})`)).error).toBeNull();
      if (patientIds.length > 0) {
        expect((await service.from("paciente_alertas_clinicos").delete().in("paciente_id", patientIds)).error).toBeNull();
        expect((await service.from("pacientes").delete().in("id", patientIds)).error).toBeNull();
      }
      expect((await service.from("profissionais").delete().in("usuario_id", qaUserIds)).error).toBeNull();
      expect((await service.from("usuarios").delete().in("id", qaUserIds)).error).toBeNull();
      for (const userId of qaUserIds) {
        const { error } = await service.auth.admin.deleteUser(userId);
        expect(error).toBeNull();
      }
    }

    async function expectZero(table: string, query: PromiseLike<{ error: unknown; count: number | null }>) {
      const result = await query;
      expect(result.error).toBeNull();
      expect(result.count, `residuos QA_RC_ em ${table}`).toBe(0);
    }
    await Promise.all([
      expectZero("usuarios", service.from("usuarios").select("id", { count: "exact", head: true }).ilike("nome", "QA\\_RC\\_%")),
      expectZero("pacientes", service.from("pacientes").select("id", { count: "exact", head: true }).ilike("nome", "QA\\_RC\\_%")),
      expectZero("tarefas", service.from("tarefas").select("id", { count: "exact", head: true }).ilike("titulo", "QA\\_RC\\_%")),
      expectZero("retornos", service.from("retornos").select("id", { count: "exact", head: true }).ilike("observacao_administrativa", "QA\\_RC\\_%")),
      expectZero("agendamentos", service.from("agendamentos").select("id", { count: "exact", head: true }).ilike("observacoes_administrativas", "QA\\_RC\\_%")),
      expectZero("procedimentos", service.from("procedimentos").select("id", { count: "exact", head: true }).ilike("descricao", "QA\\_RC\\_%")),
      expectZero("documentos", service.from("documentos").select("id", { count: "exact", head: true }).ilike("nome_arquivo", "QA\\_RC\\_%")),
      expectZero("arquivos_paciente", service.from("arquivos_paciente").select("id", { count: "exact", head: true }).ilike("nome_original", "QA\\_RC\\_%")),
    ]);

    const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(error).toBeNull();
    expect(data.users.filter((user) => user.email?.startsWith("qa_rc_")).length).toBe(0);
  });
});
