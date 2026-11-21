import { createHash, randomUUID } from "node:crypto";
import { saveRunState } from "./lib/state.mjs";

const QA_PDF = new TextEncoder().encode("%PDF-1.4\nQA-only synthetic clinical authorization fixture\n%%EOF");

export function newRunState(runId) {
  return { runId, tag: `QA_0030_${runId}`, createdIds: [], ownershipManifest: [], storagePaths: [], scenarios: {}, createdAt: new Date().toISOString() };
}

export async function recordFixture(runState, entityType, entityId, createdBy) {
  if (!runState.runId || !entityType || !entityId || !createdBy) throw new Error("FIXTURE_OWNERSHIP_INCOMPLETE");
  runState.ownershipManifest.push({ runId: runState.runId, entity_type: entityType, entity_id: entityId, created_by: createdBy, created_at: new Date().toISOString() });
  if (entityType !== "storage_object") runState.createdIds.push({ kind: entityType, id: entityId, runTag: runState.tag });
  await saveRunState(runState);
}

export async function findProfessionals(service, actorUserIds) {
  const { data, error } = await service.from("profissionais").select("id,usuario_id,registro_profissional,status").in("usuario_id", actorUserIds);
  if (error) throw new Error("FIXTURE_SETUP_FAILED:professional_lookup");
  const byUser = new Map((data ?? []).map((row) => [row.usuario_id, row]));
  return { byUser, all: data ?? [] };
}

export async function uploadSyntheticPdf(service, patientId, runState) {
  const path = `${patientId}/documentos/${randomUUID()}.pdf`;
  const result = await service.storage.from("arquivos-paciente").upload(path, QA_PDF, { contentType: "application/pdf", upsert: false });
  if (result.error) throw new Error("FIXTURE_SETUP_FAILED:private_storage_upload");
  runState.storagePaths.push(path);
  await recordFixture(runState, "storage_object", path, "service_role");
  return { path, size: QA_PDF.byteLength, sha256: createHash("sha256").update(QA_PDF).digest("hex") };
}
