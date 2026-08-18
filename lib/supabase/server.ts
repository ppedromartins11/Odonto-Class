import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase para uso em Server Components / Server Actions.
 *
 * Sprint 0: apenas o client base, usando a anon key. Nao implementa
 * autenticacao nem propaga sessao de usuario ainda (isso e trabalho da
 * Sprint 1). A service role key (SUPABASE_SERVICE_ROLE_KEY) fica
 * reservada para scripts administrativos especificos e NAO deve ser
 * usada aqui de forma geral - ver docs/SECURITY.md.
 */
export function createSupabaseServerClient() {
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
