import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), serverRpc: vi.fn(), adminRpc: vi.fn(), patient: vi.fn(),
  upload: vi.fn(), info: vi.fn(), download: vi.fn(), remove: vi.fn(), revalidatePath: vi.fn(),
  authorize: vi.fn(), compensate: vi.fn(), adminQuery: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  rpc: mocks.serverRpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.patient }) }) }),
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({
  rpc: mocks.adminRpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.adminQuery }) }) }),
  storage: { from: () => ({ upload: mocks.upload, info: mocks.info, download: mocks.download, remove: mocks.remove }) },
}) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/operational/file-authorization", () => ({
  authorizePatientFileUpload: mocks.authorize,
  compensatePatientFileUpload: mocks.compensate,
}));
vi.mock("@/lib/operational/validation", async () => vi.importActual("../../../lib/operational/validation"));
vi.mock("@/lib/operational/storage-integrity", async () => vi.importActual("../../../lib/operational/storage-integrity"));
vi.mock("@/lib/patients/validation", () => ({ isValidUuid: (value: string) => /^[0-9a-f-]{36}$/.test(value) }));
import { uploadPatientFile } from "./file-actions";

const patientId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const bytes = new TextEncoder().encode("%PDF-1.4 fictional test");
function form() {
  const data = new FormData();
  data.set("patientId", patientId);
  data.set("category", "administrativo");
  data.set("file", new File([bytes], "example.pdf", { type: "application/pdf" }));
  return data;
}

describe("upload de arquivo com atestacao privada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: actorId });
    mocks.authorize.mockResolvedValue(true);
    mocks.compensate.mockImplementation(async (remove: () => Promise<{ error: unknown }>) => (await remove()).error === null);
    mocks.patient.mockResolvedValue({ data: { id: patientId }, error: null });
    mocks.serverRpc.mockImplementation(async (name: string) => name === "can_manage_operational"
      ? { data: true, error: null } : { data: { id: "metadata" }, error: null });
    mocks.adminRpc.mockResolvedValue({ data: null, error: null });
    mocks.adminQuery.mockResolvedValue({ data: null, error: null });
    mocks.upload.mockResolvedValue({ data: { path: "uploaded" }, error: null });
    mocks.info.mockImplementation(async (path: string) => ({ data: {
      id: "object-1", version: "version-1", bucketId: "arquivos-paciente", name: path,
      size: bytes.length, contentType: "application/pdf", metadata: { size: bytes.length, mimetype: "application/pdf" },
    }, error: null }));
    mocks.download.mockResolvedValue({ data: new Blob([bytes], { type: "application/pdf" }), error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
  });

  it("faz readback antes da prova e grava somente digest/tamanho verificados", async () => {
    expect(await uploadPatientFile({ success: false, error: null }, form())).toEqual({ success: true, error: null });
    const [prepareName, prepareArgs] = mocks.adminRpc.mock.calls[0];
    expect(prepareName).toBe("prepare_upload_attestation");
    expect(prepareArgs).toMatchObject({
      p_actor_id: actorId, p_paciente_id: patientId, p_purpose: "file:administrativo",
      p_bucket_id: "arquivos-paciente", p_tamanho_bytes: bytes.length,
      p_mime_type: "application/pdf", p_sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(mocks.info.mock.invocationCallOrder[1]).toBeLessThan(mocks.adminRpc.mock.invocationCallOrder[0]);
    expect(mocks.download.mock.invocationCallOrder[0]).toBeLessThan(mocks.adminRpc.mock.invocationCallOrder[0]);
    const [metadataName, metadataArgs] = mocks.serverRpc.mock.calls.find(([name]) => name === "create_patient_file_metadata_verified")!;
    expect(metadataName).toBe("create_patient_file_metadata_verified");
    expect(metadataArgs).toMatchObject({ p_sha256: prepareArgs.p_sha256, p_tamanho_bytes: bytes.length });
    expect(createHash("sha256").update(metadataArgs.p_upload_token).digest("hex")).toBe(prepareArgs.p_token_hash);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("nega objeto alterado antes de criar prova ou metadata e remove apenas upload novo", async () => {
    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(bytes.length)], { type: "application/pdf" }), error: null });
    expect((await uploadPatientFile({ success: false, error: null }, form())).success).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.serverRpc).not.toHaveBeenCalledWith("create_patient_file_metadata_verified", expect.anything());
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.remove.mock.calls[0][0]).toEqual([mocks.upload.mock.calls[0][0]]);
  });

  it("nega autor sem permissao antes de acessar Storage privilegiado", async () => {
    mocks.authorize.mockResolvedValue(false);
    expect((await uploadPatientFile({ success: false, error: null }, form())).success).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("preserva PDF quando a RPC falha mas a linha foi persistida", async () => {
    mocks.serverRpc.mockImplementation(async (name: string) => name === "can_manage_operational"
      ? { data: true, error: null } : { data: null, error: { code: "23514", message: "masked" } });
    mocks.adminQuery.mockResolvedValue({ data: { id: "committed" }, error: null });
    expect((await uploadPatientFile({ success: false, error: null }, form())).success).toBe(false);
    expect(mocks.adminQuery).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
  });

  it("preserva PDF sob timeout ambiguo mesmo se consulta imediata parecer vazia", async () => {
    mocks.serverRpc.mockImplementation(async (name: string) => name === "can_manage_operational"
      ? { data: true, error: null } : Promise.reject(new Error("timeout")));
    expect((await uploadPatientFile({ success: false, error: null }, form())).success).toBe(false);
    expect(mocks.adminQuery).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
