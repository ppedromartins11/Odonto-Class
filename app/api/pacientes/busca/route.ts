import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { listPatients } from "@/lib/patients/queries";
import { normalizeSearchInput } from "@/lib/patients/validation";

export async function GET(request: NextRequest) {
  await requireUser();
  const query = normalizeSearchInput(request.nextUrl.searchParams.get("q") ?? "");
  if (query.length < 2) {
    return NextResponse.json({ patients: [] }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const result = await listPatients({ query, page: 1, includeInactive: false, pageSize: 10 });
  return NextResponse.json(
    { patients: result.patients.map(({ id, nome, telefone_contato }) => ({ id, nome, telefone_contato })) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
