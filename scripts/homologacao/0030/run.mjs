import { writeReport } from "./verify.mjs";
import { loadLocalEnvironment, reloadLocalEnvironment, ARTIFACT_ROOT } from "./config.mjs";
import { runPreflight } from "./preflight.mjs";
import { runH01, requiresVercelAutomationBypass, VERCEL_BYPASS_ACTION_REQUIRED } from "./h01.mjs";
import { runH02 } from "./h02.mjs";
import { runCleanup } from "./cleanup.mjs";
import { pathToFileURL } from "node:url";

const VALID_PHASES = new Set(["all", "preflight", "h01", "h02", "verify", "cleanup"]);
const SAFE_H02_SETUP_ERRORS = new Set([
  "H02_SETUP_FAILED:authenticated_identity",
  "H02_SETUP_FAILED:professional_lookup",
  "H02_SETUP_FAILED:patient_p1",
  "H02_SETUP_FAILED:patient_p2",
  "H02_SETUP_FAILED:appointment_create",
  "H02_SETUP_FAILED:restore_before_attendance",
  "H02_SETUP_FAILED:attendance_start",
  "H02_SETUP_FAILED:synthetic_evolution",
  "H02_SETUP_FAILED:appointment_integrity",
  "H02_SETUP_FAILED:attendance_integrity",
]);

export function parseArgs(argv) {
  let phase = "all";
  let runId = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--phase") phase = argv[++index] ?? "";
    else if (argv[index] === "--run-id") runId = argv[++index] ?? null;
    else throw new Error("Uso: run.mjs [--phase preflight|h01|h02|verify|cleanup] [--run-id ID]");
  }
  if (!VALID_PHASES.has(phase)) throw new Error("Fase de homologação inválida.");
  if (phase !== "cleanup" && runId) throw new Error("--run-id só pode ser usado na fase cleanup.");
  return { phase, runId };
}

function printPreflight(report) {
  console.log(`[1/8] Preflight ................ ${report.preflight.status}`);
  console.log(`Branch: ${report.git?.branch ?? "indisponível"}; HEAD: ${report.git?.head ?? "indisponível"}; worktree sujo permitido: ${report.git?.dirty ?? "indisponível"}`);
  console.log(`Projeto: ${report.projectRefMasked ?? "não confirmado"}; migration 0030: ${report.database.migration0030}; 0031: ${report.database.migration0031}`);
  console.log(`Signup público desabilitado: ${report.auth.signupDisabled === true ? "SIM" : report.auth.signupDisabled === false ? "NÃO" : "não confirmado"}`);
  console.log(`Órfãos Auth→perfil: ${report.database.authWithoutProfile ?? "não confirmado"}; perfil→Auth: ${report.database.profileWithoutAuth ?? "não confirmado"}`);
  for (const [name, fixture] of Object.entries(report.fixtures)) console.log(`Fixture ${name}: ${fixture.status}${fixture.reason ? ` (${fixture.reason})` : ""}`);
  if (report.preflight.missingVariableNames?.length) console.log(`Configuração local ausente: ${report.preflight.missingVariableNames.join(", ")}`);
  if (Object.values(report.fixtures).some((item) => item.status === "ACTION_REQUIRED")) {
    for (const [fixture, item] of Object.entries(report.fixtures)) {
      if (item.status !== "ACTION_REQUIRED") continue;
      if (fixture === "QA_ADMIN") console.log("ACTION_REQUIRED: identifique/configure a identidade QA admin existente no arquivo local; não reenviar convite para conta existente.");
      else console.log(`ACTION_REQUIRED: ${item.reason} — Admin AAL2 → /usuarios → createUsuario → prepare_user_invitation → inviteUserByEmail → aceite em /auth/confirm; então configure e-mail/senha QA localmente.`);
    }
  }
  if (report.fixtures.QA_ADMIN?.status === "FAIL") {
    console.log("ACTION_REQUIRED: o QA admin detectado não satisfaz o guard de metadata de cliente. Não alterar essa conta; selecione/provisione outra identidade QA admin pelo fluxo normal, com user_metadata sem papel privilegiado.");
  }
  const localActorConfig = [
    "HOMOLOGATION_ADMIN_EMAIL", "HOMOLOGATION_ADMIN_PASSWORD",
    "HOMOLOGATION_DENTIST_A_EMAIL", "HOMOLOGATION_DENTIST_A_PASSWORD",
    "HOMOLOGATION_DENTIST_B_EMAIL", "HOMOLOGATION_DENTIST_B_PASSWORD",
    "HOMOLOGATION_RECEPTION_EMAIL", "HOMOLOGATION_RECEPTION_PASSWORD",
  ].filter((name) => !process.env[name]?.trim());
  if (localActorConfig.length) console.log(`Configuração local de autenticação pendente (não informe valores no chat): ${localActorConfig.join(", ")}`);
  if (report.preflight.reason) console.log(`Preflight: ${report.preflight.reason}`);
}

