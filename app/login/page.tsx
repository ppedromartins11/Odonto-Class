import { Cross } from "lucide-react";
import { CLINIC_NAME, CLINIC_TAGLINE } from "@/lib/config/clinic";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";

/**
 * Nao existe referencia visual no prototipo para esta tela (o prompt
 * original do Figma Make pediu explicitamente para nao implementar
 * autenticacao - ver Conflito 1 da analise). Desenhada do zero usando os
 * mesmos tokens (cores, radius, tipografia) do restante do sistema para
 * manter consistencia visual.
 */
type LoginPageProps = {
  searchParams: Promise<{
    reason?: string;
    auth_error?: string;
  }>;
};

const REASON_MESSAGES: Record<string, string> = {
  access_unavailable: "Acesso indisponível. Contate o administrador da clínica.",
  temporary_error: "Não foi possível validar o acesso agora. Tente novamente.",
  session_required: "Entre para acessar o sistema.",
  invalid_link: "O link de acesso é inválido.",
  expired_link: "O link de acesso expirou. Solicite um novo.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const usuario = await getCurrentUser();
  if (usuario) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const reasonKey = params.auth_error ?? params.reason ?? "";
  const initialError = REASON_MESSAGES[reasonKey] ?? null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center mb-3">
            <Cross className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">{CLINIC_NAME}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{CLINIC_TAGLINE}</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
          <h2 className="text-base font-medium text-card-foreground mb-4">Entrar</h2>
          <LoginForm initialError={initialError} />
        </div>
      </div>
    </div>
  );
}
