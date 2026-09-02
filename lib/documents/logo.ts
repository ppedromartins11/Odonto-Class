import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadDocumentLogo() {
  return readFile(path.join(process.cwd(), "public", "brand", "odonto-class-logo-document.png"));
}

