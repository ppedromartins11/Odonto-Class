import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const PREFIX = "QA_TRAT_%";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurada em .env.test.local.`);
  return value;
}

describe("Sprint 21: cleanup QA_TRAT", () => {
  it("certifica que nenhuma fixture de tratamento permanece", async () => {
    if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologacao ficticia nao confirmada.");
    const service = createClient(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
    const [patients, budgets, procedures, plans] = await Promise.all([
      service.from("pacientes").select("id", { count: "exact", head: true }).like("nome", PREFIX),
      service.from("orcamentos").select("id", { count: "exact", head: true }).like("observacao_administrativa", PREFIX),
      service.from("procedimentos").select("id", { count: "exact", head: true }).like("descricao", PREFIX),
      service.from("planos_tratamento").select("id,orcamentos!inner(observacao_administrativa)", { count: "exact", head: true }).like("orcamentos.observacao_administrativa", PREFIX),
    ]);
    for (const result of [patients, budgets, procedures, plans]) expect(result.error).toBeNull();
    expect(patients.count).toBe(0);
    expect(budgets.count).toBe(0);
    expect(procedures.count).toBe(0);
    expect(plans.count).toBe(0);
  });
});
