import { requireUser } from "@/lib/auth/session";

/**
 * Dashboard real do RF-03 (KPIs, agenda do dia, retornos, tarefas,
 * alertas) depende de modulos que ainda nao existem (Agenda, Retornos,
 * Tarefas, Validade). Copiar os cards ficticios do prototipo aqui daria
 * a impressao de funcionalidade que nao existe - por isso esta pagina,
 * nesta sprint, e so uma casca autenticada minima.
 */
export default async function DashboardPage() {
  const usuario = await requireUser();
  const primeiroNome = usuario.nome.split(" ")[0];

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-medium text-foreground">Olá, {primeiroNome}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        O painel completo (agenda do dia, retornos pendentes, tarefas e
        alertas) será implementado nas próximas sprints, conforme o
        roadmap aprovado.
      </p>
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-card-foreground">
          Por enquanto, esta é apenas uma página autenticada de verificação.
          Módulos disponíveis: <span className="font-medium">Usuários</span>.
        </p>
      </div>
    </div>
  );
}
