import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateH01E, evaluateStorageChecks, formatH01EDiagnostics, HTTPS_BYPASS_ACTION_REQUIRED, printH01EDiagnostics, requiresVercelAutomationBypass, routeDecision, runH01, VERCEL_BYPASS_ACTION_REQUIRED } from "../scripts/homologacao/0030/h01.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const expectedPath = "private-patient/documentos/secret-document.pdf";
const signedUrl = `https://example.supabase.co/storage/v1/object/sign/arquivos-paciente/${expectedPath}?token=signed-secret`;
const actorSession = { getCookieHeader: () => "sb-access-token=cookie-secret" };

function goodStorageChecks() {
  return evaluateStorageChecks({
    bucketResult: { data: { public: false }, error: null },
    anonDownload: { data: null, error: { message: "denied" } },
    aPath: { data: expectedPath, error: null },
    adminPath: { data: null, error: null },
    receptionPath: { data: null, error: null },
    bPath: { data: null, error: null },
    expectedPath,
  });
}

describe("H01-E: diagnóstico sanitizado", () => {
  it("preserva os sete booleanos de Storage e diferencia bucket legível de privado", () => {
    expect(goodStorageChecks()).toEqual({
      bucketReadableByService: true,
      bucketIsPrivate: true,
      anonymousDownloadDenied: true,
      authorPathAllowed: true,
      adminPathDenied: true,
      receptionPathDenied: true,
      otherDentistPathDenied: true,
    });
    expect(evaluateStorageChecks({
      bucketResult: { data: { public: true }, error: null },
      anonDownload: { error: null },
      aPath: { data: null, error: null },
      adminPath: { data: expectedPath, error: null },
      receptionPath: { data: expectedPath, error: null },
      bPath: { data: expectedPath, error: null },
      expectedPath,
    })).toEqual({
      bucketReadableByService: true,
      bucketIsPrivate: false,
      anonymousDownloadDenied: false,
      authorPathAllowed: false,
      adminPathDenied: false,
      receptionPathDenied: false,
      otherDentistPathDenied: false,
    });
  });

  it("classifica status HTTP e categorias sem retornar Location, path ou cookie", async () => {
    const cases = [
      { expectedAllowed: true, response: new Response(null, { status: 302, headers: { location: signedUrl } }), status: "PASS", httpStatus: 302, category: "authorized_signed_redirect" },
      { expectedAllowed: true, response: new Response(null, { status: 200, headers: { location: signedUrl } }), status: "FAIL", httpStatus: 200, category: "authorized_route_did_not_return_signed_redirect" },
      { expectedAllowed: false, response: new Response(null, { status: 404 }), status: "PASS", httpStatus: 404, category: "denied_before_signed_redirect" },
      { expectedAllowed: false, response: new Response(null, { status: 302, headers: { location: signedUrl } }), status: "FAIL", httpStatus: 302, category: "denied_actor_received_route_response" },
    ];
    for (const testCase of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(testCase.response));
      expect(await routeDecision("https://preview.example.test", "secret-document-id", actorSession, testCase.expectedAllowed, {})).toEqual({
        status: testCase.status, httpStatus: testCase.httpStatus, category: testCase.category,
      });
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(signedUrl)));
    expect(await routeDecision("https://preview.example.test", "secret-document-id", actorSession, true, {})).toEqual({
      status: "FAIL", httpStatus: "N/A", category: "preview_route_unreachable",
    });
    expect(await routeDecision("", "secret-document-id", actorSession, true, {})).toEqual({
      status: "BLOCKED", httpStatus: "N/A", category: "preview_route_unreachable",
    });
  });

  it("imprime somente PASS/FAIL, status e categorias fixas, sem token, signed URL, path ou cookie", () => {
    const storage = { ...goodStorageChecks(), bucketIsPrivate: false, storagePath: expectedPath, cookie: actorSession.getCookieHeader() };
    const routes = {
      dentistA: { status: "PASS", httpStatus: 302, category: "authorized_signed_redirect", location: signedUrl },
      admin: { status: "PASS", httpStatus: 404, category: "denied_before_signed_redirect", cookie: actorSession.getCookieHeader() },
      reception: { status: "FAIL", httpStatus: 302, category: "denied_actor_received_route_response", token: "signed-secret" },
      dentistB: { status: "FAIL", httpStatus: signedUrl, category: actorSession.getCookieHeader(), path: expectedPath },
    };
    const writeLine = vi.fn();
    printH01EDiagnostics(storage, routes, writeLine);
    const output = writeLine.mock.calls.map(([line]) => line).join("\n");
    expect(output).toContain("bucket_private: FAIL");
    expect(output).toContain("dentistA: 302 authorized_signed_redirect");
    expect(output).toContain("admin: 404 denied_before_signed_redirect");
    expect(output).toContain("reception: 302 denied_actor_received_route_response");
    expect(output).toContain("dentistB: N/A preview_route_unreachable");
    for (const secret of [signedUrl, expectedPath, "signed-secret", "cookie-secret", "secret-document-id"]) expect(output).not.toContain(secret);
    expect(writeLine).toHaveBeenCalledTimes(13);
    expect(formatH01EDiagnostics(storage, routes)[0]).toBe("H01-E storage:");
  });

  it("mantém evidence de FAIL limitada aos dois agregados booleanos", () => {
    const allowed = [{ status: "PASS" }, { status: "PASS" }, { status: "PASS" }, { status: "PASS" }];
    expect(evaluateH01E({ ...goodStorageChecks(), bucketIsPrivate: false }, allowed)).toEqual({
      status: "FAIL", evidence: "storageSafe=false;routeReady=true",
    });
    expect(evaluateH01E(goodStorageChecks(), [{ status: "FAIL" }, ...allowed.slice(1)])).toEqual({
      status: "FAIL", evidence: "storageSafe=true;routeReady=false",
    });
    expect(evaluateH01E(goodStorageChecks(), allowed)).toEqual({
      status: "PASS", evidence: "private_bucket_authorized_route_only",
    });
    expect(evaluateH01E(goodStorageChecks(), [{ status: "BLOCKED" }, ...allowed.slice(1)])).toEqual({
      status: "BLOCKED", evidence: "ACTION_REQUIRED: preview_route_configuration",
    });
  });

  it("envia bypass somente no header quando configurado e preserva o cookie do ator", async () => {
    const bypassSecret = "synthetic-bypass-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await routeDecision("https://qa-preview.vercel.app", "secret-document-id", actorSession, false, {
      VERCEL_AUTOMATION_BYPASS_SECRET: bypassSecret,
    });
    expect(result).toEqual({ status: "PASS", httpStatus: 404, category: "denied_before_signed_redirect" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.pathname).toBe("/api/documentos/secret-document-id");
    expect(url.search).toBe("");
    expect(options.headers).toEqual({ cookie: actorSession.getCookieHeader(), "x-vercel-protection-bypass": bypassSecret });
    expect(options.redirect).toBe("manual");

    const scenario = evaluateH01E(goodStorageChecks(), [result, result, result, result]);
    const writeLine = vi.fn();
    printH01EDiagnostics(goodStorageChecks(), { dentistA: result, admin: result, reception: result, dentistB: result }, writeLine);
    const reportAndLogs = JSON.stringify({ scenario, route: result, lines: writeLine.mock.calls });
    for (const sensitive of [bypassSecret, signedUrl, expectedPath, "signed-secret", "cookie-secret", "secret-document-id"]) {
      expect(reportAndLogs).not.toContain(sensitive);
    }
  });

  it("omite o header em ambiente não Vercel sem secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(requiresVercelAutomationBypass("https://preview.example.test")).toBe(false);
    expect(requiresVercelAutomationBypass("https://qa-preview.vercel.app.evil.test")).toBe(false);
    expect(await routeDecision("https://preview.example.test", "secret-document-id", actorSession, false, {})).toEqual({
      status: "PASS", httpStatus: 404, category: "denied_before_signed_redirect",
    });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ cookie: actorSession.getCookieHeader() });
  });

  it("bloqueia Preview Vercel sem secret antes de fetch ou criação de fixtures", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const baseUrl = "https://qa-preview.vercel.app";
    expect(requiresVercelAutomationBypass(baseUrl)).toBe(true);
    const decision = await routeDecision(baseUrl, "secret-document-id", actorSession, true, {});
    expect(decision).toEqual({ status: "BLOCKED", httpStatus: "N/A", category: "preview_route_unreachable", reason: VERCEL_BYPASS_ACTION_REQUIRED });
    expect(evaluateH01E(goodStorageChecks(), [decision]).evidence).toBe(VERCEL_BYPASS_ACTION_REQUIRED);
    await expect(runH01({ HOMOLOGATION_BASE_URL: baseUrl })).rejects.toThrow(VERCEL_BYPASS_ACTION_REQUIRED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não propaga secret de erro de rede para category, evidence ou logs", async () => {
    const bypassSecret = "synthetic-bypass-secret";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(bypassSecret)));
    const decision = await routeDecision("https://qa-preview.vercel.app", "secret-document-id", actorSession, true, {
      VERCEL_AUTOMATION_BYPASS_SECRET: bypassSecret,
    });
    expect(decision).toEqual({ status: "FAIL", httpStatus: "N/A", category: "preview_route_unreachable" });
    const scenario = evaluateH01E(goodStorageChecks(), [decision]);
    const output = JSON.stringify({ decision, scenario, lines: formatH01EDiagnostics(goodStorageChecks(), { dentistA: decision, admin: decision, reception: decision, dentistB: decision }) });
    expect(output).not.toContain(bypassSecret);
    expect(scenario.evidence).toBe("storageSafe=true;routeReady=false");
  });

  it("não envia o bypass por HTTP e bloqueia antes de criar fixtures", async () => {
    const bypassSecret = "synthetic-bypass-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = { HOMOLOGATION_BASE_URL: "http://preview.example.test", VERCEL_AUTOMATION_BYPASS_SECRET: bypassSecret };
    const decision = await routeDecision(env.HOMOLOGATION_BASE_URL, "secret-document-id", actorSession, true, env);
    expect(decision).toEqual({ status: "BLOCKED", httpStatus: "N/A", category: "preview_route_unreachable", reason: HTTPS_BYPASS_ACTION_REQUIRED });
    expect(evaluateH01E(goodStorageChecks(), [decision]).evidence).toBe(HTTPS_BYPASS_ACTION_REQUIRED);
    await expect(runH01(env)).rejects.toThrow(HTTPS_BYPASS_ACTION_REQUIRED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(decision)).not.toContain(bypassSecret);
  });
});
