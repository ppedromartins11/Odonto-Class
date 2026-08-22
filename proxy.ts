import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set([
  "/login",
  "/esqueci-senha",
  "/redefinir-senha",
  "/auth/callback",
  "/auth/confirm",
]);

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

function isPublicPath(pathname: string) {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return PUBLIC_PATHS.has(normalizedPath);
}

/**
 * Renova a sessao Supabase e aplica a protecao otimista das rotas.
 * Autorizacao por perfil continua sendo responsabilidade das funcoes
 * requireUser()/requireAdmin() e, principalmente, da RLS no banco.
 */
export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY nao configuradas."
    );
  }

  const pendingCookies = new Map<string, PendingCookie>();
  const pendingHeaders = new Map<string, string>();
  let supabaseResponse = NextResponse.next({ request });

  function applyAuthState(response: NextResponse) {
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    pendingHeaders.forEach((value, name) => {
      response.headers.set(name, value);
    });
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          pendingCookies.set(name, { name, value, options });
        });
        Object.entries(headersToSet).forEach(([name, value]) => {
          pendingHeaders.set(name, value);
        });

        supabaseResponse = applyAuthState(NextResponse.next({ request }));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    return applyAuthState(
      NextResponse.redirect(new URL("/login", request.url))
    );
  }

  return applyAuthState(supabaseResponse);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
