import { connection } from "next/server";
import { requireAdminAal2, requireUser } from "@/lib/auth/session";
import { AppNavigation } from "@/components/layout/AppNavigation";

/**
 * Layout de toda a area autenticada (Dashboard, Usuarios, e os futuros
 * modulos). requireUser() e a segunda camada de protecao de rota - a
 * primeira e o middleware (middleware.ts). Redundante por design: nunca
 * dependemos so de uma unica checagem nem so da UI (ver docs/SECURITY.md).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // A área autenticada depende de sessão e configuração disponíveis apenas em runtime.
  // Evita tentar carregar o Supabase ao pré-renderizar páginas privadas no CI.
  await connection();
  const usuario = await requireUser();
  if (usuario.perfil === "administrador") await requireAdminAal2("/dashboard");

  return (
    <>
      <a href="#main-content" className="skip-link">Pular para o conteúdo principal</a>
      <AppNavigation usuario={usuario} />
      <main id="main-content" tabIndex={-1} className="min-h-dvh bg-background pt-14 outline-none md:ml-56">
        <div className="p-3 sm:p-6">{children}</div>
      </main>
    </>
  );
}
