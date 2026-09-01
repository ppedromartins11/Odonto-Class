import { BrandLogo } from "@/components/brand/BrandLogo";
import { ResetPasswordForm } from "./ResetPasswordForm";
import Link from "next/link";
import { getVerifiedAuthFlow } from "@/lib/auth/flow-cookie";

export default async function RedefinirSenhaPage() {
  const flow = await getVerifiedAuthFlow();

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-7 flex justify-center">
          <BrandLogo className="w-60 max-w-[75vw] drop-shadow-sm" priority />
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-7">
          <h2 className="text-base font-medium text-card-foreground mb-4">
            Definir nova senha
          </h2>
          {flow ? (
            <ResetPasswordForm />
          ) : (
            <div className="space-y-4">
              <p role="alert" className="text-sm text-destructive">
                Este link é inválido ou expirou. Solicite uma nova redefinição.
              </p>
              <Link href="/esqueci-senha" className="text-sm text-primary hover:underline">
                Solicitar novo link
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
