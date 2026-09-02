import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

describe("QA_DOC_: prova de cleanup", () => {
  it("nao deixa metadados ou identidades QA_DOC_ na homologacao", async () => {
    expect(process.env.SUPABASE_TEST_HOMOLOGATION).toBe(ACK);
    const service = createClient(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [documents, patients, budgets, auth] = await Promise.all([
      service.from("documentos").select("id", { count: "exact", head: true }).ilike("nome_arquivo", "QA_DOC\\_%"),
      service.from("pacientes").select("id", { count: "exact", head: true }).ilike("nome", "QA_DOC\\_%"),
      service.from("orcamentos").select("id", { count: "exact", head: true }).ilike("observacao_administrativa", "QA_DOC\\_%"),
      service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    expect(documents.error).toBeNull();
    expect(patients.error).toBeNull();
    expect(budgets.error).toBeNull();
    expect(auth.error).toBeNull();
    expect(documents.count).toBe(0);
    expect(patients.count).toBe(0);
    expect(budgets.count).toBe(0);
    expect(auth.data.users.filter((user) => user.email?.startsWith("qa_doc_"))).toHaveLength(0);
  });

  it("remove objeto privado QA no formato UUID e confirma sua ausencia", async () => {
    expect(process.env.SUPABASE_TEST_HOMOLOGATION).toBe(ACK);
    const service = createClient(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const path = `${randomUUID()}/documentos/${randomUUID()}.pdf`;
    const uploaded = await service.storage.from("arquivos-paciente").upload(path, new TextEncoder().encode("%PDF-QA_DOC-cleanup"), {
      contentType: "application/pdf",
      upsert: false,
    });
    expect(uploaded.error).toBeNull();
    expect((await service.storage.from("arquivos-paciente").remove([path])).error).toBeNull();
    const separator = path.lastIndexOf("/");
    const listed = await service.storage.from("arquivos-paciente").list(path.slice(0, separator), { limit: 1000 });
    expect(listed.error).toBeNull();
    expect(listed.data?.some((item) => item.name === path.slice(separator + 1))).toBe(false);
  });
});
