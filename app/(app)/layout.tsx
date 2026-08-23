import { requireUser } from "@/lib/auth/session";
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

  return (
    <>
      <Sidebar usuario={usuario} />
      <Header usuario={usuario} />
      <main className="min-h-screen bg-background pb-14 pt-14 md:ml-56 md:pb-0">
        <div className="p-3 sm:p-6">{children}</div>
      </main>
    </>
  );
}
