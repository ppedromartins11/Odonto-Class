import { createHash } from "node:crypto";
import { hasSqlState } from "../operational/storage-integrity";

const PDF_NAMESPACE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/orcamentos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/;

type ObjectInfo = {
  id: string;
  version: string;
  bucketId: string;
  name: string;
  size?: number;
  contentType?: string;
  metadata?: { size?: number; mimetype?: string } | null;
};
type StorageResult<T> = { data: T | null; error: unknown };

/**
 * Verifica os bytes realmente persistidos antes de registrar uma versao PDF.
 * Esta verificacao nao substitui autorizacao SQL nem a atestacao server-side.
 */
export async function verifyBudgetPdfObject(input: {
  budgetId: string;
  path: string;
  expectedBytes: Uint8Array;
  readInfo: () => PromiseLike<StorageResult<ObjectInfo>>;
  readBytes: () => PromiseLike<StorageResult<Blob>>;
}): Promise<boolean> {
  const { budgetId, path, expectedBytes, readInfo, readBytes } = input;
  if (PDF_NAMESPACE.exec(path)?.[1] !== budgetId.toLowerCase() || expectedBytes.length === 0) {
    return false;
  }

  const infoMatches = (info: ObjectInfo | null) => {
    if (!info?.id || !info.version || info.bucketId !== "arquivos-paciente" ||
        info.name !== path || info.size !== expectedBytes.length) return false;
    const contentTypes = [info.contentType, info.metadata?.mimetype].filter(Boolean);
    return contentTypes.length > 0 && contentTypes.every((mime) => mime === "application/pdf") &&
      (info.metadata?.size === undefined || info.metadata.size === expectedBytes.length);
  };

  try {
    const before = await readInfo();
    if (before.error || !infoMatches(before.data)) return false;

    const binary = await readBytes();
    if (binary.error || !binary.data || binary.data.size !== expectedBytes.length ||
      (binary.data.type && binary.data.type !== "application/pdf")) return false;
    const actualBytes = new Uint8Array(await binary.data.arrayBuffer());
    if (actualBytes.length !== expectedBytes.length ||
      createHash("sha256").update(actualBytes).digest("hex") !==
        createHash("sha256").update(expectedBytes).digest("hex")) return false;

    const after = await readInfo();
    return !after.error && infoMatches(after.data) &&
      before.data?.id === after.data?.id && before.data?.version === after.data?.version;
  } catch {
    return false;
  }
}

/**
 * Nao apaga objetos se a gravacao dos metadados pode ter sido confirmada.
 * Requer falha SQL definitiva e consulta privilegiada comprovando ausencia da linha.
 */
export async function reconcileFailedBudgetPdfRegistration(input: {
  rpcError: unknown;
  metadataForPath: () => PromiseLike<{ data: { id: string } | null; error: unknown }>;
  removeObject: () => PromiseLike<{ error: unknown }>;
}): Promise<"removed" | "preserved"> {
  if (!hasSqlState(input.rpcError)) return "preserved";
  try {
    const row = await input.metadataForPath();
    if (row.error || row.data) return "preserved";
    const removal = await input.removeObject();
    return removal.error ? "preserved" : "removed";
  } catch {
    return "preserved";
  }
}
