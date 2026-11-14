import { requireAdminAal2, requireUser } from "@/lib/auth/session";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

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
  const usuario = await requireUser();
  if (usuario.perfil === "administrador") await requireAdminAal2("/dashboard");

  return (
    <>
      <a href="#main-content" className="skip-link">Pular para o conteúdo principal</a>
      <Sidebar usuario={usuario} />
      <Header usuario={usuario} />
      <main id="main-content" tabIndex={-1} className="h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] overflow-y-auto overscroll-y-contain bg-background pt-14 outline-none md:ml-56 md:h-auto md:min-h-screen md:overflow-visible">
        <div className="p-3 sm:p-6">{children}</div>
      </main>
    </>
  );
}
