import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { sourceConfig, authProjection, childEnvironment, WRAPPER, FIELDS, parseCredential, validateProbe, extraDataTables, AUTH_JSON_POLICY, PROBE, PROBE_INSIDE, AUTH_TRIGGER_BINDING_SQL, validateAuthTriggerBindings } from '../recovery-database-backup.mjs';

test('official pinned configuration lists preserve Auth and Storage data but omit their schema', async () => {
  const config = await sourceConfig();
  assert.equal(config.schema.split('|').length, 29);
  assert.equal(config.data.split('|').length, 22);
  assert.ok(config.schema.split('|').includes('auth'));
  assert.ok(config.schema.split('|').includes('storage'));
  assert.ok(!config.data.split('|').includes('auth'));
  assert.ok(!config.data.split('|').includes('storage'));
  assert.ok(config.roles.includes('supabase_.*'));
});

test('Auth projection blanks reviewed temporary tokens and retains password hash', () => {
  const result = authProjection([{name:'id',type:'uuid',generated:'NEVER'}, {name:'encrypted_password',type:'character varying',generated:'NEVER'}, {name:'confirmation_token',type:'character varying',generated:'NEVER'}, {name:'recovery_token',type:'text',generated:'NEVER'}, {name:'confirmed_at',type:'timestamp with time zone',generated:'ALWAYS'}]);
  assert.deepEqual(result.scrubbed,['confirmation_token','recovery_token']);
  assert.match(result.projected,/"encrypted_password"/);
  assert.match(result.projected,/''::text AS "recovery_token"/);
  assert.ok(!result.projected.includes('confirmed_at'));
  assert.ok(!result.columns.includes('confirmed_at'));
  assert.throws(()=>authProjection([{name:'new_provider_secret',type:'text',generated:'NEVER'}]),/ACTION_REQUIRED: AUTH_BACKUP_STRATEGY/);
  assert.throws(()=>authProjection([{name:'recovery_token',type:'bytea',generated:'NEVER'}]),/ACTION_REQUIRED: AUTH_BACKUP_STRATEGY/);
  assert.throws(()=>authProjection([{name:'id',type:'uuid',generated:'UNKNOWN'}]),/UNREVIEWED_AUTH_GENERATED_COLUMN_METADATA/);
});

test('Auth JSON uses explicit identity/provider allowlists and rejects unreviewed JSON', () => {
  const users=authProjection(['raw_user_meta_data','raw_app_meta_data'].map((name)=>({name,type:'jsonb',generated:'NEVER'})));
  assert.match(users.projected,/'\{\}'::jsonb AS "raw_user_meta_data"/);
  assert.match(users.projected,/k='provider'/);
  assert.match(users.projected,/jsonb_array_elements/);
  assert.ok(!users.projected.includes('provisioning_token'));
  const identities=authProjection([{name:'identity_data',type:'jsonb',generated:'NEVER'},{name:'email',type:'text',generated:'ALWAYS'}],'identities');
  assert.deepEqual(identities.jsonPolicy,AUTH_JSON_POLICY.identities);
  assert.ok(!identities.columns.includes('email'));
  assert.ok(!identities.projected.includes("'iss'"));
  assert.ok(!identities.projected.includes('access_token'));
  assert.throws(()=>authProjection([{name:'future_metadata',type:'jsonb',generated:'NEVER'}]),/AUTH_BACKUP_STRATEGY/);
  assert.throws(()=>authProjection([{name:'identity_data',type:'json',generated:'NEVER'}],'identities'),/AUTH_BACKUP_STRATEGY/);
});

