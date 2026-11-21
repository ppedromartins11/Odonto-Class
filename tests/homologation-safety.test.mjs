import { describe,it,expect } from "vitest";
import { projectGuard, databaseRef } from "../scripts/homologacao/lib/safety.mjs";
import { localEnvironment, ACK } from "../scripts/homologacao/lib/env.mjs";
import { sanitize, aggregate, newReport } from "../scripts/homologacao/lib/report.mjs";

const ref="zxvpyxvhymuibaxgxetf";
const productionRef="sqouddqzpmkofenyufuj";
const drRef="qprzxkolbbnqfopamfhj";
const remote={SUPABASE_TEST_HOMOLOGATION:ACK,SUPABASE_TEST_ENVIRONMENT:"homologation",SUPABASE_TEST_PROJECT_REF:ref,
  QA_SUPABASE_PROJECT_REF:ref,PRODUCTION_SUPABASE_PROJECT_REF:productionRef,
  DR_SUPABASE_PROJECT_REF:drRef,
  VERCEL_PREVIEW_SUPABASE_PROJECT_REF:ref,VERCEL_PRODUCTION_SUPABASE_PROJECT_REF:productionRef,
  SUPABASE_TEST_URL:`https://${ref}.supabase.co`,NEXT_PUBLIC_SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_TEST_DB_URL:`postgresql://postgres:fictional@db.${ref}.supabase.co:5432/postgres`};
