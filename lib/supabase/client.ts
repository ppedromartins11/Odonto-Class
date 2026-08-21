import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para Client Components.
 *
 * Sprint 1: sessao via cookies (@supabase/ssr), substituindo o client
 * base do Sprint 0 que nao gerenciava sessao nenhuma.
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

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
