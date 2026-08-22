import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setAuthFlowCookie } from "@/lib/auth/flow-cookie";
import type { AuthFlow } from "@/lib/auth/flow-token";

function parseFlow(value: string | null): AuthFlow | null {
  return value === "invite" || value === "recovery" ? value : null;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const flow = parseFlow(request.nextUrl.searchParams.get("flow"));

  if (!code || !flow) {
    return NextResponse.redirect(
      new URL("/login?auth_error=invalid_link", request.url)
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL("/login?auth_error=expired_link", request.url)
    );
  }

  await setAuthFlowCookie(data.user.id, flow);
  return NextResponse.redirect(new URL("/redefinir-senha", request.url));
}
