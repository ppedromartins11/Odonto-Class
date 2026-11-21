type AuthorizationResult = { data: boolean | null; error: unknown };

export type PatientFileAuthorizationChecks = {
  patientExists: (patientId: string) => Promise<boolean>;
  canManageOperational: () => Promise<AuthorizationResult>;
  canAccessClinicalPatient: (patientId: string) => Promise<AuthorizationResult>;
};

export async function authorizePatientFileUpload(
  checks: PatientFileAuthorizationChecks,
  patientId: string,
  category: string,
) {
  if (category !== "administrativo" && category !== "clinico") return false;
  if (!(await checks.patientExists(patientId))) return false;
  const result = category === "administrativo"
    ? await checks.canManageOperational()
    : await checks.canAccessClinicalPatient(patientId);
  return result.error === null && result.data === true;
}

export async function compensatePatientFileUpload(
  remove: () => Promise<{ error: unknown }>,
) {
  try {
    const result = await remove();
    return result.error === null;
  } catch {
    return false;
  }
}
