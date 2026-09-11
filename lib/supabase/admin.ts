import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase com a service role key - ignora RLS por completo.
 *
 * Uso restrito: apenas em cÃ³digo server-side que jÃ¡ autorizou a sessÃ£o
 * atual e retorna o mÃ­nimo de dados necessÃ¡rio. AlÃ©m de aÃ§Ãµes administrativas,
 * isso cobre resumos administrativos sem conteÃºdo clÃ­nico quando a RLS foi
 * desenhada deliberadamente para ocultar as linhas de detalhe.
 *
 * O import "server-only" garante que este arquivo nunca seja incluido
 * em um bundle de cliente, mesmo por engano.
 */
export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
