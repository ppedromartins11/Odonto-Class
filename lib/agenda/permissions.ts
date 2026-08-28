import type { PerfilUsuario } from "@/lib/auth/session";

/** Espelha o RBAC atual sem substituir a autorizacao server-side/RLS. */
export function canCreateAppointment(profile: PerfilUsuario) {
  return profile === "administrador" || profile === "recepcao";
}