function printScenarios(title, scenarios) {
  console.log(`${title}: ${Object.values(scenarios).every((item) => item.status === "PASS") ? "PASS" : Object.values(scenarios).some((item) => item.status === "FAIL") ? "FAIL" : "BLOCKED"}`);
  for (const [key, value] of Object.entries(scenarios)) console.log(`  ${key} ................ ${value.status} — ${value.evidence}`);
}

async function confirmMutation(phase) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Execução de H01/H02 requer confirmação explícita em terminal interativo.");
  const { createInterface } = await import("node:readline/promises");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const phaseText = phase === "all" ? "H01 H02" : phase.toUpperCase();
  const expected = `RUN ${phaseText} 0030 QA FIXTURES`;
  try {
    const answer = await terminal.question(`Confirma criação de fixtures sintéticas QA no projeto mascarado? Digite exatamente "${expected}": `);
    if (answer !== expected) throw new Error("Execução cancelada; nenhuma fixture criada.");
  } finally { terminal.close(); }
}

function nonFixtureGatesReady(report) {
  const checks = report.preflight.checks;
  return checks.requiredEnvironment === true && checks.branch === true
    && checks.projectGuard && Object.values(checks.projectGuard).every(Boolean)
    && checks.migration0030Applied === true && checks.migration0031Applied === true
    && checks.signupDisabled === true && checks.authProfileOrphansZero === true && checks.profileAuthOrphansZero === true;
}

async function waitForManualFixtureResolution(initialReport) {
  let report = initialReport;
  while (report.preflight.status !== "PASS") {
    const fixtures = Object.values(report.fixtures ?? {});
    if (!nonFixtureGatesReady(report) || !fixtures.length || fixtures.some((item) => item.status === "BLOCKED")) return report;
    if (fixtures.every((item) => item.status === "PASS")) return report;
    if (!process.stdin.isTTY || !process.stdout.isTTY) return report;
    const { createInterface } = await import("node:readline/promises");
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try { answer = await terminal.question("Conclua os convites/configuração QA pelo fluxo normal e pressione ENTER para revalidar (Q encerra): "); }
    finally { terminal.close(); }
    if (answer.trim().toLowerCase() === "q") return report;
    reloadLocalEnvironment();
    const refreshed = await runPreflight();
    report = refreshed.report;
    printPreflight(report);
  }
  return report;
}

function missingMutationConfiguration(phases, env = process.env) {
  const required = new Set(phases.length ? ["SUPABASE_TEST_SERVICE_ROLE_KEY"] : []);
  if (phases.includes("h01")) {
    ["HOMOLOGATION_ADMIN_EMAIL", "HOMOLOGATION_ADMIN_PASSWORD", "HOMOLOGATION_DENTIST_A_EMAIL", "HOMOLOGATION_DENTIST_A_PASSWORD", "HOMOLOGATION_DENTIST_B_EMAIL", "HOMOLOGATION_DENTIST_B_PASSWORD", "HOMOLOGATION_RECEPTION_EMAIL", "HOMOLOGATION_RECEPTION_PASSWORD", "HOMOLOGATION_BASE_URL"].forEach((name) => required.add(name));
    if (requiresVercelAutomationBypass(env.HOMOLOGATION_BASE_URL)) required.add("VERCEL_AUTOMATION_BYPASS_SECRET");
  }
  if (phases.includes("h02")) {
    ["HOMOLOGATION_DENTIST_A_EMAIL", "HOMOLOGATION_DENTIST_A_PASSWORD", "HOMOLOGATION_DENTIST_B_EMAIL", "HOMOLOGATION_DENTIST_B_PASSWORD", "HOMOLOGATION_RECEPTION_EMAIL", "HOMOLOGATION_RECEPTION_PASSWORD"].forEach((name) => required.add(name));
  }
  return [...required].filter((name) => !env[name]?.trim());
}

function addPhaseResult(report, phase, result) {
  Object.assign(report.scenarios, result.scenarios);
  report.preflight.status = report.preflight.status === "PASS" ? "PASS" : report.preflight.status;
  // This legacy runner covers only H01/H02 and has no approved manifest cleanup.
  report.final = { homologation: "BLOCKED", migration0031Gate: "BLOCKED" };
  report.lastRun = { phase, runId: result.runId, result: result.result };
}

export function safePhaseError(error) {
  const message = error instanceof Error ? error.message : "execution_failed";
  if (SAFE_H02_SETUP_ERRORS.has(message)) return message;
  if (message.startsWith("ACTION_REQUIRED:")) return message.replace(/[^A-Za-z0-9_:\- .]/g, "");
  if (message.startsWith("ACTION_REQUIRED ")) return message.replace(/[^A-Za-z0-9_:\- .]/g, "");
  return "execução interrompida; detalhes internos não foram impressos para evitar exposição de dados";
}

