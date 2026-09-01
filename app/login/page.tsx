import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
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
    <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-7 flex justify-center">
          <BrandLogo className="w-72 max-w-[82vw] drop-shadow-sm" priority />
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-7">
          <h2 className="text-base font-medium text-card-foreground mb-4">Entrar</h2>
          <LoginForm initialError={initialError} />
        </div>
      </div>
    </div>
  );
}
