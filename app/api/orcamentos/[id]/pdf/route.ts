import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { CLINIC_NAME } from "@/lib/config/clinic";
import { renderBudgetPdf } from "@/lib/budgets/pdf";
import { getBudget } from "@/lib/budgets/queries";
import { isValidUuid } from "@/lib/patients/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isValidUuid(id)) return new NextResponse(null, { status: 404 });
  const budget = await getBudget(id);
  if (!budget) return new NextResponse(null, { status: 404 });
  const bytes = await renderBudgetPdf({ ...budget, clinicName: CLINIC_NAME });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("register_budget_pdf_generation", { p_orcamento_id: id });
  if (error) return new NextResponse(null, { status: 403 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="orcamento-${budget.numero}.pdf"`, "Cache-Control": "private, no-store" } });
}
