import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderPatientDocumentPdf } from "./pdf";

const base = {
  clinicName: "Odonto Class",
  clinicTagline: "Clínica Odontológica",
  patientName: "José da Conceição",
  professionalName: "Fernanda Ávila",
  professionalRegistration: "CRO-MT 12345",
  issuedAt: "2026-09-01",
  purpose: "justificar ausência profissional",
};

describe("official patient PDFs", () => {
  it("renders an A4 dental certificate with authorized CID", async () => {
    const bytes = await renderPatientDocumentPdf({ ...base, type: "atestado", absenceQuantity: 2, absenceUnit: "dias", cidCode: "K04.7" });
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect((await PDFDocument.load(bytes)).getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 });
  });

  it.each(["declaracao_comparecimento", "declaracao_acompanhamento"] as const)("renders the separate %s template without CID", async (type) => {
    const bytes = await renderPatientDocumentPdf({ ...base, type, attendanceStart: "2026-09-01T13:00:00-04:00", attendanceEnd: "2026-09-01T14:00:00-04:00", companionName: type === "declaracao_acompanhamento" ? "Maria da Conceição" : null });
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("uses a PNG asset with an alpha channel for the document logo", async () => {
    const png = await readFile(path.join(process.cwd(), "public", "brand", "odonto-class-logo-document.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([4, 6]).toContain(png[25]);
  });
});

