import "server-only";

type SiteUrlEnvironment = Record<string, string | undefined>;

function originFromVercelHost(value: string | undefined, variable: string) {
  const host = value?.trim();
  if (!host) throw new Error(`${variable} nao configurada.`);

  const scheme = host.match(/^https?:\/\//i)?.[0];
  const authorityAndPath = scheme ? host.slice(scheme.length) : host;
  const authority = authorityAndPath.endsWith("/")
    ? authorityAndPath.slice(0, -1)
    : authorityAndPath;
  if (/[?#\\]/.test(authorityAndPath) || authority.includes("/")) {
    throw new Error(`${variable} invalida.`);
  }

  let url: URL;
  try {
    url = new URL(scheme ? host : `https://${host}`);
  } catch {
    throw new Error(`${variable} invalida.`);
  }

  if (!["http:", "https:"].includes(url.protocol)
    || !url.hostname
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash) {
    throw new Error(`${variable} invalida.`);
  }

  return url.origin;
}

function originFromConfiguredUrl(value: string | undefined, variable: string) {
  const configuredUrl = value?.trim();
  if (!configuredUrl) throw new Error(`${variable} nao configurada.`);

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error(`${variable} invalida.`);
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${variable} deve usar http ou https e nao pode conter credenciais.`);
  }

  return url.origin;
}

export function getSiteUrl(env: SiteUrlEnvironment = process.env) {
  if (env.VERCEL_ENV === "production") {
    return originFromVercelHost(env.VERCEL_PROJECT_PRODUCTION_URL, "VERCEL_PROJECT_PRODUCTION_URL");
  }

  if (env.VERCEL_ENV === "preview") {
    const branchUrl = env.VERCEL_BRANCH_URL?.trim();
    if (branchUrl) return originFromVercelHost(branchUrl, "VERCEL_BRANCH_URL");

    const configuredPreviewUrl = env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configuredPreviewUrl) return originFromConfiguredUrl(configuredPreviewUrl, "NEXT_PUBLIC_SITE_URL");

    throw new Error("Preview sem URL valida configurada: defina VERCEL_BRANCH_URL ou NEXT_PUBLIC_SITE_URL.");
  }

  return originFromConfiguredUrl(env.NEXT_PUBLIC_SITE_URL, "NEXT_PUBLIC_SITE_URL");
}
