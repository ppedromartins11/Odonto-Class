import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authorizeQaProvisioner, createQaUser, elevateQaAdminToAal2 } from "../tests/integration/helpers.ts";
import { assertHomologationEnvironment } from "./homologation-safety.mjs";

const qaFactors = [];
const PREFIX = "HOMOLOG_SEED_";
const ACK = "I_ACKNOWLEDGE_FAKE_DATA_ONLY";
const phaseArgument = process.argv.find((argument) => argument.startsWith("--phase="));
const phase = phaseArgument?.slice("--phase=".length) ?? "full";
if (!new Set(["a", "b", "full"]).has(phase)) {
  throw new Error("Fase invalida. Use --phase=a, --phase=b ou execute sem fase para o seed completo.");
}
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não configurada.`);
  return value;
};
const today = new Date().toISOString().slice(0, 10);
const day = (offset) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
const local = (offset, hour) => `${day(offset)}T${String(hour).padStart(2, "0")}:00`;

function fail(context, error) { throw new Error(`${context}: ${error?.code ?? error?.message ?? "falha"}`); }
async function rpc(client, name, args) { const { data, error } = await client.rpc(name, args); if (error) fail(name, error); return data; }

function assertEnvironment() {
  assertHomologationEnvironment();
  if (process.env.SUPABASE_TEST_HOMOLOGATION !== ACK) throw new Error("Homologação fictícia não confirmada.");
  const testUrl = required("SUPABASE_TEST_URL");
  const appUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  if (new URL(testUrl).host !== new URL(appUrl).host) throw new Error("Ambiente local e homologação divergem.");
  return testUrl;
}

async function assertKanbanSchema(service) {
  const { error } = await service.from("tarefas").select("id,ordem_kanban,status").eq("status", "aguardando").limit(1);
  if (error) throw new Error("Migration 0027 não está disponível na homologação; seed interrompido sem inserir dados.");
}

async function ensureIdentity(service, admin, creatorId, { key, name, role, cro }) {
  const email = `${key.toLowerCase()}@example.test`;
  const listed = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) fail("auth.listUsers", listed.error);
  let user = listed.data.users.find((candidate) => candidate.email === email);
  const password = `Tmp-${randomUUID()}-A9!`;
  if (!user) {
    const created = await createQaUser(service, { email, password, email_confirm: true, user_metadata: { nome: name, perfil: role, created_by: creatorId, seed_homologacao: PREFIX } });
    if (created.error || !created.data.user) fail("auth.createUser", created.error);
    user = created.data.user;
  } else {
    const changed = await service.auth.admin.updateUserById(user.id, { password });
    if (changed.error) fail("auth.updateUser", changed.error);
  }
  const session = createClient(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_ANON_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
  const signed = await session.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) fail("auth.signIn", signed.error);
  // Explicita a sessão no cliente efêmero: garante que as RPCs recebam auth.uid()
  // mesmo com persistSession desativado no processo de seed.
  const restored = await session.auth.setSession({ access_token: signed.data.session.access_token, refresh_token: signed.data.session.refresh_token });
  if (restored.error) fail("auth.setSession", restored.error);
  if (admin) await rpc(admin, "update_user_profile", { p_usuario_id: user.id, p_nome: name, p_registro_profissional: cro ?? null });
  const { data: profile, error } = await service.from("usuarios").select("id,perfil,status").eq("id", user.id).single();
  if (error || profile.status !== "ativo" || profile.perfil !== role) throw new Error("Perfil de seed inconsistente.");
  const { data: professional } = await service.from("profissionais").select("id").eq("usuario_id", user.id).maybeSingle();
  return { id: user.id, session, professionalId: professional?.id ?? null, created: !listed.data.users.some((candidate) => candidate.id === user.id) };
}

async function firstByMarker(service, table, field, value) {
  const { data, error } = await service.from(table).select("id").eq(field, value).maybeSingle();
  if (error) fail(`select ${table}`, error); return data?.id ?? null;
}

async function main() {
  const url = assertEnvironment();
  const service = createClient(url, required("SUPABASE_TEST_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
  await assertKanbanSchema(service);
  const provisioner = await authorizeQaProvisioner(service, required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_ANON_KEY"));
  qaFactors.push({ session: provisioner.session, factorId: provisioner.factorId });
  const bootstrap = await ensureIdentity(service, null, provisioner.id, { key: `${PREFIX}ADMIN`, name: "HOMOLOG_SEED_Admin", role: "administrador" });
  const admin = bootstrap.session;
  qaFactors.push({ session: admin, factorId: await elevateQaAdminToAal2(admin) });
  const fullSeed = phase === "full";
  const dentistA = fullSeed ? await ensureIdentity(service, admin, bootstrap.id, { key: `${PREFIX}DENTISTA_MARIANA`, name: "Dra. Mariana Souza", role: "dentista", cro: "HOMOLOG-CRO-1001" }) : null;
  const dentistB = fullSeed ? await ensureIdentity(service, admin, bootstrap.id, { key: `${PREFIX}DENTISTA_RAFAEL`, name: "Dr. Rafael Mendes", role: "dentista", cro: "HOMOLOG-CRO-1002" }) : null;
  const reception = fullSeed ? await ensureIdentity(service, admin, bootstrap.id, { key: `${PREFIX}RECEPCAO`, name: "Camila Recepção", role: "recepcao" }) : null;

  const patientNames = ["Ana Beatriz Lima", "Bruno Almeida", "Carla Mendes", "Daniel Ferreira", "Eduarda Souza", "Felipe Martins", "Gabriela Rocha", "Henrique Costa", "Isabela Santos", "João Victor Ramos", "Larissa Oliveira", "Marcos Pereira"];
  const patients = [];
  const patientLimit = phase === "a" ? 1 : phase === "b" ? 2 : patientNames.length;
  for (const [index, name] of patientNames.slice(0, patientLimit).entries()) {
    const marker = `${PREFIX}${name}`;
    let id = await firstByMarker(service, "pacientes", "nome", marker);
    if (!id) {
      // Alertas clínicos exigem uma sessão de dentista ativo; os demais
      // cadastros continuam no fluxo administrativo autorizado.
      const actor = fullSeed && index === 0 ? dentistA.session : admin;
      const created = await rpc(actor, "create_patient", { p_nome: marker, p_data_nascimento: `${1980 + index}-0${(index % 9) + 1}-15`, p_telefone_contato: `+55 00 90000-${String(1000 + index)}`, p_documento_identificacao: null, p_alergias: fullSeed && index === 0 ? "Alergia registrada para homologação" : null, p_intolerancias: null, p_medicamentos_em_uso: null });
      id = created.id;
    }
    patients.push(id);
  }

  const services = [["Consulta de avaliação", 12000], ["Profilaxia", 18000], ["Restauração em resina", 25000], ["Clareamento dental", 45000], ["Extração simples", 80000], ["Tratamento endodôntico", 120000]];
  const servicesForPhase = phase === "a" ? [] : phase === "b" ? services.slice(0, 1) : services;
  for (const [name, cents] of servicesForPhase) {
    if (!await firstByMarker(service, "servicos", "nome", `${PREFIX}${name}`)) await rpc(admin, "create_service", { p_nome: `${PREFIX}${name}`, p_descricao: "Serviço fictício de homologação.", p_categoria: "HOMOLOG_SEED", p_valor_padrao_centavos: cents });
  }

  const materialIds = [];
  if (fullSeed) {
  for (const [index, name] of ["Luvas nitrílicas", "Máscaras descartáveis", "Anestésico", "Agulha gengival", "Gaze", "Resina A2", "Resina A3", "Álcool 70%", "Sugador descartável", "Flúor"].entries()) {
    let id = await firstByMarker(service, "materiais_estoque", "nome", `${PREFIX}${name}`);
    if (!id) id = (await rpc(admin, "create_stock_material", { p_nome: `${PREFIX}${name}`, p_categoria: "HOMOLOG_SEED", p_unidade: "unidade", p_quantidade_inicial: index === 1 ? 5 : 50 + index * 10, p_estoque_minimo: index === 1 ? 10 : 15, p_validade: null, p_fornecedor: "Fornecedor Homologação", p_ativo: true })).id;
    materialIds.push(id);
  }
  for (const [index, materialId] of materialIds.slice(0, 3).entries()) {
    await rpc(admin, "set_stock_lot_control", { p_material_id: materialId, p_controla: true, p_codigo_lote_inicial: `${PREFIX}L${index + 1}`, p_data_validade: day(index === 2 ? -1 : index === 1 ? 15 : 120), p_data_fabricacao: day(-30), p_fornecedor: "Fornecedor Homologação" });
  }
  }

  const tasks = [
    ["Confirmar retorno de Ana Beatriz", "pendente", "urgente", -2], ["Solicitar documentação de Bruno", "pendente", "alta", 0], ["Conferir estoque para procedimento", "pendente", "media", 1], ["Revisar orçamento de Carla", "pendente", "baixa", 7],
    ["Confirmar agenda de amanhã", "em_andamento", "alta", 1], ["Preparar materiais do Dr. Rafael", "em_andamento", "media", 0], ["Conferir pagamentos pendentes", "em_andamento", "baixa", 2], ["Atualizar cadastro de paciente", "em_andamento", "alta", -1],
    ["Aguardar confirmação do paciente", "aguardando", "media", 3], ["Aguardar retorno do laboratório", "aguardando", "alta", 5], ["Aguardar aprovação de orçamento", "aguardando", "media", 4], ["Aguardar documento solicitado", "aguardando", "baixa", 1],
    ["Confirmar consulta de Gabriela", "concluida", "media", -2], ["Revisar agenda da semana", "concluida", "baixa", -3], ["Separar material esterilizado", "concluida", "alta", -1], ["Atualizar telefone de paciente", "concluida", "media", -2],
  ];
  const tasksForPhase = phase === "a" ? [] : phase === "b" ? [["Tarefa de validação", "pendente", "media", 1]] : tasks;
  const kanbanTailByStatus = new Map();
  for (const [index, [title, status, priority, due]] of tasksForPhase.entries()) {
    const marker = `${PREFIX}${title}`; let id = await firstByMarker(service, "tarefas", "titulo", marker);
    const responsibleId = fullSeed ? (index % 3 === 0 ? dentistA.id : index % 3 === 1 ? dentistB.id : reception.id) : bootstrap.id;
    if (!id) id = (await rpc(admin, "create_task", { p_titulo: marker, p_descricao: "Tarefa operacional fictícia de homologação.", p_prazo: day(due), p_responsavel_id: responsibleId, p_prioridade: priority, p_paciente_id: patients[index % patients.length], p_agendamento_id: null })).id;
    if (status !== "pendente") {
      const previousId = kanbanTailByStatus.get(status) ?? null;
      await rpc(admin, "move_task_kanban", { p_tarefa_id: id, p_status: status, p_before_id: previousId, p_after_id: null });
      kanbanTailByStatus.set(status, id);
    }
  }
  if (fullSeed) {
    const cancelled = `${PREFIX}Tarefa cancelada para histórico`; if (!await firstByMarker(service, "tarefas", "titulo", cancelled)) { const row = await rpc(admin, "create_task", { p_titulo: cancelled, p_descricao: null, p_prazo: day(1), p_responsavel_id: reception.id, p_prioridade: "baixa", p_paciente_id: patients[0], p_agendamento_id: null }); await rpc(admin, "set_task_status", { p_tarefa_id: row.id, p_status: "cancelada" }); }
  }

  const appointments = [];
  if (fullSeed) {
  for (let index = 0; index < 15; index += 1) { const dayOffset = [1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14][index]; const start = local(dayOffset, index % 2 ? 14 + (index % 3) : 8 + (index % 3)); const end = local(dayOffset, (index % 2 ? 14 + (index % 3) : 8 + (index % 3)) + 1); const note = `${PREFIX}Agenda ${index + 1}`; const existing = await firstByMarker(service, "agendamentos", "observacoes_administrativas", note); const id = existing ?? (await rpc(reception.session, "create_appointment", { p_paciente_id: patients[index % patients.length], p_profissional_id: index % 2 ? dentistA.professionalId : dentistB.professionalId, p_inicio_local: start, p_fim_local: end, p_observacoes_administrativas: note })).id; appointments.push(id); }
  const { data: appointmentStates, error: appointmentStatesError } = await service
    .from("agendamentos")
    .select("id,status")
    .in("id", [appointments[1], appointments[2]]);
  if (appointmentStatesError) fail("agendamentos status", appointmentStatesError);
  const appointmentStatus = new Map((appointmentStates ?? []).map((appointment) => [appointment.id, appointment.status]));
  if (appointmentStatus.get(appointments[1]) === "agendado") {
    await rpc(reception.session, "set_appointment_status", { p_agendamento_id: appointments[1], p_status: "confirmado" });
  }
  if (["agendado", "confirmado"].includes(appointmentStatus.get(appointments[2]))) {
    await rpc(reception.session, "set_appointment_status", { p_agendamento_id: appointments[2], p_status: "cancelado" });
  }

  const attendanceMarker = `${PREFIX}Atendimento para retorno`;
  let attendanceId = await firstByMarker(service, "atendimentos", "evolucao", attendanceMarker);
  if (!attendanceId) {
    const attendance = await rpc(dentistA.session, "create_direct_attendance", { p_paciente_id: patients[1] });
    attendanceId = attendance.id;
    await rpc(dentistA.session, "update_attendance", { p_atendimento_id: attendanceId, p_evolucao: attendanceMarker });
  }
  let returnId = await firstByMarker(service, "retornos", "observacao_administrativa", `${PREFIX}Retorno`);
  if (!returnId) {
    const created = await rpc(dentistA.session, "create_return", { p_atendimento_id: attendanceId, p_data_prevista: day(10), p_observacao_administrativa: `${PREFIX}Retorno` });
    returnId = created.id;
  }
  await rpc(reception.session, "link_return_appointment", { p_retorno_id: returnId, p_agendamento_id: appointments[1] });

  const budgetMarker = `${PREFIX}Orçamento avaliação`;
  let budgetId = await firstByMarker(service, "orcamentos", "observacao_administrativa", budgetMarker);
  if (!budgetId) {
    const budget = await rpc(admin, "create_budget", { p_paciente_id: patients[2], p_profissional_id: dentistA.professionalId, p_validade_em: day(30), p_observacao_administrativa: budgetMarker });
    budgetId = budget.id;
    await rpc(admin, "add_budget_item", { p_orcamento_id: budgetId, p_descricao: `${PREFIX}Avaliação`, p_quantidade: 1, p_valor_unitario_centavos: 12000 });
    await rpc(admin, "add_budget_item", { p_orcamento_id: budgetId, p_descricao: `${PREFIX}Profilaxia`, p_quantidade: 1, p_valor_unitario_centavos: 18000 });
    await rpc(admin, "set_budget_status", { p_orcamento_id: budgetId, p_status: "enviado" });
    await rpc(admin, "set_budget_status", { p_orcamento_id: budgetId, p_status: "aprovado" });
  }
  let receivableId = await firstByMarker(service, "financeiro_recebiveis", "observacao_administrativa", `${PREFIX}Recebível`);
  if (!receivableId) {
    const receivable = await rpc(admin, "create_financial_receivable", { p_paciente_id: patients[2], p_atendimento_id: null, p_orcamento_id: budgetId, p_valor_total_centavos: 30000, p_primeiro_vencimento: day(7), p_numero_parcelas: 2, p_intervalo_meses: 1, p_observacao_administrativa: `${PREFIX}Recebível` });
    receivableId = receivable.id;
    const { data: installments, error: installmentError } = await service.from("financeiro_parcelas").select("id").eq("recebivel_id", receivableId).order("numero_parcela").limit(1);
    if (installmentError || !installments?.[0]) fail("financeiro_parcelas", installmentError);
    await rpc(admin, "register_installment_payment", { p_parcela_id: installments[0].id, p_forma: "pix", p_data_pagamento: today, p_observacao_administrativa: `${PREFIX}Pagamento` });
  }

  const equipmentMarker = `${PREFIX}AUTOCLAVE-01`;
  let equipmentId = await firstByMarker(service, "equipamentos_esterilizacao", "identificacao", equipmentMarker);
  if (!equipmentId) {
    equipmentId = (await rpc(admin, "create_sterilization_equipment", { p_nome: `${PREFIX}Autoclave`, p_identificacao: equipmentMarker, p_modelo: "Modelo fictício", p_fabricante: "Fabricante de homologação", p_numero_serie: `${PREFIX}SERIE-01` })).id;
  }
  let cycleId = await firstByMarker(service, "ciclos_esterilizacao", "observacoes", `${PREFIX}Ciclo concluído`);
  if (!cycleId) {
    cycleId = (await rpc(reception.session, "start_sterilization_cycle", { p_equipamento_id: equipmentId, p_observacoes: `${PREFIX}Ciclo concluído` })).id;
    const packageCode = `${PREFIX}PACOTE-01`;
    if (!await firstByMarker(service, "pacotes_esterilizacao", "codigo", packageCode)) {
      await rpc(reception.session, "create_sterilization_package", { p_ciclo_id: cycleId, p_codigo: packageCode, p_descricao: `${PREFIX}Kit clínico`, p_validade_ate: day(90) });
    }
    await rpc(reception.session, "finish_sterilization_cycle", { p_ciclo_id: cycleId, p_status: "concluido", p_observacoes: `${PREFIX}Ciclo concluído` });
  }
  }

  console.log(JSON.stringify({ fase: phase, pacientes: patients.length, agendamentos: appointments.length, tarefas: tasksForPhase.length + (fullSeed ? 1 : 0), servicos: servicesForPhase.length, materiais: materialIds.length, retornos: fullSeed ? 1 : 0, orcamentos: fullSeed ? 1 : 0, recebiveis: fullSeed ? 1 : 0, equipamentos_esterilizacao: fullSeed ? 1 : 0, ciclos_esterilizacao: fullSeed ? 1 : 0, usuarios_seed: fullSeed ? 4 : 1 }, null, 2));
}

// O helper assume o fator durante a elevacao; esta lista assume somente os
// fatores devolvidos com sucesso. Cleanup tenta todos sem substituir a causa.
let seedError;
try {
  await main();
} catch (error) {
  seedError = error;
} finally {
  for (const { session, factorId } of qaFactors.reverse()) {
    try {
      const removed = await session.auth.mfa.unenroll({ factorId });
      if (removed.error) throw new Error("Falha ao remover fator temporario QA.");
    } catch {
      console.error("QA_MFA_CLEANUP_FAILED: falha ao remover fator desta execucao.");
      seedError ??= new Error("Falha ao remover fator temporario QA.");
    }
  }
}
if (seedError) { console.error(`SEED_HOMOLOGACAO_FALHOU: ${seedError.message}`); process.exitCode = 1; }
