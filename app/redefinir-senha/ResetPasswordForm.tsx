"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { updatePassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = { success: false, error: null };

export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState(updatePassword, initialState);

  if (state.success) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-card-foreground">Senha redefinida com sucesso.</p>
        <Link href="/login" className="text-sm text-primary hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="password" className="block mb-1.5 text-foreground">
          Nova senha
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="••••••••"
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block mb-1.5 text-foreground">
          Confirmar nova senha
        </label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="••••••••"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Salvando..." : "Salvar nova senha"}
      </Button>
    </form>
  );
}
