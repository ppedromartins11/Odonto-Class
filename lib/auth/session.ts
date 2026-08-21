import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PerfilUsuario = "administrador" | "dentista" | "recepcao";

export type UsuarioAtual = {
  id: string;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  status: "ativo" | "inativo";
};

/**
 * Retorna o usuario autenticado (auth + perfil da tabela `usuarios`), ou
 * null se nao houver sessao valida. Nao redireciona - quem chama decide
 * o que fazer (paginas publicas como /login usam isso para redirecionar
 * o usuario JA logado para /dashboard, por exemplo).
 *
 * Sempre confere a sessao contra o servidor Supabase (getUser), nunca
 * confia apenas no cookie decodificado localmente (getSession) - getUser
 * revalida o token no backend do Supabase.
 */
export async function getCurrentUser(): Promise<UsuarioAtual | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: perfil, error: perfilError } = await supabase
    .from("usuarios")
    .select("id, nome, email, perfil, status")
    .eq("id", user.id)
    .single();

  if (perfilError || !perfil) {
    // Usuario existe no Supabase Auth mas nao tem registro correspondente
    // em `usuarios` (nao deveria acontecer no fluxo normal - ver
    // app/(app)/usuarios/actions.ts, que cria os dois juntos). Tratamos
    // como nao autenticado por seguranca, em vez de assumir um perfil.
    return null;
  }

  return perfil as UsuarioAtual;
}

/**
 * Usa em Server Components de rotas protegidas: garante que ha um
 * usuario autenticado e ATIVO, redirecionando para /login caso
 * contrario. Esta e a camada de UI - a protecao de verdade contra
 * acesso indevido a dado e sempre a RLS no banco (ver
 * docs/SECURITY.md), esta funcao so evita expor a tela para quem nao
 * deveria nem tentar.
 */
export async function requireUser(): Promise<UsuarioAtual> {
  const usuario = await getCurrentUser();

  if (!usuario || usuario.status !== "ativo") {
    redirect("/login");
  }

  return usuario;
}

/**
 * Igual a requireUser, mas exige perfil "administrador". Usado nas
 * paginas/actions restritas a administrador (ex.: Usuarios). Redireciona
 * para /dashboard em vez de mostrar uma tela de "acesso negado" vazia -
 * evita revelar que a rota existe para quem nao deveria acessa-la.
 */
export async function requireAdmin(): Promise<UsuarioAtual> {
  const usuario = await requireUser();

  if (usuario.perfil !== "administrador") {
    redirect("/dashboard");
  }

  return usuario;
}