async function main() {
  loadLocalEnvironment();
  const { phase, runId } = parseArgs(process.argv.slice(2));
  if (phase === "cleanup") {
    const preflight = await runPreflight();
    printPreflight(preflight.report);
    const checks = preflight.report.preflight.checks;
    const coreReady = checks.requiredEnvironment === true && checks.branch === true
      && checks.projectGuard && Object.values(checks.projectGuard).every(Boolean)
      && checks.migration0030Applied === true && checks.migration0031Applied === true
      && checks.signupDisabled === true && checks.authProfileOrphansZero === true && checks.profileAuthOrphansZero === true;
    if (!coreReady) throw new Error("Cleanup bloqueado por gate remoto; nenhuma mutação executada.");
    const result = await runCleanup(runId);
    console.log(`Cleanup seletivo concluído: pacientes=${result.removed.patients}, agendamentos=${result.removed.appointments}, atendimentos=${result.removed.attendances}, documentos=${result.removed.documents}.`);
    return;
  }

  const { report } = await runPreflight();
  printPreflight(report);
  if (phase === "preflight" || phase === "verify") {
    if (phase === "verify") console.log("H03/H04/H05: PASS informado anteriormente; não reexecutado neste verify read-only.");
    console.log(`Relatório sanitizado em ${ARTIFACT_ROOT}.`);
    if (report.preflight.status !== "PASS") process.exitCode = 1;
    return;
  }
  let activeReport = report;
  if (activeReport.preflight.status !== "PASS") activeReport = await waitForManualFixtureResolution(activeReport);
  if (phase !== "cleanup") {
    Object.assign(report, activeReport);
  }
  if (activeReport.preflight.status !== "PASS") {
    console.log("0030 HOMOLOGATION: BLOCKED\n0031 GATE: BLOCKED\n0031 STATUS: APPLIED IN QA");
    process.exitCode = 1;
    return;
  }

  const h01Passed = ["H01-A", "H01-B", "H01-C", "H01-D", "H01-E"].every((key) => report.scenarios[key]?.status === "PASS");
  const h02Passed = ["H02-A", "H02-B", "H02-C", "H02-D", "H02-E", "H02-F"].every((key) => report.scenarios[key]?.status === "PASS");
  const phases = phase === "all" ? [...(h01Passed ? [] : ["h01"]), ...(h02Passed ? [] : ["h02"])] : [phase];
  const missingMutationVars = missingMutationConfiguration(phases);
  if (missingMutationVars.length) {
    if (missingMutationVars.includes("VERCEL_AUTOMATION_BYPASS_SECRET")) console.log(VERCEL_BYPASS_ACTION_REQUIRED);
    const otherMissingVars = missingMutationVars.filter((name) => name !== "VERCEL_AUTOMATION_BYPASS_SECRET");
    if (otherMissingVars.length) console.log(`ACTION_REQUIRED: configure localmente: ${otherMissingVars.join(", ")}. Nenhum teste mutável foi iniciado.`);
    report.preflight.status = "BLOCKED";
    report.preflight.reason = "actor_or_setup_configuration_missing";
    await writeReport(report);
    process.exitCode = 1;
    return;
  }
  if (phases.length) await confirmMutation(phase === "all" && phases.length === 1 ? phases[0] : phase);
  for (const current of phases) {
    try {
      const result = current === "h01" ? await runH01() : await runH02();
      console.log(`Run QA atual: ${result.runId} (use --run-id ${result.runId} no cleanup seletivo).`);
      printScenarios(current.toUpperCase(), result.scenarios);
      addPhaseResult(report, current.toUpperCase(), result);
      await writeReport(report);
      if (result.result !== "PASS") break;
    } catch (error) {
      const evidence = safePhaseError(error);
      report.scenarios[`${current.toUpperCase()}-EXECUTION`] = { status: evidence.startsWith("ACTION_REQUIRED:") ? "BLOCKED" : "FAIL", evidence };
      report.final = { homologation: "BLOCKED", migration0031Gate: "BLOCKED" };
      await writeReport(report);
      console.log(`${current.toUpperCase()}: ${report.scenarios[`${current.toUpperCase()}-EXECUTION`].status} — ${evidence}`);
      break;
    }
  }
  console.log(`0030 HOMOLOGATION: ${report.final.homologation}\n0031 GATE: ${report.final.migration0031Gate}\n0031 STATUS: APPLIED IN QA`);
  console.log(`Relatório sanitizado em ${ARTIFACT_ROOT}.`);
  if (report.final.homologation !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = safePhaseError(error);
    console.error(`BLOCKED: ${message}`);
    process.exitCode = 1;
  });
}