test('accepted target is exclusively the Production session pooler on port 5432', () => {
  const good='postgresql://postgres.sqouddqzpmkofenyufuj:fictional-password@aws-0-fictional.pooler.supabase.com:5432/postgres';
  const parsed=parseCredential(good);
  assert.equal(parsed.PGPORT,'5432');
  for (const value of [good.replace(':5432',':6543'),good.replace('sqouddqzpmkofenyufuj','zxvpyxvhymuibaxgxetf'),good.replace('sqouddqzpmkofenyufuj','qprzxkolbbnqfopamfhj'),good.replace('aws-0-fictional.pooler.supabase.com','evil.example'), 'postgresql://postgres:fictional-password@db.sqouddqzpmkofenyufuj.supabase.co/postgres']) assert.throws(()=>parseCredential(value),/PRODUCTION_SESSION_POOLER_TARGET_MISMATCH/);
});

test('backend ssl false is accepted only with proven endpoint TLS and exact approved migration state', () => {
  const versions=Array.from({length:33},(_,i)=>String(i+1).padStart(4,'0'));
  const probe={database:'postgres',server:'17.6',clientTls:true,readOnly:'on',tls:false,migrations:versions.slice(0,31)};
  assert.doesNotThrow(()=>validateProbe(probe,versions));
  assert.throws(()=>validateProbe({...probe,clientTls:false},versions),/PRODUCTION_PROBE_MISMATCH/);
  assert.throws(()=>validateProbe({...probe,tls:null},versions),/BACKEND_TLS_EVIDENCE_MISSING/);
  assert.throws(()=>validateProbe({...probe,server:'17.7'},versions),/PRODUCTION_PROBE_MISMATCH/);
  assert.throws(()=>validateProbe({...probe,readOnly:'off'},versions),/PRODUCTION_PROBE_MISMATCH/);
  assert.throws(()=>validateProbe(probe,versions.slice(0,32)),/PENDING_MIGRATION_STATE_MISMATCH/);
  assert.throws(()=>validateProbe({...probe,migrations:versions.slice(0,32)},versions),/MIGRATION_STATE_MISMATCH/);
  assert.equal((PROBE.match(/\\conninfo/g)||[]).length,1);
  assert.equal((PROBE_INSIDE.match(/psql -X/g)||[]).length,1);
  assert.match(PROBE_INSIDE,/CLIENT_TLS=/);
});

test('auxiliary data preflight includes potential queue/S3 credentials while excluding approved data', async () => {
  const config=await sourceConfig();
  const dataTables=[['public','pacientes'],['auth','sessions'],['storage','objects'],['storage','buckets'],['storage','migrations'],['storage','s3_credentials'],['net','http_request_queue'],['cron','job'],['supabase_migrations','schema_migrations']].map(([schema,name])=>({schema,name}));
  assert.deepEqual(extraDataTables({dataTables},config).map((v)=>`${v.schema}.${v.name}`),['storage.s3_credentials','net.http_request_queue','cron.job']);
});

