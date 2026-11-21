import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  legacyFilePathBelongsToPatient,
  pathBelongsToPatient,
  reconcileFailedMetadata,
  verifyStoredUpload,
} from "./storage-integrity";

const patient = "11111111-1111-4111-8111-111111111111";
const otherPatient = "22222222-2222-4222-8222-222222222222";
const path = `${patient}/33333333-3333-4333-8333-333333333333.pdf`;
const bytes = new TextEncoder().encode("%PDF-1.4 fictional test");

function fixture(overrides: Record<string, unknown> = {}) {
  const info = {
    id: "storage-object-1", version: "version-1", bucketId: "arquivos-paciente",
    name: path, size: bytes.length, contentType: "application/pdf",
    metadata: { size: bytes.length, mimetype: "application/pdf" },
    ...overrides,
  };
  const readInfo = vi.fn().mockResolvedValue({ data: info, error: null });
  const readBytes = vi.fn().mockResolvedValue({ data: new Blob([bytes], { type: "application/pdf" }), error: null });
  return { readInfo, readBytes };
}

const verify = (reads: ReturnType<typeof fixture>, input: Partial<Parameters<typeof verifyStoredUpload>[0]> = {}) =>
  verifyStoredUpload({ patientId: patient, purpose: "file:administrativo", path, expectedBytes: bytes,
    mimeType: "application/pdf", ...reads, ...input });

describe("Storage privado: verificacao do objeto persistido", () => {
  it("aceita somente bytes, tamanho, MIME, bucket e path coerentes", async () => {
    const reads = fixture();
    expect(await verify(reads)).toEqual({
      sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length,
      mimeType: "application/pdf",
    });
    expect(reads.readInfo).toHaveBeenCalledTimes(2);
    expect(reads.readBytes).toHaveBeenCalledTimes(1);
  });

  it.each([
    { bucketId: "publico" }, { name: `${otherPatient}/file.pdf` },
    { size: bytes.length + 1 }, { contentType: "image/png" },
    { metadata: { size: bytes.length + 1, mimetype: "application/pdf" } },
    { contentType: undefined, metadata: null },
  ])("nega metadados do Storage divergentes: %j", async (change) => {
    expect(await verify(fixture(change))).toBeNull();
  });

  it("nega bytes divergentes mesmo quando tamanho e MIME coincidem", async () => {
    const reads = fixture();
    const altered = new TextEncoder().encode("%PDF-1.4 another file  ");
    expect(altered.length).toBe(bytes.length);
    reads.readBytes.mockResolvedValue({ data: new Blob([altered], { type: "application/pdf" }), error: null });
    expect(await verify(reads)).toBeNull();
  });

  it("nega troca do objeto entre as duas leituras de metadados", async () => {
    const reads = fixture();
    reads.readInfo.mockResolvedValueOnce({ data: (await reads.readInfo()).data, error: null });
    reads.readInfo.mockResolvedValueOnce({ data: { ...(await reads.readInfo()).data, version: "version-2" }, error: null });
    expect(await verify(reads)).toBeNull();
  });

  it("nega leitura com erro ou namespace de outro paciente", async () => {
    const reads = fixture();
    reads.readBytes.mockResolvedValue({ data: null, error: new Error("unavailable") });
    expect(await verify(reads)).toBeNull();
    expect(await verify(fixture(), { patientId: otherPatient })).toBeNull();
    expect(pathBelongsToPatient(path, otherPatient, "file:administrativo")).toBe(false);
  });

  it("nega info ausente ou erro do endpoint antes de baixar bytes", async () => {
    const missing = fixture();
    missing.readInfo.mockResolvedValue({ data: null, error: null });
    expect(await verify(missing)).toBeNull();
    expect(missing.readBytes).not.toHaveBeenCalled();
    const errored = fixture();
    errored.readInfo.mockRejectedValue(new Error("Storage offline"));
    expect(await verify(errored)).toBeNull();
    expect(errored.readBytes).not.toHaveBeenCalled();
  });

  it("preserva formato legado no download, mas exige prefixo exato do paciente", () => {
    expect(legacyFilePathBelongsToPatient(path, patient)).toBe(true);
    expect(legacyFilePathBelongsToPatient(path, otherPatient)).toBe(false);
    expect(legacyFilePathBelongsToPatient(`${patient}/../file.pdf`, patient)).toBe(false);
  });

  it("compensa erro SQL confirmado somente apos SELECT sem metadata", async () => {
    const metadataForPath = vi.fn().mockResolvedValue({ data: null, error: null });
    const cancelProof = vi.fn().mockResolvedValue({ error: null });
    const removeObject = vi.fn().mockResolvedValue({ error: null });
    expect(await reconcileFailedMetadata({ rpcError: { code: "23514" }, metadataForPath,
      cancelProof, removeObject })).toBe("removed");
    expect(metadataForPath.mock.invocationCallOrder[0]).toBeLessThan(cancelProof.mock.invocationCallOrder[0]);
    expect(cancelProof.mock.invocationCallOrder[0]).toBeLessThan(removeObject.mock.invocationCallOrder[0]);
  });

  it("preserva binario se SELECT falha ou resposta da RPC nao tem SQLSTATE", async () => {
    const metadataForPath = vi.fn().mockResolvedValue({ data: null, error: new Error("unknown") });
    const cancelProof = vi.fn().mockResolvedValue({ error: null });
    const removeObject = vi.fn().mockResolvedValue({ error: null });
    expect(await reconcileFailedMetadata({ rpcError: { code: "23514" }, metadataForPath,
      cancelProof, removeObject })).toBe("preserved");
    expect(await reconcileFailedMetadata({ rpcError: { code: "PGRST116" }, metadataForPath,
      cancelProof, removeObject })).toBe("preserved");
    expect(cancelProof).not.toHaveBeenCalled();
    expect(removeObject).not.toHaveBeenCalled();
  });
});
