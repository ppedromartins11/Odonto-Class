import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * A raiz do site nao renderiza conteudo proprio - so decide para onde
 * mandar a pessoa. O middleware ja faz essa mesma checagem para bloquear
 * acesso indevido; esta pagina cobre o caso de navegacao direta para "/".
 */
export default async function RootPage() {
  const usuario = await getCurrentUser();

  if (usuario) {
    redirect("/dashboard");
  }

  redirect("/login");
}
