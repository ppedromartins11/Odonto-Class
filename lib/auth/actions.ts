"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clearAuthFlowCookie } from "@/lib/auth/flow-cookie";

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  await clearAuthFlowCookie();
  redirect("/login");
}
