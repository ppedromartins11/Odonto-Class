export type UserProfileInput = {
  nome: string;
  registroProfissional: string | null;
};

const NAME_MAX_LENGTH = 160;
const PROFESSIONAL_REGISTRATION_MAX_LENGTH = 80;

export function normalizeUserProfileInput(input: {
  nome: FormDataEntryValue | null;
  registroProfissional: FormDataEntryValue | null;
}): { data: UserProfileInput } | { error: string } {
  const nome = String(input.nome ?? "").trim();
  const rawRegistration = String(input.registroProfissional ?? "").trim();
  const registroProfissional = rawRegistration || null;

  if (nome.length < 2 || nome.length > NAME_MAX_LENGTH) {
    return { error: "Informe um nome completo entre 2 e 160 caracteres." };
  }
  if (registroProfissional && registroProfissional.length > PROFESSIONAL_REGISTRATION_MAX_LENGTH) {
    return { error: "O registro profissional deve ter no máximo 80 caracteres." };
  }
  return { data: { nome, registroProfissional } };
}
