import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase com a service role key - ignora RLS por completo.
 *
 * Uso restrito: SOMENTE dentro de server actions que ja verificaram,
 * antes de chamar esta funcao, que o usuario autenticado tem perfil
 * "administrador" (ver lib/auth/session.ts -> requireAdmin()).
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
