import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertHomologationEnvironment } from "./homologation-safety.mjs";

const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const PREFIX = "HOMOLOG_SEED_";
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Variavel ${name} nao configurada.`);
  return value;
};

async function main() {
  throw new Error("LEGACY_QA_REPAIR_DISABLED: runId ownership manifest required");
  assertHomologationEnvironment();
  if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologacao ficticia nao confirmada.");
  const url = required("SUPABASE_TEST_URL");
  if (new URL(url).host !== new URL(required("NEXT_PUBLIC_SUPABASE_URL")).host) throw new Error("Ambiente local e homologacao divergem.");
  const service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
  const email = "homolog_seed_admin@example.test";
  const listed = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw new Error(`auth.listUsers: ${listed.error.code}`);
  const user = listed.data.users.find((candidate) => candidate.email === email);
  if (!user) throw new Error("Conta administrativa tecnica de homologacao ausente.");
  const password = `Tmp-${randomUUID()}-A9!`;
  const rotated = await service.auth.admin.updateUserById(user.id, { password });
  if (rotated.error) throw new Error(`auth.updateUser: ${rotated.error.code}`);
  const session = createClient(url, required("SUPABASE_TEST_ANON_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
  const signed = await session.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(`auth.signIn: ${signed.error?.code ?? "sem_sessao"}`);
  const { data: tasks, error: taskError } = await service
    .from("tarefas")
    .select("id,status,prazo,created_at")
    .ilike("titulo", `${PREFIX}%`)
    .in("status", ["pendente", "em_andamento", "aguardando", "concluida"])
    .order("prazo", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (taskError) throw new Error(`tarefas: ${taskError.code}`);
  const byStatus = new Map();
  for (const task of tasks) {
    const tail = byStatus.get(task.status) ?? null;
    const { error } = await session.rpc("move_task_kanban", {
      p_tarefa_id: task.id,
      p_status: task.status,
      p_before_id: tail,
      p_after_id: null,
    });
    if (error) throw new Error(`move_task_kanban: ${error.code}`);
    byStatus.set(task.status, task.id);
  }
  console.log(JSON.stringify({ tarefas_reordenadas: tasks.length, colunas: Object.fromEntries([...byStatus.keys()].map((status) => [status, tasks.filter((task) => task.status === status).length])) }));
}

main().catch((error) => {
  console.error(`REPARO_KANBAN_FALHOU: ${error.message}`);
  process.exitCode = 1;
});
