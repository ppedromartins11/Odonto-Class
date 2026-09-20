import type { ClinicalMaterialActionState, ProcedureActionState } from "./types";

export const initialProcedureActionState: ProcedureActionState = {
  success: false,
  error: null,
};

export const initialClinicalMaterialActionState: ClinicalMaterialActionState = {
  success: false,
  error: null,
};
