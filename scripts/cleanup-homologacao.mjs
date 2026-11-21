import { createClient } from "@supabase/supabase-js";
import { assertHomologationEnvironment, confirmHomologationCleanup } from "./homologation-safety.mjs";

const PREFIX = "HOMOLOG_SEED_";
const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`Variável ${name} não configurada.`); return value; };
const remove = async (client, table, ids) => { if (!ids.length) return 0; const { error, count } = await client.from(table).delete({ count: "exact" }).in("id", ids); if (error) throw new Error(`${table}: ${error.code}`); return count ?? ids.length; };
const ids = async (client, table, field, pattern) => { const { data, error } = await client.from(table).select("id").ilike(field, `${pattern}%`); if (error) throw new Error(`${table}: ${error.code}`); return data.map((row) => row.id); };
const relatedIds = async (client, table, field, parentIds) => {
  if (!parentIds.length) return [];
  const { data, error } = await client.from(table).select("id").in(field, parentIds);
  if (error) throw new Error(`${table}: ${error.code}`);
  return data.map((row) => row.id);
};

async function main() {
  throw new Error("LEGACY_QA_CLEANUP_DISABLED: audit retention and runId ownership manifest required");
  assertHomologationEnvironment();
  await confirmHomologationCleanup();
  if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologação fictícia não confirmada.");
  const url = required("SUPABASE_TEST_URL");
  if (new URL(url).host !== new URL(required("NEXT_PUBLIC_SUPABASE_URL")).host) throw new Error("Ambiente local e homologação divergem.");
  const service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const tasks = await ids(service, "tarefas", "titulo", PREFIX);
  const appointments = await ids(service, "agendamentos", "observacoes_administrativas", PREFIX);
  const patients = await ids(service, "pacientes", "nome", PREFIX);
  const materials = await ids(service, "materiais_estoque", "nome", PREFIX);
  const services = await ids(service, "servicos", "nome", PREFIX);
  const returns = await ids(service, "retornos", "observacao_administrativa", PREFIX);
  const attendances = await ids(service, "atendimentos", "evolucao", PREFIX);
  const budgets = await ids(service, "orcamentos", "observacao_administrativa", PREFIX);
  const receivables = await ids(service, "financeiro_recebiveis", "observacao_administrativa", PREFIX);
  const equipment = await ids(service, "equipamentos_esterilizacao", "identificacao", PREFIX);
  const cycles = await ids(service, "ciclos_esterilizacao", "observacoes", PREFIX);
  const packages = await relatedIds(service, "pacotes_esterilizacao", "ciclo_id", cycles);
  const budgetItems = await relatedIds(service, "orcamento_itens", "orcamento_id", budgets);
  const budgetVersions = await relatedIds(service, "orcamento_pdf_versoes", "orcamento_id", budgets);
  const installments = await relatedIds(service, "financeiro_parcelas", "recebivel_id", receivables);
  const payments = await relatedIds(service, "pagamentos", "parcela_id", installments);
  const procedures = await relatedIds(service, "procedimentos", "atendimento_id", attendances);
  const procedureTeeth = await relatedIds(service, "procedimento_dentes", "procedimento_id", procedures);
  const allEntityIds = [
    ...tasks, ...appointments, ...patients, ...materials, ...services, ...returns,
    ...attendances, ...budgets, ...receivables, ...equipment, ...cycles, ...packages,
    ...budgetItems, ...budgetVersions, ...installments, ...payments, ...procedures, ...procedureTeeth,
  ];
  const { data: seedUsers, error: usersError } = await service.from("usuarios").select("id").ilike("email", "homolog_seed_%@example.test");
  if (usersError) throw new Error(`usuarios: ${usersError.code}`);
  const userIds = seedUsers.map((row) => row.id);
  const { data: lots, error: lotsError } = materials.length ? await service.from("materiais_lotes").select("id").in("material_id", materials) : { data: [], error: null };
  if (lotsError) throw new Error(`materiais_lotes: ${lotsError.code}`);
  const { data: moves, error: movesError } = materials.length ? await service.from("movimentacoes_estoque").select("id").in("material_id", materials) : { data: [], error: null };
  if (movesError) throw new Error(`movimentacoes_estoque: ${movesError.code}`);
  await remove(service, "procedimento_dentes", procedureTeeth);
  await remove(service, "procedimentos", procedures);
  await remove(service, "pagamentos", payments);
  // 0022 exige que as parcelas sejam removidas por cascade do recebível;
  // apagar parcelas isoladamente violaria o total deferido do recebível.
  await remove(service, "financeiro_recebiveis", receivables);
  await remove(service, "orcamento_pdf_versoes", budgetVersions);
  await remove(service, "orcamento_itens", budgetItems);
  await remove(service, "orcamentos", budgets);
  await remove(service, "retornos", returns);
  await remove(service, "pacotes_esterilizacao", packages);
  await remove(service, "ciclos_esterilizacao", cycles);
  await remove(service, "equipamentos_esterilizacao", equipment);
  await remove(service, "atendimentos", attendances);
  await remove(service, "movimentacoes_lotes", (moves ?? []).map((row) => row.id));
  await remove(service, "materiais_lotes", (lots ?? []).map((row) => row.id));
  await remove(service, "movimentacoes_estoque", (moves ?? []).map((row) => row.id));
  const totals = { tarefas: await remove(service, "tarefas", tasks), agendamentos: await remove(service, "agendamentos", appointments), servicos: await remove(service, "servicos", services), materiais: await remove(service, "materiais_estoque", materials) };
  // Pacientes só saem após referências marcadas pelo seed; se outra entidade os usar, o banco bloqueia a limpeza em vez de apagar dados alheios.
  if (patients.length) {
    const { error: alertsError } = await service.from("paciente_alertas_clinicos").delete().in("paciente_id", patients);
    if (alertsError) throw new Error(`paciente_alertas_clinicos: ${alertsError.code}`);
  }
  totals.pacientes = await remove(service, "pacientes", patients);
  if (allEntityIds.length) {
    const { error: auditEntityError } = await service.from("auditoria").delete().in("entidade_id", allEntityIds);
    if (auditEntityError) throw new Error(`auditoria por entidade: ${auditEntityError.code}`);
  }
  if (userIds.length) {
    // Remove apenas auditorias cujo ator ou alvo pertence ao conjunto técnico
    // marcado; não toca no histórico de usuários reais da homologação.
    const { error: auditActorError } = await service.from("auditoria").delete().in("usuario_id", userIds);
    if (auditActorError) throw new Error(`auditoria por ator: ${auditActorError.code}`);
    const { error: auditTargetError } = await service.from("auditoria").delete().in("entidade_id", userIds);
    if (auditTargetError) throw new Error(`auditoria por entidade: ${auditTargetError.code}`);
    const { error: professionalError } = await service.from("profissionais").delete().in("usuario_id", userIds); if (professionalError) throw new Error(`profissionais: ${professionalError.code}`);
    const { error: profileError } = await service.from("usuarios").delete().in("id", userIds); if (profileError) throw new Error(`usuarios: ${profileError.code}`);
    for (const id of userIds) { const { error } = await service.auth.admin.deleteUser(id); if (error) throw new Error(`auth.users: ${error.code}`); }
  }
  console.log(JSON.stringify({ ...totals, retornos: returns.length, atendimentos: attendances.length, orcamentos: budgets.length, recebiveis: receivables.length, equipamentos_esterilizacao: equipment.length, ciclos_esterilizacao: cycles.length, pacotes_esterilizacao: packages.length, usuarios_seed: userIds.length }, null, 2));
}
main().catch((error) => { console.error(`CLEANUP_HOMOLOGACAO_FALHOU: ${error.message}`); process.exitCode = 1; });
