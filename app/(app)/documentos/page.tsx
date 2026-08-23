import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
export default async function DocumentsPage(){const u=await requireUser();return <div className="mx-auto max-w-4xl space-y-4"><h2 className="text-2xl font-medium">Documentos</h2><p className="text-sm text-muted-foreground">Atestados e declarações ficam vinculados à ficha do paciente.</p>{u.perfil!=="dentista"&&<Link href="/pacientes" className="inline-flex rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Escolher paciente para novo documento</Link>}</div>}
