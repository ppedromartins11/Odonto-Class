"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string | null; status?: string };
const pendingFactorStorageKey = "odonto-class-mfa-pending-factor";

function cleanCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function MfaPanel({ mode, nextPath }: { mode: "setup" | "challenge" | "unavailable"; nextPath: string }) {
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setupStarted = useRef(false);

  useEffect(() => {
    if (mode === "unavailable") return;
    // Em desenvolvimento o React pode executar efeitos duas vezes; nunca
    // iniciamos dois enrolls concorrentes para a mesma tela de setup.
    if (mode === "setup" && setupStarted.current) return;
    if (mode === "setup") setupStarted.current = true;
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.mfa.listFactors().then(async ({ data, error: factorsError }) => {
      if (factorsError) { setError("Não foi possível consultar os fatores de autenticação."); return; }
      const verified = (data?.totp ?? []).find((item) => item.status === "verified");
      if (mode === "challenge") {
        if (!verified) { router.replace(`/auth/mfa/setup?next=${encodeURIComponent(nextPath)}`); return; }
        setFactor(verified);
        return;
      }
      if (verified) { router.replace(`/auth/mfa/challenge?next=${encodeURIComponent(nextPath)}`); return; }
      // O id nao e segredo. Ele permite remover, no mesmo navegador, um
      // cadastro interrompido antes de iniciar outro fator pendente.
      const pendingFactorId = window.sessionStorage.getItem(pendingFactorStorageKey);
      if (pendingFactorId) {
        await supabase.auth.mfa.unenroll({ factorId: pendingFactorId });
        window.sessionStorage.removeItem(pendingFactorStorageKey);
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Odonto Class" });
      if (enrolled.error || !enrolled.data?.totp) { setError("Não foi possível preparar a autenticação em duas etapas."); return; }
      setFactor({ id: enrolled.data.id, friendly_name: enrolled.data.friendly_name, status: "unverified" });
      window.sessionStorage.setItem(pendingFactorStorageKey, enrolled.data.id);
      setQrCode(enrolled.data.totp.qr_code);
      setManualKey(enrolled.data.totp.secret);
    });
  }, [mode, nextPath, router]);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor || code.length !== 6) { setError("Digite o código de seis dígitos do autenticador."); return; }
    setBusy(true); setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (verifyError) { setError("Não foi possível validar o código. Verifique e tente novamente."); return; }
    window.sessionStorage.removeItem(pendingFactorStorageKey);
    router.replace(nextPath);
    router.refresh();
  }

  async function logout() {
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    // Fator iniciado mas nao confirmado nao deve permanecer quando o proprio
    // usuario abandona explicitamente o setup.
    if (mode === "setup" && factor?.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
    window.sessionStorage.removeItem(pendingFactorStorageKey);
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/login");
    router.refresh();
  }

  const setup = mode === "setup";
  const unavailable = mode === "unavailable";
  return <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-7">
    <h1 className="text-xl font-semibold text-foreground">{unavailable ? "Verificação temporariamente indisponível" : setup ? "Proteja sua conta" : "Confirme sua identidade"}</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{unavailable ? "Não foi possível confirmar a autenticação em duas etapas. Tente novamente em instantes ou encerre a sessão." : setup ? "Configure a autenticação em duas etapas para continuar como administrador." : "Digite o código exibido no seu aplicativo autenticador."}</p>
    {unavailable ? <div className="mt-6"><Button type="button" variant="secondary" disabled={busy} onClick={logout}>Sair</Button></div> : <>
    {setup && <div className="mt-6 space-y-4">
      {qrCode ? <div className="rounded-lg border border-border bg-white p-4"><Image src={qrCode} alt="QR Code para configurar o autenticador" width={224} height={224} unoptimized className="mx-auto h-56 w-56" /></div> : <p className="rounded-md bg-secondary px-3 py-3 text-sm text-muted-foreground">Preparando QR Code seguro…</p>}
      {manualKey && <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Não consegue escanear o QR Code?</summary><p className="mt-2 break-all font-mono text-xs text-muted-foreground">{manualKey}</p></details>}
    </div>}
    <form onSubmit={verify} className="mt-6 space-y-4">
      <label className="block text-sm font-medium text-foreground">Código de autenticação<input value={code} onChange={(event) => setCode(cleanCode(event.target.value))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="mt-1.5 h-11 w-full rounded-md border border-border bg-input-background px-3 text-center font-mono text-lg tracking-[0.35em] outline-none focus:ring-2 focus:ring-ring" /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3"><Button className="flex-1" disabled={busy || !factor}>{busy ? "Validando…" : "Confirmar código"}</Button><Button type="button" variant="secondary" disabled={busy} onClick={logout}>Sair</Button></div>
    </form></>}
  </section>;
}
