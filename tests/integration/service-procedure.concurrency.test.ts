import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQaAdmin, createQaUser } from "./helpers";

const url = process.env.SUPABASE_TEST_URL ?? "";
const dbUrl = process.env.SUPABASE_TEST_DB_URL ?? "";
const local = (value: string) => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname); } catch { return false; } };
const prefix = "QA_F01_" + randomUUID();
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

describe.skipIf(!local(url) || !local(dbUrl)).sequential("F01: criacao e finalizacao concorrentes sem retry", () => {
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


  async function fixture() {
    const materials = [];
    for (let i = 0; i < 3; i++) materials.push((await rpc(admin, "create_stock_material", { p_nome: prefix, p_categoria: "QA", p_unidade: "unidade", p_quantidade_inicial: 10, p_estoque_minimo: 0 })).id as string);
    materials.sort();
    const catalog = (await rpc(admin, "create_service", { p_nome: prefix })).id as string;
    // Heap/configuracao em B,A: o INSERT original podia adquirir FKs na ordem inversa.
    const composition: Record<string, string> = {};
    for (const id of materials.slice(0, 2).reverse()) composition[id] = (await rpc(admin, "configure_service_material", { p_servico_id: catalog, p_material_id: id, p_quantidade_padrao: 2 })).id;
    const x = (await rpc(dentist, "create_direct_attendance", { p_paciente_id: patient })).id as string;
    const y = (await rpc(dentist, "create_direct_attendance", { p_paciente_id: patient })).id as string;
    const procedure = (await rpc(dentist, "create_service_procedure", { p_atendimento_id: x, p_servico_id: catalog })).id as string;
    return { materials, catalog, composition, x, y, procedure };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const create = (f: Fixture) => t2.query("select id from public.create_service_procedure($1,$2)", [f.y, f.catalog]);
  const finalize = (f: Fixture) => t1.query("select status from public.finalize_attendance($1,$2)", [f.x, prefix]);
  async function predictions(attendance: string) {
    return (await observer.query(`select c.material_id, c.quantidade_por_servico, c.quantidade_total
      from public.procedimento_materiais_consumo c join public.procedimentos p on p.id=c.procedimento_id
      where p.atendimento_id=$1 order by c.material_id`, [attendance])).rows;
  }
  async function invisible(f: Fixture) {
    expect((await observer.query("select count(*)::int n from public.procedimentos where atendimento_id=$1", [f.y])).rows[0].n).toBe(0);
    expect((await observer.query("select status from public.atendimentos where id=$1", [f.x])).rows[0].status).toBe("em_andamento");
  }
  async function invariant(f: Fixture, createdId: string) {
    expect(await predictions(f.y)).toEqual(f.materials.slice(0, 2).map(material_id => ({ material_id, quantidade_por_servico: 2, quantidade_total: 2 })));
    expect((await observer.query("select id from public.procedimentos where atendimento_id=$1", [f.y])).rows).toEqual([{ id: createdId }]);
    expect((await observer.query("select id,status from public.atendimentos where id=any($1::uuid[]) order by id", [[f.x, f.y]])).rows).toEqual([{ id: f.x, status: "finalizado" }, { id: f.y, status: "em_andamento" }].sort((a, b) => a.id.localeCompare(b.id)));
    const rows = (await observer.query(`select m.id, m.quantidade_atual,
      (select count(*)::int from public.consumos_clinicos_materiais c where c.material_id=m.id and c.procedimento_id=$2 and c.quantidade=2 and c.estornado_em is null) consumed,
      (select count(*)::int from public.movimentacoes_estoque e join public.consumos_clinicos_materiais c on c.movimentacao_estoque_id=e.id
        where e.material_id=m.id and e.procedimento_id=$2 and e.atendimento_id=$3 and e.quantidade=c.quantidade and e.procedimento_material_consumo_id=c.procedimento_material_consumo_id) traced
      from public.materiais_estoque m where m.id=any($1::uuid[]) order by m.id`, [f.materials.slice(0, 2), f.procedure, f.x])).rows;
    expect(rows).toEqual(f.materials.slice(0, 2).map(id => ({ id, quantidade_atual: 8, consumed: 1, traced: 1 })));
    expect((await observer.query("select count(*)::int n from public.consumos_clinicos_materiais where procedimento_id=$1", [createdId])).rows[0].n).toBe(0);
    for (const id of f.materials) await observer.query("select public.assert_lot_stock_balance($1)", [id]);
  }

  for (const first of ["finalize", "create"] as const) {
    it.each(Array.from({ length: 50 }, (_, i) => i + 1))(`${first} primeiro: iteracao %i`, async () => {
      const f = await fixture();
      await begin(t1, dentistId); await begin(t2, dentistId);
      try {
        // Estabiliza o plano adversarial do legado: composicoes cadastradas B,A.
        await t2.query("set local enable_indexscan=off; set local enable_bitmapscan=off");
        if (first === "finalize") {
          // Checkpoint no primeiro material, respeitando todos os locks anteriores.
          await t1.query("reset role");
          await t1.query("select id from public.atendimentos where id=$1 for update", [f.x]);
          await t1.query("select id from public.procedimentos where atendimento_id=$1 order by id for update", [f.x]);
          await t1.query("select id from public.materiais_estoque where id=$1 for update", [f.materials[0]]);
          await t1.query("set local role authenticated");
          const pending = create(f).then(value => ({ value, error: null }), error => ({ value: null, error }));
          await blocked(pid2, pid1); await invisible(f);
          expect((await finalize(f)).rows[0].status).toBe("finalizado");
          await t1.query("commit");
          const result = await pending; expect(result.error).toBeNull(); await t2.query("commit");
          await invariant(f, result.value!.rows[0].id);
        } else {
          // Observador segura B: criacao deve possuir KEY SHARE em A antes de esperar B.
          await observer.query("begin");
          await observer.query("select id from public.materiais_estoque where id=$1 for update", [f.materials[1]]);
          const observerPid = (await observer.query("select pg_backend_pid() pid")).rows[0].pid;
          const creating = create(f).then(value => ({ value, error: null }), error => ({ value: null, error }));
          await blocked(pid2, observerPid);
          const finishing = finalize(f).then(value => ({ value, error: null }), error => ({ value: null, error }));
          await blocked(pid1, pid2); await invisible(f);
          await observer.query("commit");
          const result = await creating; expect(result.error).toBeNull(); await t2.query("commit");
          const finished = await finishing; expect(finished.error).toBeNull(); expect(finished.value!.rows[0].status).toBe("finalizado");
          await t1.query("commit"); await invariant(f, result.value!.rows[0].id);
        }
      } finally { await observer.query("rollback"); await t1.query("rollback"); await t2.query("rollback"); }
    });
  }

  for (const first of ["create", "configure"] as const) {
    it.each(["add", "quantity", "active"] as const)(`composicao estavel: ${first} primeiro, %s`, async operation => {
      const f = await fixture();
      await begin(t1, adminId); await begin(t2, dentistId);
      const configure = () => operation === "active"
        ? t1.query("select public.set_service_material_active($1,false)", [f.composition[f.materials[0]]])
        : t1.query("select public.configure_service_material($1,$2,$3)", [f.catalog, f.materials[operation === "add" ? 2 : 0], 3]);
      const expected = f.materials.slice(0, 2).map(material_id => ({ material_id, quantidade_por_servico: 2, quantidade_total: 2 }));
      try {
        if (first === "create") {
          // Pausa antes de formar o conjunto, segurando o mesmo lock SHARE da RPC.
          await t2.query("reset role");
          await t2.query("select id from public.atendimentos where id=$1 for update", [f.y]);
          await t2.query("select id from public.servicos where id=$1 for share", [f.catalog]);
          await t2.query("set local role authenticated");
          const pending = configure().then(() => null, error => error);
          await blocked(pid1, pid2); await create(f); await t2.query("commit");
          expect(await pending).toBeNull(); await t1.query("commit");
        } else {
          await configure();
          const pending = create(f).then(() => null, error => error);
          await blocked(pid2, pid1); await t1.query("commit");
          expect(await pending).toBeNull(); await t2.query("commit");
          if (operation === "add") expected.push({ material_id: f.materials[2], quantidade_por_servico: 3, quantidade_total: 3 });
          else if (operation === "active") expected.shift();
          else { expected[0].quantidade_por_servico = 3; expected[0].quantidade_total = 3; }
        }
        expect(await predictions(f.y)).toEqual(expected);
      } finally { await t1.query("rollback"); await t2.query("rollback"); }
    });
  }
});
