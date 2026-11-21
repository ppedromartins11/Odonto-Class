import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { ROOT, ACK, readEnvironment, localEnvironment } from "./lib/env.mjs";
import { execute, npmCommand, supabaseCommand } from "./lib/process.mjs";
import { assertGuard } from "./lib/safety.mjs";
import { newReport, aggregate, saveReport } from "./lib/report.mjs";
import { preflight, sourceFingerprint, SOURCE_FINGERPRINT_VERSION } from "./preflight.mjs";
import { prepareLocalStack } from "./local-stack.mjs";
import { runIntegration, runUnit, discoverIntegrationSuites } from "./test-runner.mjs";
import { runRemoteChecks } from "./remote-checks.mjs";
import { captureCleanupBaseline, verifyCleanup } from "./verify.mjs";
import { startApp } from "./app-server.mjs";

const phases=new Set(["all","preflight","local","remote","h01","h02","h03","h04","h05","h06","cleanup","verify"]);
export function parseArgs(argv) {
  let phase="all";
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==="--phase"&&phases.has(argv[i+1]))phase=argv[++i];
    else throw new Error("USAGE: homologate [--phase all|preflight|local|remote|h01|h02|h03|h04|h05|h06|cleanup|verify]");
  }
  return {phase};
}
const gateFiles={
  h01:["documents-official.authorization","documents-official.cleanup-proof","release-highs.authorization"],
  h02:["clinical-flow.authorization","users-professional-profile.authorization","release-highs.authorization"],
  h03:["budgets.authorization","release-highs.authorization"],
  h04:["mfa-aal2.authorization","release-highs.authorization"],
  h05:["release-highs.authorization"],
  h06:["lot-finalization.concurrency","service-procedure.concurrency","clinical-lot-traceability.authorization","release-highs.authorization","services.attendance-stock.authorization","stock.authorization"],
};
export function selectFiles(inventory,phase) {
  const selected=gateFiles[phase];
  const files=inventory.filter(item=>!selected||selected.some(name=>item.path.endsWith(`/${name}.test.ts`)));
  // Cleanup proof must observe ALL tests, after global local cleanup.
  return files.sort((a,b)=>{
    const rank=x=>x.path.includes("cleanup-proof")?2:x.path.endsWith("qa-cleanup.test.ts")?1:0;
    return rank(a)-rank(b)||a.path.localeCompare(b.path);
  }).map(item=>item.path);
}
export function deriveGates(suites,phase) {
  const files=suites.flatMap(s=>s.files??[]);
  return Object.fromEntries(Object.entries(gateFiles).filter(([key])=>["all","local",key].includes(phase)).map(([key,names])=>{
    const required=names.map(name=>files.find(file=>file.path.endsWith(`/${name}.test.ts`)));
    const release=files.find(file=>file.path.endsWith("/release-highs.authorization.test.ts"));
    const minCases=key==="h05"?4:key==="h06"?3:1;
    const releaseCases=release?.caseNames?.filter(name=>name.includes(key.toUpperCase())).length??0;
    const status=required.some(f=>f?.status==="FAIL")?"FAIL":required.every(f=>f?.status==="PASS")&&releaseCases>=minCases?"PASS":"BLOCKED";
    return [key.toUpperCase(),{status,reason:releaseCases<minCases?"required_gate_cases_not_executed":undefined}];
  }));
}
async function official(script,env) {
  const [cmd,...prefix]=npmCommand();
  const result=await execute(cmd,[...prefix,"run",script],{env,cwd:ROOT});
  return {status:result.code===0&&!result.timedOut&&!result.overflow?"PASS":"FAIL",exitCode:result.code,
    reason:result.timedOut?"process_timeout":result.code?"official_command_failed":undefined};
}
export function normalizeAdvisorResult(result) {
  if(result.code!==0||result.timedOut||result.overflow)return {status:"BLOCKED",reason:"advisor_process_failed",exitCode:result.code};
  let parsed;
  try{parsed=JSON.parse(result.stdout);}catch{
    // CLI 2.116 emits this exact diagnostic on stderr for an empty result.
    if(!result.stdout.trim()&&result.stderr.split(/\r?\n/).some(line=>line.trim()==="No issues found"))parsed=[];
    else return {status:"BLOCKED",reason:"advisor_output_unavailable",exitCode:result.code};
  }
  const findings=Array.isArray(parsed)?parsed:parsed?.lints??parsed?.advisors??parsed?.issues;
  if(!Array.isArray(findings))return {status:"BLOCKED",reason:"advisor_format_unknown"};
  const errors=findings.filter(f=>String(f.level??f.severity).toLowerCase()==="error").length;
  return {status:errors?"FAIL":"PASS",count:findings.length,errors,
    securityDefiner:findings.filter(f=>/security.definer/i.test(String(f.name??f.title??""))).length,
    fingerprints:findings.map(f=>JSON.stringify([f.name??"unknown",f.level??f.severity??"unknown",f.cache_key??""])).sort()};
}
async function advisors(env,workdir) {
  const results={};
  const [cmd,...prefix]=supabaseCommand();
  const help=await execute(cmd,[...prefix,"db","advisors","--help"],{env});
  if(help.code!==0||!help.stdout.includes("--type"))return {status:"BLOCKED",reason:"advisors_cli_unavailable"};
  for(const type of ["security","performance"]) {
    const result=await execute(cmd,[...prefix,"db","advisors","--local","--type",type,"--output","json","--workdir",workdir],{env,timeoutMs:60_000});
    results[type]=normalizeAdvisorResult(result);
  }
  return {status:aggregate(Object.values(results)),...results};
}
function classifyAdvisors(before,after) {
  const result={status:after.status};
  for(const type of ["security","performance"]) {
    const old=before[type],now=after[type];
    if(!old?.fingerprints||!now?.fingerprints){result[type]={status:"BLOCKED",reason:"baseline_or_checkpoint_unavailable"};result.status="BLOCKED";continue;}
    const added=now.fingerprints.filter(f=>!old.fingerprints.includes(f));
    result[type]={status:added.length?"FAIL":now.status,count:now.count,errors:now.errors,newFindings:added.length,preexisting:now.fingerprints.length-added.length,securityDefiner:now.securityDefiner,
      review:now.count?"REQUIRES_RELEASE_REVIEW":"NOT REQUIRED"};
    if(added.length)result.status="FAIL";
  }
  return result;
}
export async function main(argv=process.argv.slice(2)) {
  const {phase}=parseArgs(argv),report=newReport(phase),started=Date.now();
  let stack,app,env;
  const set=(name,value)=>{report.gates[name]=value;console.log(`${name}: ${value.status}${value.reason?` (${value.reason})`:""}`);};
  try {
    env=readEnvironment();
    console.log(`ODONTO CLASS — HOMOLOGAÇÃO\nRun: ${report.runId}`);
    await saveReport(report);
    const p=await preflight(env); const {linkedRef,...safePreflight}=p;
    report.preflight=safePreflight;report.git=p.git;report.versions=p.versions;set("Preflight",{status:p.status});
    const remote=await runRemoteChecks({env,linkedRef,guard:p.remoteGuard,root:ROOT});
    report.remote=remote;set("Remote checks",{status:remote.status,reason:remote.reason});
    set("Remote project guard",{status:p.remoteGuard.pass?"PASS":"BLOCKED",reason:p.remoteGuard.pass?undefined:"FATAL — TARGET PROJECT GUARD FAILED"});
    await saveReport(report);
    if (!p.remoteGuard.pass && !["preflight", "remote", "verify"].includes(phase)) {
      set("Environment isolation", {status:"BLOCKED",reason:"FATAL — ENVIRONMENT ISOLATION GUARD FAILED"});
      return report;
    }
    if(phase==="cleanup") {
      // Rebuild only this runner's acknowledged, owned local lab and prove it empty.
      stack=await prepareLocalStack({runId:report.runId,env:{...env,SUPABASE_TEST_HOMOLOGATION:ACK},execute,root:ROOT,beforeBootstrap:captureCleanupBaseline});
      env=localEnvironment(env,stack.env);assertGuard(env,null,"local");
      report.localStack={projectId:stack.projectId};set("Local Supabase",{status:"PASS"});set("Migrations",stack.migrationState);
      return report;
    }
    if(["preflight","remote","verify"].includes(phase)) {
      if(phase==="verify")set("Verification",{status:remote.status,reason:"read_only_current_target_verification"});
      return report;
    }
    // Quality checks remain useful even when Docker/remote prerequisites block.
    set("Lint",await official("lint",env));set("Typecheck",await official("typecheck",env));
    const unit=await runUnit({env,execute,root:ROOT,runId:report.runId});report.unitTests=unit;set("Unit tests",{status:unit.status,reason:unit.reason});
    if(p.status!=="PASS"){set("Local Supabase",{status:"BLOCKED",reason:"preflight_dependencies_unavailable"});return report;}
    // The command itself explicitly authorizes synthetic data in this isolated local lab.
    stack=await prepareLocalStack({runId:report.runId,env:{...env,SUPABASE_TEST_HOMOLOGATION:ACK},execute,root:ROOT,beforeBootstrap:captureCleanupBaseline});
    report.localStack={projectId:stack.projectId};
    report.cleanup={status:"BLOCKED",reason:"local_run_in_progress"};
    env=localEnvironment(env,stack.env); assertGuard(env,null,"local");
    set("Local project guard",{status:"PASS"});set("Local Supabase",{status:"PASS"});set("Migrations",stack.migrationState);
    const before=await advisors(env,stack.workdir);
    set("Build",await official("build",env));
    if(report.gates.Build.status!=="PASS"){set("Integration",{status:"BLOCKED",reason:"local_app_build_failed"});return report;}
    app=await startApp(env,ROOT);env.SUPABASE_TEST_APP_URL=app.url;assertGuard(env,null,"local");
    const inventory=await discoverIntegrationSuites(ROOT);
    // One invocation per file preserves intended cleanup order despite Vitest sequencing.
    for(const file of selectFiles(inventory,phase)) {
      console.log(`Suite: ${file}`);
      const suite=await runIntegration({env,files:[file],execute,root:ROOT,runId:report.runId});report.suites.push(suite);
      console.log(`Result: ${suite.status}; passed=${suite.passed}; failed=${suite.failed}; skipped=${suite.skipped}`);
      await saveReport(report);
    }
    set("Integration",{status:aggregate(report.suites)});
    for(const [name,result]of Object.entries(deriveGates(report.suites,phase)))set(name,result);
    const concurrent=report.suites.flatMap(s=>s.files??[]).filter(f=>f.path.includes(".concurrency."));
    const requiredConcurrent=["lot-finalization", "service-procedure"].every((name,i)=>concurrent.some(f=>f.path.includes(name)&&f.status==="PASS"&&f.passed>=[64,106][i]));
    if(["all","local","h06"].includes(phase))set("Concurrency",{status:requiredConcurrent?"PASS":concurrent.some(f=>f.status==="FAIL")?"FAIL":"BLOCKED"});
    set("RLS/RBAC",{status:aggregate(report.suites)});
    const after=await advisors(env,stack.workdir);report.advisors=classifyAdvisors(before,after);set("Security checks",{status:report.advisors.status});
  } catch(error) {
    const message=error instanceof Error?error.message:"";
    if(message==="LOCAL_STACK_SETUP_CLEANUP_FAILED") {
      report.cleanup={status:"FAIL",reason:"partial_setup_cleanup_failed"};set("Cleanup",{status:"FAIL",reason:"partial_setup_cleanup_failed"});
    }
    // Exception text is allowlisted; never serialize SDK/SQL/process errors.
    set("Execution",{status:/UNAVAILABLE|BLOCKED|PORT_CONFLICT|ACK_REQUIRED/.test(message)?"BLOCKED":"FAIL",reason:/^[A-Z0-9_]+$/.test(message)?message:"execution_failed_details_withheld"});
  } finally {
    if(app)await app.stop();
    if(stack) {
      try { const cleanup=await stack.cleanup(); const proof=await verifyCleanup(env,stack.baseline);
        report.cleanup={status:aggregate([cleanup,proof]),proof};set("Cleanup",{status:report.cleanup.status});
      }catch{report.cleanup={status:"FAIL",reason:"owned_local_cleanup_or_proof_failed"};set("Cleanup",{status:"FAIL"});}
      finally{if(stack.release)await stack.release();}
    }
    const diff=await execute("git",["diff","--check"],{cwd:ROOT});set("Diff check",{status:diff.code===0?"PASS":"FAIL"});
    if(report.preflight?.sourceSha256) {
      const stable=report.preflight.sourceFingerprintVersion===SOURCE_FINGERPRINT_VERSION&&report.preflight.sourceSha256===sourceFingerprint();
      set("Source stability",{status:stable?"PASS":"BLOCKED",reason:stable?undefined:"sources_changed_during_run_repeat_required"});
    }
    const required=["Preflight","Remote checks","Remote project guard","Local Supabase","Local project guard","Migrations","Lint","Typecheck","Unit tests","Build","Integration","RLS/RBAC","H01","H02","H03","H04","H05","H06","Concurrency","Security checks","Cleanup","Diff check"];
    report.conclusion=aggregate([...Object.values(report.gates),...required.map(name=>report.gates[name]??{status:"BLOCKED"})]);
    report.durationMs=Date.now()-started;report.productionGate="BLOCKED";
    await saveReport(report);
    console.log(`CLEANUP: ${report.cleanup.status}\nHOMOLOGATION: ${report.conclusion}\nPRODUCTION GATE: ${report.productionGate}\nReport: artifacts/homologacao/latest.md`);
    process.exitCode=report.conclusion==="PASS"?0:report.conclusion==="BLOCKED"?2:1;
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
