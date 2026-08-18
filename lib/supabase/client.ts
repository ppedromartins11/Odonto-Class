import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase para uso em componentes client-side.
 *
 * Sprint 0: apenas o client base, sem gestao de sessao/autenticacao.
 * A estrategia de autenticacao (RF-01/RF-02) e RLS (ver docs/SECURITY.md)
 * sera implementada na Sprint 1 - provavelmente evoluindo este arquivo
 * para usar @supabase/ssr, que trata cookies de sessao no App Router.
 * Isso e uma decisao tecnica em aberto, nao uma implementacao definitiva.
 */
export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY nao configuradas. " +
        "Copie .env.local.example para .env.local e preencha com os valores do seu projeto Supabase."
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}
