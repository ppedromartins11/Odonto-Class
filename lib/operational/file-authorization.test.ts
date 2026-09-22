import { describe, expect, it, vi } from "vitest";
import {
  authorizePatientFileUpload,
  compensatePatientFileUpload,
} from "./file-authorization";

describe("authorizePatientFileUpload", () => {
  it("nega categoria invalida antes de consultar o paciente", async () => {
    const patientExists = vi.fn();
    const allowed = await authorizePatientFileUpload({
      patientExists,
      canManageOperational: vi.fn(),
      canAccessClinicalPatient: vi.fn(),
    }, "patient-id", "invalida");

    expect(allowed).toBe(false);
    expect(patientExists).not.toHaveBeenCalled();
  });

  it("nega antes do fluxo privilegiado quando o paciente nao existe", async () => {
    const canManageOperational = vi.fn();
    const allowed = await authorizePatientFileUpload({
      patientExists: vi.fn().mockResolvedValue(false),
      canManageOperational,
      canAccessClinicalPatient: vi.fn(),
    }, "patient-id", "administrativo");
    expect(allowed).toBe(false);
    expect(canManageOperational).not.toHaveBeenCalled();
  });

  it("nega usuario ativo sem autorizacao operacional", async () => {
    const privilegedUpload = vi.fn();
    const allowed = await authorizePatientFileUpload({
      patientExists: vi.fn().mockResolvedValue(true),
      canManageOperational: vi.fn().mockResolvedValue({ data: false, error: null }),
      canAccessClinicalPatient: vi.fn(),
    }, "patient-id", "administrativo");
    if (allowed) await privilegedUpload();
    expect(allowed).toBe(false);
    expect(privilegedUpload).not.toHaveBeenCalled();
  });

  it("nega de forma fechada quando a verificacao de dominio falha", async () => {
    const allowed = await authorizePatientFileUpload({
      patientExists: vi.fn().mockResolvedValue(true),
      canManageOperational: vi.fn().mockResolvedValue({ data: null, error: new Error("denied") }),
      canAccessClinicalPatient: vi.fn(),
    }, "patient-id", "administrativo");

    expect(allowed).toBe(false);
  });

  it("permite arquivo administrativo somente com autorizacao operacional", async () => {
    const allowed = await authorizePatientFileUpload({
      patientExists: vi.fn().mockResolvedValue(true),
      canManageOperational: vi.fn().mockResolvedValue({ data: true, error: null }),
      canAccessClinicalPatient: vi.fn(),
    }, "patient-id", "administrativo");

    expect(allowed).toBe(true);
  });

  it("usa a autorizacao clinica real do banco para arquivo clinico", async () => {
    const canAccessClinicalPatient = vi.fn().mockResolvedValue({ data: true, error: null });
    const allowed = await authorizePatientFileUpload({
      patientExists: vi.fn().mockResolvedValue(true),
      canManageOperational: vi.fn(),
      canAccessClinicalPatient,
    }, "patient-id", "clinico");
    expect(allowed).toBe(true);
    expect(canAccessClinicalPatient).toHaveBeenCalledWith("patient-id");
  });
});

describe("compensatePatientFileUpload", () => {
  it("confirma a remocao do objeto recem-criado", async () => {
    await expect(compensatePatientFileUpload(
      vi.fn().mockResolvedValue({ error: null }),
    )).resolves.toBe(true);
  });

  it("nao propaga erro retornado ou excecao da compensacao", async () => {
    await expect(compensatePatientFileUpload(
      vi.fn().mockResolvedValue({ error: new Error("storage") }),
    )).resolves.toBe(false);
    await expect(compensatePatientFileUpload(
      vi.fn().mockRejectedValue(new Error("transport")),
    )).resolves.toBe(false);
  });
});
