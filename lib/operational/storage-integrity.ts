import { createHash } from "node:crypto";
import { MAX_UPLOAD_BYTES } from "./validation";

export const PATIENT_STORAGE_BUCKET = "arquivos-paciente";

type StoredInfo = {
  id: string;
  version: string;
  bucketId: string;
  name: string;
  size?: number;
  contentType?: string;
  metadata?: { size?: number; mimetype?: string } | null;
};

type StorageResult<T> = { data: T | null; error: unknown };
export type UploadPurpose = "document:atestado" | "document:declaracao_comparecimento" |
  "document:declaracao_acompanhamento" | "file:administrativo" | "file:clinico";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const DOCUMENT_PATH = new RegExp(`^(${UUID})/documentos/${UUID}\\.pdf$`);
const FILE_PATH = new RegExp(`^(${UUID})/${UUID}\\.(pdf|jpg|png)$`);
const LEGACY_FILE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/;

export function pathBelongsToPatient(path: string, patientId: string, purpose: UploadPurpose) {
  const match = purpose.startsWith("document:") ? DOCUMENT_PATH.exec(path) : FILE_PATH.exec(path);
  return match?.[1] === patientId.toLowerCase();
}

export function isDocumentStoragePath(path: string) {
  return DOCUMENT_PATH.test(path);
}

export function legacyFilePathBelongsToPatient(path: string, patientId: string) {
  return LEGACY_FILE_PATH.test(path) && path.split("/", 1)[0] === patientId.toLowerCase();
}

export function storedObjectMatchesPath(
  info: Pick<StoredInfo, "bucketId" | "name"> | null,
  path: string,
) {
  return info?.bucketId === PATIENT_STORAGE_BUCKET && info.name === path;
}

export function mimeMatchesPurpose(path: string, purpose: UploadPurpose, mimeType: string) {
  if (purpose.startsWith("document:")) return mimeType === "application/pdf";
  const extension = FILE_PATH.exec(path)?.[2];
  return (extension === "pdf" && mimeType === "application/pdf") ||
    (extension === "jpg" && mimeType === "image/jpeg") ||
    (extension === "png" && mimeType === "image/png");
}

export type VerifiedUpload = { sha256: string; size: number; mimeType: string };

/** A SQLSTATE response means PostgREST completed (and rolled back) the RPC transaction. */
export function hasSqlState(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code);
}

/** Leave the private binary in place whenever a committed metadata row is possible. */
export async function reconcileFailedMetadata(input: {
  rpcError: unknown;
  metadataForPath: () => PromiseLike<{ data: { id: string } | null; error: unknown }>;
  cancelProof: () => PromiseLike<{ error: unknown }>;
  removeObject: () => PromiseLike<{ error: unknown }>;
}): Promise<"removed" | "preserved"> {
  if (!hasSqlState(input.rpcError)) return "preserved";
  try {
    const existing = await input.metadataForPath();
    if (existing.error || existing.data) return "preserved";
    const canceled = await input.cancelProof();
    if (canceled.error) return "preserved";
    const removed = await input.removeObject();
    return removed.error ? "preserved" : "removed";
  } catch {
    return "preserved";
  }
}

export async function verifyStoredUpload(input: {
  patientId: string;
  purpose: UploadPurpose;
  path: string;
  expectedBytes: Uint8Array;
  mimeType: string;
  readInfo: () => Promise<StorageResult<StoredInfo>>;
  readBytes: () => PromiseLike<StorageResult<Blob>>;
}): Promise<VerifiedUpload | null> {
  const { patientId, purpose, path, expectedBytes, mimeType, readInfo, readBytes } = input;
  if (!pathBelongsToPatient(path, patientId, purpose) || !mimeMatchesPurpose(path, purpose, mimeType) ||
    expectedBytes.length === 0 ||
    expectedBytes.length > MAX_UPLOAD_BYTES) return null;

  try {
    const before = await readInfo();
    if (before.error || !before.data || !infoMatches(before.data)) return null;
    const readback = await readBytes();
    if (readback.error || !readback.data || readback.data.size !== expectedBytes.length ||
      (readback.data.type && readback.data.type !== mimeType)) return null;
    const actualBytes = new Uint8Array(await readback.data.arrayBuffer());
    if (actualBytes.length !== expectedBytes.length) return null;
    const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");
    if (createHash("sha256").update(actualBytes).digest("hex") !== expectedHash) return null;

    const after = await readInfo();
    if (after.error || !after.data || !infoMatches(after.data) ||
      after.data.id !== before.data.id || after.data.version !== before.data.version) return null;
    return { sha256: expectedHash, size: actualBytes.length, mimeType };
  } catch {
    return null;
  }

  function infoMatches(info: StoredInfo) {
    const contentTypes = [info.contentType, info.metadata?.mimetype].filter(Boolean);
    return !!info.id && !!info.version && storedObjectMatchesPath(info, path) &&
      info.size === expectedBytes.length &&
      (info.metadata?.size === undefined || info.metadata.size === expectedBytes.length) &&
      contentTypes.length > 0 && contentTypes.every((value) => value === mimeType);
  }
}
