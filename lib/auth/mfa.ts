export type AssuranceLevel = string | null | undefined;
export type MfaRequirement = "setup" | "challenge" | "ready";

export function getAdminMfaRequirement(currentLevel: AssuranceLevel, nextLevel: AssuranceLevel): MfaRequirement {
  if (currentLevel === "aal2") return "ready";
  return nextLevel === "aal2" ? "challenge" : "setup";
}

export function safeMfaReturnPath(value?: string) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}
