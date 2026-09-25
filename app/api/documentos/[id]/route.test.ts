import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), rpc: vi.fn(), admin: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/patients/validation", () => ({ isValidUuid: (value: string) => /^[0-9a-f-]{36}$/.test(value) }));
import { GET } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const get = (value = id) => GET(new Request("http://localhost/api/documentos/" + value), { params: Promise.resolve({ id: value }) });
describe("download documental autorizado no banco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ perfil: "dentista" });
    mocks.admin.mockReturnValue({ storage: { from: () => ({ createSignedUrl: mocks.sign }) } });
    mocks.sign.mockResolvedValue({ data: { signedUrl: "https://example.test/private-signed" }, error: null });
  });
  it.each(["administrador", "recepcao"])("%s sem autorizacao de binario nao chega ao Storage privilegiado", async perfil => {
    mocks.requireUser.mockResolvedValue({ perfil });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await get();
    expect(response.status).toBe(404); expect(await response.text()).toBe("");
    expect(response.headers.get("location")).toBeNull(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("autor ou declaracao autorizados recebem URL de 300s sem cache", async () => {
    mocks.rpc.mockResolvedValue({ data: "private/path.pdf", error: null });
    const response = await get();
    expect(mocks.rpc).toHaveBeenCalledWith("get_document_download_path", { p_documento_id: id });
    expect(mocks.sign).toHaveBeenCalledWith("private/path.pdf", 300);
    expect(response.status).toBe(307); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("erro SQL e identificador invalido nao expoem detalhes nem assinam", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "SQL private/path CID" } });
    expect(await (await get()).text()).toBe("");
    expect((await get("invalid")).status).toBe(404);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
