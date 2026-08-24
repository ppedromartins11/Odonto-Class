import "server-only";
import { cache } from "react";
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

export type CurrentUserState =
  | { kind: "authenticated"; user: UsuarioAtual }
  | { kind: "unauthenticated" }
  | { kind: "inactive"; user: UsuarioAtual }
  | { kind: "profile_missing"; authUserId: string }
  | { kind: "error" };

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
async function resolveCurrentUserState(): Promise<CurrentUserState> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError && authError.status !== 401) {
    return { kind: "error" };
  }

  if (!user) {
    return { kind: "unauthenticated" };
  }

  const { data: perfil, error: perfilError } = await supabase
    .from("usuarios")
    .select("id, nome, email, perfil, status")
    .eq("id", user.id)
    .maybeSingle();

  if (perfilError) {
    return { kind: "error" };
  }

  if (!perfil) {
    return { kind: "profile_missing", authUserId: user.id };
  }

  const usuario = perfil as UsuarioAtual;
  if (usuario.status !== "ativo") {
    return { kind: "inactive", user: usuario };
  }

  return { kind: "authenticated", user: usuario };
}

/**
 * O cache do React e restrito ao request de renderizacao atual. Assim, layout
 * e pagina compartilham a mesma validacao auth + perfil sem criar cache entre
 * usuarios ou relaxar a revalidacao server-side do Supabase.
 */
export const getCurrentUserState = cache(resolveCurrentUserState);

export async function getCurrentUser(): Promise<UsuarioAtual | null> {
  const state = await getCurrentUserState();
  return state.kind === "authenticated" ? state.user : null;
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
  const state = await getCurrentUserState();

  if (state.kind !== "authenticated") {
    const reason =
      state.kind === "inactive" || state.kind === "profile_missing"
        ? "access_unavailable"
        : state.kind === "error"
          ? "temporary_error"
          : "session_required";
    redirect(`/login?reason=${reason}`);
  }

  return state.user;
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
