"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./login.module.css";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { signInWithPassword } from "./actions";
import type { LoginState } from "./types";

const initialState: LoginState = { error: null };

export function LoginForm({ initialError = null }: { initialError?: string | null }) {
  const [state, formAction, isPending] = useActionState(
    signInWithPassword,
    initialState
  );

  return (
    <form action={formAction} className={styles.form} aria-busy={isPending}>
      <div>
        <label htmlFor="email" className={styles.label}>
          E-mail
        </label>
        <Input
          className={styles.input}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="voce@clinica.com"
        />
      </div>

      <div>
        <div className={styles.passwordLabel}>
          <label htmlFor="password" className={styles.label}>
            Senha
          </label>
          <Link
            href="/esqueci-senha"
            className={styles.forgot}
          >
            Esqueci minha senha
          </Link>
        </div>
        <Input
          className={styles.input}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </div>

      {(state.error || initialError) && (
        <p role="alert" className={styles.error}>
          {state.error ?? initialError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className={styles.submit}>
        {isPending ? "Entrando..." : "Entrar"}
        {!isPending && <ArrowRight size={18} aria-hidden="true" />}
      </Button>
    </form>
  );
}