test('supplemental Auth binding requires the same trigger and function snapshot with public zero-arg functions', () => {
  const triggers=[['on_auth_user_created','INSERT','handle_new_auth_user'],['on_auth_user_email_updated','UPDATE OF email','sync_auth_user_email']].map(([name,event,functionName])=>({schema:'auth',table:'users',name,enabled:'O',definition:`CREATE TRIGGER ${name} AFTER ${event} ON auth.users FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,functionSchema:'public',functionName,functionArgs:'',functionDefinitionHash:'a'.repeat(32)}));
  const source={triggers:triggers.map(({schema,table,name,enabled,definition})=>({schema,table,name,enabled,definition})),functions:triggers.map((t)=>({name:t.functionName,args:'',definitionHash:t.functionDefinitionHash}))};
  const current={totalUserTriggers:2,triggers};
  assert.equal(validateAuthTriggerBindings(source,current).length,2);
  for (const patch of [{functionSchema:'other'},{functionName:'other'},{functionArgs:'text'},{functionDefinitionHash:'b'.repeat(32)},{enabled:'D'},{definition:triggers[0].definition.replace('INSERT','DELETE')}]) assert.throws(()=>validateAuthTriggerBindings(source,{...current,triggers:[{...triggers[0],...patch},triggers[1]]}),/AUTH_TRIGGER_BINDING_MISMATCH/);
  assert.throws(()=>validateAuthTriggerBindings(source,{...current,totalUserTriggers:3}),/AUTH_TRIGGER_BINDING_MISMATCH/);
  assert.throws(()=>validateAuthTriggerBindings(source,{...current,triggers:[triggers[0],triggers[0]]}),/AUTH_TRIGGER_BINDING_MISMATCH/);
  assert.match(AUTH_TRIGGER_BINDING_SQL,/p\.oid=t\.tgfoid/);
  assert.ok(!AUTH_TRIGGER_BINDING_SQL.includes('INSERT INTO'));
});

test('Docker CLI environment cannot inherit application credentials or remote daemon overrides', () => {
  const env = childEnvironment();
  assert.ok(!Object.hasOwn(env,'PRODUCTION_DB_URL'));
  assert.ok(!Object.hasOwn(env,'PGPASSWORD'));
  assert.ok(!Object.hasOwn(env,'DOCKER_HOST'));
  assert.ok(!Object.hasOwn(env,'DOCKER_CONTEXT'));
  assert.ok(FIELDS.includes('PGPASSWORD'));
  assert.match(WRAPPER,/read -r -d '' value/);
  assert.ok(!WRAPPER.includes('eval'));
});

test.skipIf(process.env.RECOVERY_LOCAL_SQL_TEST !== '1')('PostgreSQL role guard ignores database-only settings and blocks exported secrets/multiline', async () => {
  const source=await readFile(new URL('../recovery-database-backup.mjs',import.meta.url),'utf8');
  const predicate=source.match(/'unsafeRoleConfigCount', \(SELECT count\(\*\) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest\(s\.setconfig\) AS x\(setting\) WHERE ([\s\S]*?)\),\n 'foreignObjectCount'/)?.[1];
  assert.ok(predicate);
  const sql=`WITH pg_roles(oid,rolname) AS (VALUES (1,'authenticator'),(2,'fictional_custom'),(3,'pg_monitor')),
    pg_db_role_setting(label,setdatabase,setrole,setconfig,expected) AS (VALUES
      ('database_only',42,0,ARRAY['app.settings.jwt_secret=fictional'],false),
      ('role_database',42,1,ARRAY['pgrst.jwt_secret=fictional'],false),
      ('missing_role',0,999,ARRAY['app.secret=fictional'],false),
      ('pg_role',0,3,ARRAY['app.secret=fictional'],false),
      ('reactivated_secret',0,1,ARRAY['pgrst.jwt_secret=fictional'],true),
      ('custom_secret',0,2,ARRAY['app.secret=fictional'],true),
      ('safe_timeout',0,2,ARRAY['statement_timeout=1000'],false),
      ('safe_pgrst',0,1,ARRAY['pgrst.db_schemas=public'],false),
      ('multiline',0,1,ARRAY['statement_timeout=1000'||chr(10)||'fictional'],true))
    SELECT coalesce(bool_and((${predicate})=expected),false) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) AS x(setting);`;
  const command='set -euo pipefail; initdb -D /tmp/role-guard-test -A trust --no-locale >/dev/null 2>&1; pg_ctl -D /tmp/role-guard-test -o "-c listen_addresses= -c unix_socket_directories=/tmp -c logging_collector=off" -w start >/dev/null 2>&1; psql -X -qAt --no-password -h /tmp -U postgres -d postgres -v ON_ERROR_STOP=1; pg_ctl -D /tmp/role-guard-test -m fast -w stop >/dev/null 2>&1';
  const child=spawnSync('docker',['run','--rm','--pull=never','--network','none','--log-driver=none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--user','postgres','--tmpfs','/tmp:rw,nosuid,size=128m','-i','postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826','bash','-c',command],{env:childEnvironment(),input:sql,encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(child.status,0,'Synthetic local SQL regression failed; diagnostics withheld');
  assert.equal(child.stdout.trim(),'t');
});
