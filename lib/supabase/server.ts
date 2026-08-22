import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente Supabase para Server Components / Server Actions / Route Handlers.
 *
 * Sprint 1: usa @supabase/ssr para ler/escrever a sessao via cookies do
 * Next.js. Em Server Components (render), a escrita de cookies pode ser
 * ignorada silenciosamente pelo Next - por isso o refresh de sessao real
 * acontece no proxy (ver proxy.ts na raiz do projeto), nao aqui.
 *
 * Continua usando a anon key (RLS aplica as regras por usuario). A
 * service role key tem cliente proprio, isolado, em lib/supabase/admin.ts,
 * e nunca deve ser usada aqui.
 */
export async function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY nao configuradas. " +
        "Copie .env.local.example para .env.local e preencha com os valores do seu projeto Supabase."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Chamado a partir de um Server Component durante o render -
          // o Next nao permite escrever cookies nesse contexto. Isso e
          // esperado e inofensivo porque o middleware ja cuida do
          // refresh de sessao em toda navegacao.
        }
      },
    },
  });
}
