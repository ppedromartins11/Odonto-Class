import { Cross } from "lucide-react";
import { CLINIC_NAME } from "@/lib/config/clinic";
import { ResetPasswordForm } from "./ResetPasswordForm";
import Link from "next/link";
import { getVerifiedAuthFlow } from "@/lib/auth/flow-cookie";

export default async function RedefinirSenhaPage() {
  const flow = await getVerifiedAuthFlow();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center mb-3">
            <Cross className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">{CLINIC_NAME}</h1>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
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