describe("target guard fail-closed",()=>{
  it("requires linked project, acknowledgement and explicit non-production environment",()=>{
    expect(projectGuard(remote,ref).pass).toBe(true);
    for(const [name,value] of [["SUPABASE_TEST_HOMOLOGATION",""],["SUPABASE_TEST_ENVIRONMENT","production"],["SUPABASE_PRODUCTION_PROJECT_REFS",ref],["NEXT_PUBLIC_SUPABASE_URL","https://other.invalid"],["SUPABASE_TEST_DB_URL","postgres://postgres:fictional@localhost/postgres"],["QA_SUPABASE_PROJECT_REF",""],["PRODUCTION_SUPABASE_PROJECT_REF",""],["DR_SUPABASE_PROJECT_REF",""],["PRODUCTION_SUPABASE_PROJECT_REF",ref],["DR_SUPABASE_PROJECT_REF",ref],["VERCEL_PREVIEW_SUPABASE_PROJECT_REF",productionRef],["VERCEL_PRODUCTION_SUPABASE_PROJECT_REF",ref]]){
      expect(projectGuard({...remote,[name]:value},ref).pass,name).toBe(false);
    }
    expect(projectGuard(remote,null).pass).toBe(false);
  });
  it("denies the independently observed Production ref even if every caller variable agrees",()=>{
    const old="sqouddqzpmkofenyufuj";
    const spoofed={...remote,SUPABASE_TEST_PROJECT_REF:old,QA_SUPABASE_PROJECT_REF:old,
      SUPABASE_TEST_URL:`https://${old}.supabase.co`,NEXT_PUBLIC_SUPABASE_URL:`https://${old}.supabase.co`,
      SUPABASE_TEST_DB_URL:`postgresql://postgres:fictional@db.${old}.supabase.co:5432/postgres`,
      VERCEL_PREVIEW_SUPABASE_PROJECT_REF:old};
    expect(projectGuard(spoofed,old).checks.targetNotProduction).toBe(false);
    expect(projectGuard(spoofed,old).pass).toBe(false);
  });
  it("denies the independently observed DR ref even if every caller variable agrees",()=>{
    const old="qprzxkolbbnqfopamfhj";
    const spoofed={...remote,SUPABASE_TEST_PROJECT_REF:old,QA_SUPABASE_PROJECT_REF:old,
      SUPABASE_TEST_URL:`https://${old}.supabase.co`,NEXT_PUBLIC_SUPABASE_URL:`https://${old}.supabase.co`,
      SUPABASE_TEST_DB_URL:`postgresql://postgres:fictional@db.${old}.supabase.co:5432/postgres`,
      VERCEL_PREVIEW_SUPABASE_PROJECT_REF:old};
    expect(projectGuard(spoofed,old).checks.targetNotDr).toBe(false);
    expect(projectGuard(spoofed,old).pass).toBe(false);
  });
  it("denies an unrelated ref even when every caller-controlled value agrees",()=>{
    const other="abcdefghijklmnopqrst";
    const spoofed={...remote,SUPABASE_TEST_PROJECT_REF:other,QA_SUPABASE_PROJECT_REF:other,
      SUPABASE_TEST_URL:`https://${other}.supabase.co`,NEXT_PUBLIC_SUPABASE_URL:`https://${other}.supabase.co`,
      SUPABASE_TEST_DB_URL:`postgresql://postgres:fictional@db.${other}.supabase.co:5432/postgres`,
      VERCEL_PREVIEW_SUPABASE_PROJECT_REF:other};
    expect(projectGuard(spoofed,other).checks.targetIsApprovedQa).toBe(false);
    expect(projectGuard(spoofed,other).pass).toBe(false);
  });
  it("requires canonical API and exact direct/pooler DB identity",()=>{
    expect(databaseRef(`postgres://postgres.${ref}:fictional@aws-0-us-east-1.pooler.supabase.com:6543/postgres`)).toBe(ref);
    expect(databaseRef(`postgres://postgres.${ref}:fictional@evil.example/postgres`)).toBeNull();
    expect(projectGuard({...remote,SUPABASE_TEST_URL:`https://${ref}.supabase.co@evil.example`},ref).pass).toBe(false);
    expect(projectGuard({...remote,SUPABASE_TEST_URL:`https://${ref}.supabase.co/other`},ref).pass).toBe(false);
  });
  it("local lab clears inherited remote authority and refuses mixed targets",()=>{
    const env=localEnvironment(remote,{SUPABASE_TEST_URL:"http://127.0.0.1:12345",SUPABASE_TEST_DB_URL:"postgres://postgres:fake@127.0.0.1:12346/postgres",SUPABASE_TEST_ANON_KEY:"fictional",SUPABASE_TEST_SERVICE_ROLE_KEY:"fictional"});
    expect(env.SUPABASE_TEST_PROJECT_REF).toBeUndefined();
    expect(projectGuard(env,null,"local").pass).toBe(true);
    expect(projectGuard({...env,SUPABASE_TEST_DB_URL:remote.SUPABASE_TEST_DB_URL},null,"local").pass).toBe(false);
  });
});
describe("fresh audit reports",()=>{
  it("redacts passwords, connection strings, keys and clinical paths",()=>{
    const value=sanitize({password:"fake-password",message:"postgres://postgres:fake-password@127.0.0.1/db fake@example.test",storagePath:"private/pdf",serviceRole:"fake-key"});
    const serialized=JSON.stringify(value);
    expect(serialized).not.toContain("fake-password");expect(serialized).not.toContain("fake@example.test");
    expect(serialized).not.toContain("private/pdf");expect(serialized).not.toContain("fake-key");
  });
  it("does not promote skips, partial runs or absent evidence",()=>{
    expect(aggregate([])).toBe("BLOCKED");expect(aggregate(["PASS","SKIP"])).toBe("BLOCKED");expect(aggregate(["PASS","FAIL"])).toBe("FAIL");
    expect(newReport("all").productionGate).toBe("BLOCKED");expect(newReport("all").gates).toEqual({});
  });
  it("preserves validated run and code fingerprints while redacting secret-shaped fields",()=>{
    const run=newReport("all"),head="a".repeat(40),sha256="b".repeat(64);
    const report=sanitize({runId:run.runId,git:{head},migrations:[{sha256}],secret:head});
    expect(report.runId).toBe(run.runId);expect(report.git.head).toBe(head);expect(report.migrations[0].sha256).toBe(sha256);
    expect(report.secret).toBe("[REDACTED]");
  });
  it("keeps fixed failure evidence readable without retaining JWTs or signed URLs",()=>{
    const reason="allowlisted_empty_0030_migration_table";
    expect(sanitize({reason}).reason).toBe(reason);
    expect(sanitize("eyJabcdefghijk.abcdefghijklm.abcdefghijklm")).toBe("[REDACTED]");
    expect(sanitize("https://fake.example/storage/v1/object/sign/private.pdf?token=fake")).toBe("[REDACTED_SIGNED_URL]");
  });
  it("redacts alternate API credential, password and private-link field names",()=>{
    const safe=sanitize({apiKey:"fictional-opaque-key",api_key:"fictional-opaque-key",passwd:"fictional-password",signedUrl:"https://example.test/private.pdf?signature=fictional",magicLink:"fictional-link"});
    expect(Object.values(safe)).toEqual(Array(5).fill("[REDACTED]"));
  });
});
