import { NextResponse } from "next/server";
import { getCurrentUserState } from "@/lib/auth/session";
import { listPaymentReferences } from "@/lib/financial/queries";
import { isValidUuid } from "@/lib/patients/validation";

export async function GET(request: Request) {
  const session = await getCurrentUserState();
  const headers = { "Cache-Control": "private, no-store" };
  if (session.kind === "unauthenticated") return NextResponse.json({ error: "session_unavailable" }, { status: 401, headers });
  if (session.kind === "error") return NextResponse.json({ error: "references_unavailable" }, { status: 503, headers });
  if (session.kind !== "authenticated") return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  const patientId = new URL(request.url).searchParams.get("paciente") ?? "";
  if (!isValidUuid(patientId)) return NextResponse.json({ error: "invalid_patient" }, { status: 400, headers });
  try { return NextResponse.json({ references: await listPaymentReferences(patientId) }, { headers }); }
  catch { return NextResponse.json({ error: "references_unavailable" }, { status: 503, headers }); }
}
