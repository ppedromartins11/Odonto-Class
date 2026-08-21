import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/esqueci-senha", "/redefinir-senha"];

/**
 * Roda em toda navegacao (matcher no final do arquivo).
 *
 * Duas responsabilidades, ambas exigidas pela decisao de seguranca do
 * projeto de nunca depender so de esconder elementos na UI:
 *  1. Renovar o cookie de sessao do Supabase (senao a sessao expira em
 *     segundo plano e o usuario e deslogado de forma inconsistente).
 *  2. Bloquear, antes de qualquer pagina renderizar, o acesso a rotas
 *     autenticadas por quem nao tem sessao valida - e redirecionar quem
 *     ja esta logado para longe de /login.
 *
 * Autorizacao por PERFIL (RBAC) nao e feita aqui - isso e responsabilidade
 * da RLS no banco e das checagens em lib/auth/session.ts
 * (requireAdmin etc.) dentro de cada pagina/action. O middleware so
 * resolve "esta autenticado ou nao".
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Sem configuracao do Supabase, nao ha como validar sessao - deixa
    // passar para nao quebrar o ambiente de desenvolvimento antes do
    // .env.local ser preenchido, mas isso nunca deve acontecer em
    // producao (ver docs/DEPLOYMENT.md).
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Roda em tudo, exceto assets estaticos e internos do Next, para
     * evitar overhead desnecessario nesses arquivos.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
