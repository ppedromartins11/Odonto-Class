import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type QaIdentity = {
  id: string;
  email: string;
  password: string;
  role: "administrador";
};

export async function createQaAdmin(
  service: SupabaseClient,
  url: string,
  anonKey: string
) {
  const { data: profileRows, error: profileError } = await service
    .from("usuarios")
    .select("id")
    .eq("perfil", "administrador")
    .eq("status", "ativo");
  if (profileError) throw new Error(`Falha ao localizar administrador ativo: ${profileError.code}`);

  const { data: authRows, error: authError } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authError) throw new Error(`Falha ao conferir identidades da homologacao: ${authError.code}`);

  const authIds = new Set(authRows.users.map((user) => user.id));
  const creatorId = profileRows?.find((profile) => authIds.has(profile.id))?.id;
  if (!creatorId) throw new Error("Homologacao sem administrador ativo consistente para criar fixtures QA_RC_.");

  const suffix = randomUUID();
  const identity: Omit<QaIdentity, "id"> = {
    email: `qa_rc_admin-${suffix}@example.com`,
    password: `Tmp-${randomUUID()}-A9!`,
    role: "administrador",
  };
  const { data, error } = await service.auth.admin.createUser({
    email: identity.email,
    password: identity.password,
    email_confirm: true,
    user_metadata: {
      nome: `QA_RC_ADMIN_${suffix}`,
      perfil: identity.role,
      created_by: creatorId,
    },
  });
  if (error || !data.user) throw new Error(`Falha ao criar QA_RC_ADMIN: ${error?.code ?? "sem_usuario"}`);

  const result: QaIdentity = { ...identity, id: data.user.id };
  const session = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await session.auth.signInWithPassword(result);
  if (loginError) {
    await service.from("usuarios").delete().eq("id", result.id);
    await service.auth.admin.deleteUser(result.id);
    throw new Error(`Falha ao autenticar QA_RC_ADMIN: ${loginError.code}`);
  }
  return { identity: result, session };
}
