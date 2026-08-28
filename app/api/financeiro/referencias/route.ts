import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { listPaymentReferences } from "@/lib/financial/queries";
import { isValidUuid } from "@/lib/patients/validation";

export async function GET(request: Request) {
  await requireUser();
  const patientId = new URL(request.url).searchParams.get("paciente") ?? "";
  if (!isValidUuid(patientId)) return NextResponse.json({ references: [] }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  try { return NextResponse.json({ references: await listPaymentReferences(patientId) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ references: [] }, { status: 403, headers: { "Cache-Control": "private, no-store" } }); }
}
