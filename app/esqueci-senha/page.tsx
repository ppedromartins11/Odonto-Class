import { BrandLogo } from "@/components/brand/BrandLogo";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default function EsqueciSenhaPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-7 flex justify-center">
          <BrandLogo className="w-60 max-w-[75vw] drop-shadow-sm" priority />
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-7">
          <h2 className="text-base font-medium text-card-foreground mb-1">
            Redefinir senha
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Informe seu e-mail para receber um link de redefinição.
          </p>
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  );
}
