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
      <main className="ml-56 pt-14 min-h-screen bg-background">
        <div className="p-6">{children}</div>
      </main>
    </>
  );
}
