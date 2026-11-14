import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import Image from "next/image";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import styles from "./login.module.css";
import { LoginForm } from "./LoginForm";

type LoginPageProps = {
  searchParams: Promise<{
    reason?: string;
    auth_error?: string;
  }>;
};

const REASON_MESSAGES: Record<string, string> = {
  access_unavailable: "Acesso indisponível. Contate o administrador da clínica.",
  temporary_error: "Não foi possível validar o acesso agora. Tente novamente.",
  session_required: "Entre para acessar o sistema.",
  invalid_link: "O link de acesso é inválido.",
  expired_link: "O link de acesso expirou. Solicite um novo.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const usuario = await getCurrentUser();
  if (usuario) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const reasonKey = params.auth_error ?? params.reason ?? "";
  const initialError = REASON_MESSAGES[reasonKey] ?? null;

  return (
    <main className={styles.page}>
      <div className={styles.layout}>
        <section className={styles.brand} aria-label="Odonto Class">
          <div className={styles.logo}>
            <Image
              src="/brand/odonto-class-login.png"
              alt="Odonto Class — Clínica Odontológica"
              width={1254}
              height={1254}
              sizes="(max-width: 640px) 240px, (max-width: 960px) 300px, 420px"
              priority
            />
          </div>
          <div className={styles.brandMessage}>
            <span className={styles.eyebrow}>CUIDADO EM CADA DETALHE</span>
            <h2>Mais organização.<br /><span>Mais tempo para cuidar.</span></h2>
            <p>Um espaço para conectar sua equipe e simplificar o dia a dia da clínica.</p>
          </div>
          <div className={styles.brandFooter}>
            <span className={styles.brandLine} aria-hidden="true" />
            Gestão clínica com a essência Odonto Class.
          </div>
        </section>

        <section className={styles.card} aria-labelledby="login-title">
          <div className={styles.icon} aria-hidden="true"><LockKeyhole size={23} strokeWidth={1.6} /></div>
          <span className={styles.cardEyebrow}>PORTAL DA EQUIPE</span>
          <h1 id="login-title">Acesse sua conta</h1>
          <p className={styles.subtitle}>Faça login para acessar o sistema da clínica.</p>
          <LoginForm initialError={initialError} />
          <div className={styles.cardFooter}>
            <ShieldCheck size={17} aria-hidden="true" />
            <span>Acesso exclusivo à equipe autorizada.</span>
          </div>
        </section>
        <p className={styles.mobileFooter}>Odonto Class · Clínica Odontológica</p>
      </div>
    </main>
  );
}
