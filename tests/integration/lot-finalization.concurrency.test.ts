import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin, createQaUser } from "./helpers";

const url = process.env.SUPABASE_TEST_URL ?? "";
const dbUrl = process.env.SUPABASE_TEST_DB_URL ?? "";
const local = (value: string) => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname); } catch { return false; } };
const prefix = "QA_R01_" + randomUUID();
const users: string[] = [];
let observer: Client, t1: Client, t2: Client;
let service: SupabaseClient, admin: SupabaseClient, dentist: SupabaseClient;
let adminId: string, dentistId: string, patient: string, pid1: number, pid2: number;
async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const r = await client.rpc(name, args); expect(r.error, name).toBeNull(); return r.data;
}
async function begin(client: Client, actor: string) {
  await client.query("begin");
  await client.query("set local lock_timeout='5s'");
  await client.query("set local statement_timeout='8s'");
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role: "authenticated", aal: "aal2" })]);
  await client.query("set local role authenticated");
}
// Nao usa sleep como prova nem retry: observa dependencia real no PostgreSQL.
async function blocked(waiter: number, blocker: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const r = await observer.query("select $2::int = any(pg_blocking_pids($1::int)) blocked", [waiter, blocker]);
    if (r.rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Checkpoint de lock nao observado em 3s.");
}
async function fixture() {
  const material = await rpc(admin, "create_stock_material", { p_nome: prefix, p_categoria: "QA", p_unidade: "unidade", p_quantidade_inicial: 10, p_estoque_minimo: 0 });
  const catalog = await rpc(admin, "create_service", { p_nome: prefix });
  await rpc(admin, "configure_service_material", { p_servico_id: catalog.id, p_material_id: material.id, p_quantidade_padrao: 2 });
  const attendance = await rpc(dentist, "create_direct_attendance", { p_paciente_id: patient });
  const procedure = await rpc(dentist, "create_service_procedure", { p_atendimento_id: attendance.id, p_servico_id: catalog.id });
  const snapshot = (await observer.query("select id from public.procedimento_materiais_consumo where procedimento_id=$1", [procedure.id])).rows[0];
  return { material: material.id as string, attendance: attendance.id as string, procedure: procedure.id as string, snapshot: snapshot.id as string };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const finalize = (client: Client, f: Fixture) => client.query("select (public.finalize_attendance($1,$2)).status", [f.attendance, prefix]);
const activate = (client: Client, f: Fixture) => client.query("select public.set_stock_lot_control($1,true,$2,'2099-01-01')", [f.material, prefix]);
const consume = (f: Fixture, quantity: number) => rpc(dentist, "record_clinical_material_consumption", { p_procedimento_id: f.procedure, p_material_id: f.material, p_lote_id: null, p_quantidade: quantity, p_procedimento_material_consumo_id: f.snapshot });
async function invariants(f: Fixture, finished: boolean, controlled = true) {
  const r = (await observer.query(`select a.status, m.quantidade_atual, m.controla_lote_validade,
    (select coalesce(sum(l.quantidade_atual),0)::int from public.materiais_lotes l where l.material_id=m.id) lots,
    (select coalesce(sum(c.quantidade),0)::int from public.consumos_clinicos_materiais c where c.procedimento_id=$3 and c.estornado_em is null) consumed,
    (select coalesce(sum(case when e.tipo='saida' then e.quantidade else -e.quantidade end),0)::int from public.movimentacoes_estoque e where e.procedimento_id=$3) deducted,
    (select count(*)::int from public.consumos_clinicos_materiais c
      join public.movimentacoes_estoque e on e.id=c.movimentacao_estoque_id
      where c.procedimento_id=$3 and c.estornado_em is null and e.material_id=c.material_id
      and e.procedimento_id=c.procedimento_id and e.atendimento_id=a.id
      and e.procedimento_material_consumo_id=$4 and e.quantidade=c.quantidade) traced
    from public.atendimentos a cross join public.materiais_estoque m where a.id=$1 and m.id=$2`, [f.attendance, f.material, f.procedure, f.snapshot])).rows[0];
  expect(r).toMatchObject({ status: finished ? "finalizado" : "em_andamento", quantidade_atual: finished ? 8 : 10,
    controla_lote_validade: controlled, lots: controlled ? (finished ? 8 : 10) : 0,
    consumed: finished ? 2 : 0, deducted: finished ? 2 : 0 });
  expect(r.traced).toBe(finished ? 1 : 0);
  await observer.query("select public.assert_lot_stock_balance($1)", [f.material]);
}

describe.skipIf(!local(url) || !local(dbUrl)).sequential("R01: duas conexoes PostgreSQL reais, sem retries", () => {
  beforeAll(async () => {
    expect(process.env.SUPABASE_TEST_HOMOLOGATION).toBe("I_ACKNOWLEDGE_FAKE_DATA_ONLY");
    observer = new Client({ connectionString: dbUrl }); t1 = new Client({ connectionString: dbUrl }); t2 = new Client({ connectionString: dbUrl });
    await Promise.all([observer.connect(), t1.connect(), t2.connect()]);
    pid1 = (await t1.query("select pg_backend_pid() pid")).rows[0].pid;
    pid2 = (await t2.query("select pg_backend_pid() pid")).rows[0].pid;
    expect(pid1).not.toBe(pid2);
    service = createClient(url, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const qa = await createQaAdmin(service, url, process.env.SUPABASE_TEST_ANON_KEY!);
    admin = qa.session; adminId = qa.identity.id; users.push(adminId);
    const credentials = { email: prefix.toLowerCase() + "@example.test", password: "QA-a9!" + randomUUID() };
    const created = await createQaUser(service, { ...credentials, user_metadata: { nome: prefix, perfil: "dentista" } });
    expect(created.error).toBeNull(); dentistId = created.data.user!.id; users.push(dentistId);
    dentist = createClient(url, process.env.SUPABASE_TEST_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await dentist.auth.signInWithPassword(credentials)).error).toBeNull();
    patient = (await rpc(admin, "create_patient", { p_nome: prefix })).id;
  });
  afterAll(async () => {
    for (const client of [t1, t2]) if (client) { await client.query("rollback"); await client.end(); }
    if (!observer) return;
    try {
      await observer.query("begin");
      await observer.query("delete from public.paciente_alertas_clinicos where paciente_id in (select id from public.pacientes where created_by=any($1::uuid[]))", [users]);
      for (const table of ["consumos_clinicos_materiais", "movimentacoes_lotes", "movimentacoes_estoque", "procedimento_materiais_consumo", "procedimentos", "atendimentos", "servico_materiais", "servicos", "materiais_lotes", "materiais_estoque", "pacientes"]) {
        await observer.query("delete from public." + table + " where created_by=any($1::uuid[])", [users]);
      }
      await observer.query("delete from public.auditoria where usuario_id=any($1::uuid[]) or entidade_id=any($1::uuid[])", [users]);
      await observer.query("delete from public.profissionais where usuario_id=any($1::uuid[])", [users]);
      await observer.query("delete from public.usuarios where id=any($1::uuid[])", [users]);
      await observer.query("commit");
      for (const id of users) expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
      expect((await observer.query("select count(*)::int n from auth.users where id=any($1::uuid[])", [users])).rows[0].n).toBe(0);
    } catch (error) { await observer.query("rollback"); throw error; }
    finally { await observer.end(); }
  });

  for (const first of ["finalize", "activate"] as const) {
    it.each(Array.from({ length: 25 }, (_, i) => i + 1))(`${first} primeiro: iteracao %i`, async () => {
      const f = await fixture();
      await begin(t1, dentistId); await begin(t2, adminId);
      try {
        if (first === "finalize") {
          expect((await finalize(t1, f)).rows[0].status).toBe("finalizado");
          const pending = activate(t2, f).then(() => null, error => error);
          await blocked(pid2, pid1);
          await t1.query("commit");
          expect(await pending).toBeNull(); await t2.query("commit");
          await invariants(f, true);
        } else {
          await activate(t2, f);
          const pending = finalize(t1, f).then(() => null, error => error);
          await blocked(pid1, pid2);
          await t2.query("commit");
          expect(await pending).toMatchObject({ code: "P0001", message: "LOT_CONTROLLED_CLINICAL_CONSUMPTION_PENDING" });
          await t1.query("rollback");
          await invariants(f, false);
        }
      } finally { await t1.query("rollback"); await t2.query("rollback"); }
    });
  }
  for (const first of ["clinical", "activate"] as const) {
    it.each(["consume", "reverse"] as const)(`H06: ${first} primeiro contra %s`, async operation => {
      const f = await fixture();
      const consumed = operation === "reverse" ? await consume(f, 2) : null;
      const clinical = () => operation === "consume"
        ? t1.query("select public.record_clinical_material_consumption($1,$2,null,2,$3)", [f.procedure, f.material, f.snapshot])
        : t1.query("select public.reverse_clinical_material_consumption($1)", [consumed.id]);
      await begin(t1, dentistId); await begin(t2, adminId);
      try {
        if (first === "clinical") {
          await clinical();
          const pending = activate(t2, f).then(() => null, error => error);
          await blocked(pid2, pid1); await t1.query("commit");
          const error = await pending;
          if (operation === "consume") {
            expect(error).toMatchObject({ code: "23514", message: "LOT_CONTROL_PENDING_REVERSIBLE_CONSUMPTION" });
            await t2.query("rollback");
          } else { expect(error).toBeNull(); await t2.query("commit"); }
        } else {
          await t2.query("reset role");
          await t2.query("select id from public.materiais_estoque where id=$1 for update", [f.material]);
          await t2.query("set local role authenticated");
          const pending = clinical().then(() => null, error => error);
          await blocked(pid1, pid2);
          if (operation === "reverse") {
            await expect(activate(t2, f)).rejects.toMatchObject({ code: "23514", message: "LOT_CONTROL_PENDING_REVERSIBLE_CONSUMPTION" });
            await t2.query("rollback");
            expect(await pending).toBeNull(); await t1.query("commit");
          } else {
            await activate(t2, f); await t2.query("commit");
            expect(await pending).toMatchObject({ code: "23514" }); await t1.query("rollback");
          }
        }
        const controlled = (first === "clinical" && operation === "reverse") || (first === "activate" && operation === "consume");
        const activeConsumption = first === "clinical" && operation === "consume";
        expect((await observer.query(`select m.quantidade_atual,m.controla_lote_validade,
          (select coalesce(sum(quantidade_atual),0)::int from public.materiais_lotes where material_id=m.id) lots,
          (select count(*)::int from public.consumos_clinicos_materiais where procedimento_id=$2 and estornado_em is null) active
          from public.materiais_estoque m where id=$1`, [f.material, f.procedure])).rows[0]).toEqual({ quantidade_atual: activeConsumption ? 8 : 10, controla_lote_validade: controlled, lots: controlled ? 10 : 0, active: activeConsumption ? 1 : 0 });
        await observer.query("select public.assert_lot_stock_balance($1)", [f.material]);
      } finally { await t1.query("rollback"); await t2.query("rollback"); }
    });
  }
  it("consumo manual integral nao recebe segunda baixa automatica", async () => {
    const f = await fixture(); await consume(f, 2);
    await rpc(dentist, "finalize_attendance", { p_atendimento_id: f.attendance, p_evolucao: prefix });
    await invariants(f, true, false);
  });
  it("consumo parcial recebe somente baixa residual com rastreabilidade", async () => {
    const f = await fixture(); await consume(f, 1);
    await rpc(dentist, "finalize_attendance", { p_atendimento_id: f.attendance, p_evolucao: prefix });
    const rows = (await observer.query("select c.quantidade, e.quantidade baixa from public.consumos_clinicos_materiais c join public.movimentacoes_estoque e on e.id=c.movimentacao_estoque_id where c.procedimento_id=$1", [f.procedure])).rows;
    expect(rows).toEqual([{ quantidade: 1, baixa: 1 }, { quantidade: 1, baixa: 1 }]);
    expect((await observer.query("select quantidade_atual from public.materiais_estoque where id=$1", [f.material])).rows[0].quantidade_atual).toBe(8);
  });
  it("saldo igual nao permite usar consumo legado sem lote como rastreabilidade", async () => {
    const f = await fixture(); await consume(f, 2);
    await rpc(dentist, "finalize_attendance", { p_atendimento_id: f.attendance, p_evolucao: prefix });
    await rpc(admin, "set_stock_lot_control", { p_material_id: f.material, p_controla: true, p_codigo_lote_inicial: prefix, p_data_validade: "2099-01-01" });
    // Corrupcao historica simulada apenas no laboratorio descartavel.
    await observer.query("update public.atendimentos set status='em_andamento',finalizado_em=null where id=$1", [f.attendance]);
    const denied = await dentist.rpc("finalize_attendance", { p_atendimento_id: f.attendance, p_evolucao: prefix });
    expect(denied.error?.message).toBe("LOT_CONTROLLED_CLINICAL_CONSUMPTION_PENDING");
    expect((await observer.query("select status from public.atendimentos where id=$1", [f.attendance])).rows[0].status).toBe("em_andamento");
    expect((await observer.query("select quantidade_atual,(select sum(quantidade_atual)::int from public.materiais_lotes where material_id=$1) lots from public.materiais_estoque where id=$1", [f.material])).rows[0]).toEqual({ quantidade_atual: 8, lots: 8 });
    expect((await observer.query("select count(*)::int n from public.consumos_clinicos_materiais where procedimento_id=$1", [f.procedure])).rows[0].n).toBe(1);
  });
  it("duas finalizacoes com materiais compartilhados respeitam ordem de ID", async () => {
    const first = await fixture(), second = await fixture();
    // Reutiliza as composicoes QA para que cada atendimento tenha os mesmos
    // dois materiais, cadastrados em ordens opostas.
    for (const [target, source] of [[first, second], [second, first]]) {
      await observer.query(`insert into public.procedimento_materiais_consumo
        (procedimento_id,servico_material_id,material_id,quantidade_por_servico,quantidade_total,created_by)
        select $1,servico_material_id,material_id,2,2,$2 from public.procedimento_materiais_consumo where id=$3`, [target.procedure, dentistId, source.snapshot]);
    }
    await begin(t1, dentistId); await begin(t2, dentistId);
    try {
      await t1.query("reset role");
      await t1.query("select id from public.atendimentos where id=$1 for update", [first.attendance]);
      await t1.query("select id from public.materiais_estoque where id=$1 for update", [[first.material, second.material].sort()[0]]);
      await t1.query("set local role authenticated");
      const pending = finalize(t2, second).then(result => ({ result, error: null }), error => ({ result: null, error }));
      await blocked(pid2, pid1);
      expect((await finalize(t1, first)).rows[0].status).toBe("finalizado");
      await t1.query("commit");
      const completed = await pending; expect(completed.error).toBeNull();
      expect(completed.result?.rows[0].status).toBe("finalizado");
      await t2.query("commit");
      expect((await observer.query("select quantidade_atual from public.materiais_estoque where id=any($1::uuid[])", [[first.material, second.material]])).rows).toEqual([{ quantidade_atual: 6 }, { quantidade_atual: 6 }]);
      expect((await observer.query("select count(*)::int n,sum(quantidade)::int quantity from public.consumos_clinicos_materiais where procedimento_id=any($1::uuid[])", [[first.procedure, second.procedure]])).rows[0]).toEqual({ n: 4, quantity: 8 });
    } finally { await t1.query("rollback"); await t2.query("rollback"); }
  });
  it.each(["consume", "reverse", "edit", "service", "teeth", "link"])("finalizacao versus %s nao inverte atendimento/procedimento", async operation => {
    const f = await fixture();
    const consumed = operation === "reverse" ? await consume(f, 2) : null;
    await begin(t1, dentistId); await begin(t2, dentistId);
    try {
      // Pausa T1 no primeiro lock real da finalizacao. T2 deve esperar SEM
      // possuir procedimento/consumo que as FKs de T1 precisem bloquear.
      await t1.query("reset role"); // somente o checkpoint da fixture local
      await t1.query("select id from public.atendimentos where id=$1 for update", [f.attendance]);
      await t1.query("set local role authenticated");
      const commands: Record<string, [string, unknown[]]> = {
        consume: ["select public.record_clinical_material_consumption($1,$2,null,2,$3)", [f.procedure, f.material, f.snapshot]],
        reverse: ["select public.reverse_clinical_material_consumption($1)", [consumed?.id]],
        edit: ["select public.update_procedure($1,$2)", [f.procedure, prefix]],
        service: ["select public.update_service_procedure($1,1,0,null)", [f.procedure]],
        teeth: ["select public.set_procedure_teeth($1,array[11]::smallint[])", [f.procedure]],
        link: ["select public.link_procedure_to_treatment_plan_item($1,$2)", [f.procedure, randomUUID()]],
      };
      const [query, values] = commands[operation];
      const pending = t2.query(query, values).then(() => null, error => error);
      await blocked(pid2, pid1);
      expect((await finalize(t1, f)).rows[0].status).toBe("finalizado");
      await t1.query("commit");
      const error = await pending;
      expect(["42501", "23514"]).toContain(error?.code);
      await t2.query("rollback");
      await invariants(f, true, false);
    } finally { await t1.query("rollback"); await t2.query("rollback"); }
  });
});
