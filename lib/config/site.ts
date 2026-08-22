import "server-only";

export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!configuredUrl) {
    throw new Error("NEXT_PUBLIC_SITE_URL nao configurada.");
  }

  const url = new URL(configuredUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("NEXT_PUBLIC_SITE_URL deve usar http ou https.");
  }

  return url.origin;
}
