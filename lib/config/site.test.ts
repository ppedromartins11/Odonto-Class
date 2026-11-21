import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getSiteUrl } from "./site";

const stablePreviewUrl = "odonto-class-git-rc-sprint-227-5118a4-pedros-projects-056459b8.vercel.app";

describe("getSiteUrl", () => {
  it("returns only the origin for a local configured URL with a path", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000/auth/confirm" }))
      .toBe("http://localhost:3000");
  });

  it("prioritizes VERCEL_BRANCH_URL in Preview", () => {
    expect(getSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: stablePreviewUrl,
      NEXT_PUBLIC_SITE_URL: "https://url-antiga.vercel.app",
      VERCEL_URL: "deployment-efemero.vercel.app",
    })).toBe(`https://${stablePreviewUrl}`);
  });

  it("uses NEXT_PUBLIC_SITE_URL in Preview when VERCEL_BRANCH_URL is absent", () => {
    expect(getSiteUrl({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SITE_URL: `https://${stablePreviewUrl}`,
      VERCEL_URL: "deployment-efemero.vercel.app",
    })).toBe(`https://${stablePreviewUrl}`);
  });

  it("fails closed in Preview when branch and configured URLs are absent", () => {
    expect(() => getSiteUrl({ VERCEL_ENV: "preview" }))
      .toThrow(/Preview sem URL valida configurada/);
  });

  it("never uses VERCEL_URL as a Preview fallback", () => {
    expect(() => getSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_URL: "deployment-efemero.vercel.app",
    })).toThrow(/Preview sem URL valida configurada/);
  });

  it("uses only VERCEL_PROJECT_PRODUCTION_URL in Production", () => {
    expect(getSiteUrl({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "odontoclass.com.br",
      VERCEL_BRANCH_URL: stablePreviewUrl,
      NEXT_PUBLIC_SITE_URL: "https://preview-ou-local.example",
    })).toBe("https://odontoclass.com.br");
  });

  it("fails closed in Production when VERCEL_PROJECT_PRODUCTION_URL is absent", () => {
    expect(() => getSiteUrl({
      VERCEL_ENV: "production",
      VERCEL_URL: "deployment-efemero.vercel.app",
      NEXT_PUBLIC_SITE_URL: "https://preview-ou-local.example",
    })).toThrow("VERCEL_PROJECT_PRODUCTION_URL nao configurada.");
  });

  it("rejects credentials in a configured URL", () => {
    expect(() => getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://user:password@example.com" }))
      .toThrow("NEXT_PUBLIC_SITE_URL deve usar http ou https e nao pode conter credenciais.");
  });

  it("rejects a configured protocol other than HTTP or HTTPS", () => {
    expect(() => getSiteUrl({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" }))
      .toThrow("NEXT_PUBLIC_SITE_URL deve usar http ou https e nao pode conter credenciais.");
  });

  it("rejects FTP for configured URLs", () => {
    expect(() => getSiteUrl({ NEXT_PUBLIC_SITE_URL: "ftp://example.com" }))
      .toThrow("NEXT_PUBLIC_SITE_URL deve usar http ou https e nao pode conter credenciais.");
  });

  it("accepts a root slash but returns only the origin for a Vercel alias", () => {
    expect(getSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "https://preview.example.com/",
    })).toBe("https://preview.example.com");
  });

  it.each([
    ["path", "https://preview.example.com/path"],
    ["query", "https://preview.example.com?next=/login"],
    ["fragment", "https://preview.example.com#login"],
    ["credentials", "https://user:password@preview.example.com"],
    ["FTP protocol", "ftp://preview.example.com"],
  ])("rejects %s in VERCEL_BRANCH_URL", (_kind, branchUrl) => {
    expect(() => getSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: branchUrl,
      NEXT_PUBLIC_SITE_URL: "https://configured.example.com",
    })).toThrow("VERCEL_BRANCH_URL invalida.");
  });

  it("rejects a path in VERCEL_PROJECT_PRODUCTION_URL", () => {
    expect(() => getSiteUrl({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "https://odontoclass.com.br/auth/confirm",
    })).toThrow("VERCEL_PROJECT_PRODUCTION_URL invalida.");
  });

  it("rejects credentials in VERCEL_PROJECT_PRODUCTION_URL", () => {
    expect(() => getSiteUrl({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "https://user:password@odontoclass.com.br",
    })).toThrow("VERCEL_PROJECT_PRODUCTION_URL invalida.");
  });

  it("rejects an invalid protocol in VERCEL_PROJECT_PRODUCTION_URL", () => {
    expect(() => getSiteUrl({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "ftp://odontoclass.com.br",
    })).toThrow("VERCEL_PROJECT_PRODUCTION_URL invalida.");
  });

  it("fails when the local configured URL is absent", () => {
    expect(() => getSiteUrl({})).toThrow("NEXT_PUBLIC_SITE_URL nao configurada.");
  });
});
