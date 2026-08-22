import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setAuthFlowCookie } from "@/lib/auth/flow-cookie";
import type { AuthFlow } from "@/lib/auth/flow-token";

function parseType(value: string | null): { type: EmailOtpType; flow: AuthFlow } | null {
  if (value === "invite") {
    return { type: "invite", flow: "invite" };
  }
  if (value === "recovery") {
    return { type: "recovery", flow: "recovery" };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const parsedType = parseType(request.nextUrl.searchParams.get("type"));

  if (!tokenHash || !parsedType) {
    return NextResponse.redirect(
      new URL("/login?auth_error=invalid_link", request.url)
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: parsedType.type,
  });

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL("/login?auth_error=expired_link", request.url)
    );
  }

  await setAuthFlowCookie(data.user.id, parsedType.flow);
  return NextResponse.redirect(new URL("/redefinir-senha", request.url));
}
