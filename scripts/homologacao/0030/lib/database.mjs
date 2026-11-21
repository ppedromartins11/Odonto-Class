import { Client } from "pg";

export async function withReadOnlyDatabase(connectionString, action) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000, application_name: "odonto-homologation-0030-readonly" });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const result = await action(client);
    await client.query("ROLLBACK");
    return result;
  } catch {
    try { await client.query("ROLLBACK"); } catch { /* connection may already be closed */ }
    throw new Error("Consulta read-only ao banco QA falhou; detalhes de conexão ocultos.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function readDatabasePreflight(client) {
  const migrationResult = await client.query(
    "select version::text as version from supabase_migrations.schema_migrations where version::text in ('0030', '0031')",
  );
  const authOrphans = await client.query(
    "select count(*)::integer as count from auth.users a left join public.usuarios u on u.id = a.id where u.id is null",
  );
  const profileOrphans = await client.query(
    "select count(*)::integer as count from public.usuarios u left join auth.users a on a.id = u.id where a.id is null",
  );
  return {
    migration0030: migrationResult.rows.some((row) => row.version === "0030") ? "APPLIED" : "ABSENT",
    migration0031: migrationResult.rows.some((row) => row.version === "0031") ? "APPLIED" : "ABSENT",
    authWithoutProfile: authOrphans.rows[0]?.count ?? null,
    profileWithoutAuth: profileOrphans.rows[0]?.count ?? null,
  };
}

export async function readFixtureRows(client, fixtureNames, configuredEmails = {}) {
  const result = await client.query(
    `select u.id, u.nome, u.perfil::text as perfil, u.status::text as status,
            a.email, a.email_confirmed_at, a.raw_user_meta_data, a.raw_app_meta_data
       from public.usuarios u join auth.users a on a.id = u.id
      where u.nome = any($1::text[])
         or u.nome ~ any($2::text[])
         or (u.nome ~ '^QA_' and u.perfil::text = 'administrador' and u.status::text = 'ativo')
         or lower(a.email) = any($3::text[])
      order by u.created_at asc`,
    [fixtureNames, fixtureNames.map((name) => `^${name}`), Object.values(configuredEmails).filter(Boolean).map((email) => email.toLowerCase())],
  );
  return result.rows;
}
