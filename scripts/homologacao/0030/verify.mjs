import { saveReport } from "./lib/safe.mjs";

export async function writeReport(report) {
  report.timestamp = new Date().toISOString();
  report.final ??= { homologation: "BLOCKED", migration0031Gate: "BLOCKED" };
  return saveReport(report);
}
