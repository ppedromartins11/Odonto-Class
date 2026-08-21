import { Cross } from "lucide-react";
import { CLINIC_NAME } from "@/lib/config/clinic";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default function RedefinirSenhaPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center mb-3">
            <Cross className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">{CLINIC_NAME}</h1>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
          <h2 className="text-base font-medium text-card-foreground mb-4">
            Definir nova senha
          </h2>
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  );
}
