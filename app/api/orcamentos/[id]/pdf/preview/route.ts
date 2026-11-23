import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { isValidUuid } from "@/lib/patients/validation";
import { getBudget } from "@/lib/budgets/queries";
import { renderBudgetPdf } from "@/lib/budgets/pdf";
import { CLINIC_NAME, CLINIC_TAGLINE } from "@/lib/config/clinic";

/**
 * Prévia atual, sem armazenamento ou registro de versão. A autorização da
 * leitura vem da sessão verificada e do RLS usado por getBudget.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isValidUuid(id)) return new NextResponse(null, { status: 404 });

  const budget = await getBudget(id);
  if (!budget) return new NextResponse(null, { status: 404 });

  try {
    const bytes = await renderBudgetPdf({
      ...budget,
      clinicName: CLINIC_NAME,
      clinicTagline: CLINIC_TAGLINE,
      preview: true,
    });

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="orcamento-previa-${budget.numero}.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    console.error("BUDGET_PDF_PREVIEW_RENDER_FAILED");
    return new NextResponse("Não foi possível gerar a prévia do orçamento.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
