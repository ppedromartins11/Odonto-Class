import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), maybeSingle: vi.fn(), admin: vi.fn(), info: vi.fn(), sign: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/patients/validation", () => ({ isValidUuid: (value: string) => /^[0-9a-f-]{36}$/.test(value) }));
vi.mock("@/lib/operational/storage-integrity", async () => vi.importActual("../../../../lib/operational/storage-integrity"));
import { GET } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const patient = "22222222-2222-4222-8222-222222222222";
const path = `${patient}/33333333-3333-4333-8333-333333333333.pdf`;
const get = (value = id) => GET(new Request(`http://localhost/api/arquivos/${value}`), { params: Promise.resolve({ id: value }) });

describe("download de arquivo privado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "actor" });
    mocks.maybeSingle.mockResolvedValue({ data: { paciente_id: patient, storage_path: path }, error: null });
    mocks.admin.mockReturnValue({ storage: { from: () => ({ info: mocks.info, createSignedUrl: mocks.sign }) } });
    mocks.info.mockResolvedValue({ data: { bucketId: "arquivos-paciente", name: path }, error: null });
    mocks.sign.mockResolvedValue({ data: { signedUrl: "https://example.test/signed" }, error: null });
  });

  it("assina somente apos RLS, namespace e objeto conferidos", async () => {
    const result = await get();
    expect(result.status).toBe(307);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.info).toHaveBeenCalledWith(path);
    expect(mocks.sign).toHaveBeenCalledWith(path, 300);
  });

  it.each([
    { paciente_id: id, storage_path: path },
    { paciente_id: patient, storage_path: `${patient}/../bad.pdf` },
  ])("nega namespace divergente sem acesso privilegiado", async data => {
    mocks.maybeSingle.mockResolvedValue({ data, error: null });
    const result = await get();
    expect(result.status).toBe(404);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("nega objeto ausente ou bucket divergente antes de assinar", async () => {
    mocks.info.mockResolvedValue({ data: null, error: new Error("missing") });
    expect((await get()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
    mocks.info.mockResolvedValue({ data: { bucketId: "other", name: path }, error: null });
    expect((await get()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("nega falhas inesperadas de Storage sem revelar path ou assinar", async () => {
    mocks.info.mockRejectedValue(new Error("private storage path"));
    const result = await get();
    expect(result.status).toBe(404);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("nega linha oculta por RLS e identificador invalido", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await get()).status).toBe(404);
    expect((await get("bad")).status).toBe(404);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
