import { BrandLogo } from "@/components/brand/BrandLogo";
import { getAdminMfaState, requireAdmin } from "@/lib/auth/session";
import { safeMfaReturnPath } from "@/lib/auth/mfa";
import { redirect } from "next/navigation";
import { MfaPanel } from "../MfaPanel";

export default async function MfaSetupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireAdmin();
  const state = await getAdminMfaState();
  const next = safeMfaReturnPath((await searchParams).next);
  if (state === "ready") redirect(next);
  if (state === "challenge") redirect(`/auth/mfa/challenge?next=${encodeURIComponent(next)}`);
  return <main className="flex min-h-screen items-center justify-center bg-secondary/30 px-4 py-8"><div className="w-full max-w-md"><div className="mb-7 flex justify-center"><BrandLogo className="w-64 max-w-[78vw]" priority /></div><MfaPanel mode={state === "unavailable" ? "unavailable" : "setup"} nextPath={next} /></div></main>;
}
