import { Shield, User, Phone } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { NovoUsuarioDialog } from "./NovoUsuarioDialog";
import type { PerfilUsuario } from "@/lib/auth/session";

/**
 * Adaptado de src/app/components/screens/Usuarios.tsx do prototipo.
 * Diferencas deliberadas em relacao ao prototipo:
 *  - Dados reais (Supabase), nao mock.
 *  - Colunas "Telefone" e "Ultimo acesso" removidas - nao existem no
 *    schema aprovado (docs/DATABASE.md); adicionar exigiria inventar
 *    requisito.
 *  - Botao de acoes "..." removido - editar/desativar usuario nao e
 *    parte desta sprint, e um botao sem funcao real seria a mesma
 *    "funcionalidade ficticia" que foi pedido para evitar no header.
 *  - Bloco "Permissoes por perfil" mantido como referencia ilustrativa
 *    (texto estatico, como no prototipo) - o RBAC de verdade esta na
 *    RLS do banco, nao aqui.
 */

const ROLE_CONFIG: Record<
  PerfilUsuario,
  { label: string; className: string; icon: typeof Shield }
> = {
  administrador: { label: "Administrador", className: "bg-violet-50 text-violet-700", icon: Shield },
  dentista: { label: "Dentista", className: "bg-blue-50 text-blue-700", icon: User },
  recepcao: { label: "Recepção", className: "bg-emerald-50 text-emerald-700", icon: Phone },
};

const PERMISSOES_REFERENCIA = [
  {
    role: "Administrador",
    perms: ["Acesso total ao sistema", "Gerenciar usuários", "Todos os módulos disponíveis"],
  },
  {
    role: "Dentista",
    perms: ["Agenda própria (quando existir)", "Prontuário clínico", "Atendimentos"],
  },
  {
    role: "Recepção",
    perms: ["Agenda completa (quando existir)", "Cadastro de pacientes", "Documentos"],
  },
];

function initials(nome: string) {
  const parts = nome.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default async function UsuariosPage() {
  await requireAdmin();

  const supabase = await createSupabaseServerClient();
  const { data: usuarios, error } = await supabase
    .from("usuarios")
    .select("id, nome, email, perfil, status")
    .order("nome");

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar os usuários: {error.message}
      </p>
    );
  }

  const lista = usuarios ?? [];
  const ativos = lista.filter((u) => u.status === "ativo");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-medium text-foreground">Usuários</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {ativos.length} usuário{ativos.length === 1 ? "" : "s"} ativo
            {ativos.length === 1 ? "" : "s"}
          </p>
        </div>
        <NovoUsuarioDialog />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {(Object.keys(ROLE_CONFIG) as PerfilUsuario[]).map((perfil) => {
          const count = ativos.filter((u) => u.perfil === perfil).length;
          const cfg = ROLE_CONFIG[perfil];
          const Icon = cfg.icon;
          return (
            <div
              key={perfil}
              className="bg-card border border-border rounded-lg p-4 flex items-center gap-3"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cfg.className}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{cfg.label}</p>
                <p className="text-lg font-semibold text-foreground">{count}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {lista.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">
            Nenhum usuário cadastrado ainda.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Usuário
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Perfil
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.map((usuario) => {
                const cfg = ROLE_CONFIG[usuario.perfil as PerfilUsuario];
                const Icon = cfg.icon;
                return (
                  <tr key={usuario.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-primary">
                            {initials(usuario.nome)}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{usuario.nome}</p>
                          <p className="text-xs text-muted-foreground">{usuario.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${cfg.className}`}
                      >
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={usuario.status === "ativo" ? "success" : "neutral"}>
                        {usuario.status === "ativo" ? "Ativo" : "Inativo"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-6 bg-card border border-border rounded-lg p-5">
        <h4 className="mb-4 text-base font-medium text-foreground">Permissões por perfil</h4>
        <p className="text-xs text-muted-foreground mb-4">
          Referência ilustrativa. O controle de acesso real é aplicado no banco
          de dados (RLS) - ver docs/SECURITY.md.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {PERMISSOES_REFERENCIA.map((item) => (
            <div key={item.role} className="space-y-2">
              <p className="text-sm font-medium text-foreground">{item.role}</p>
              <ul className="space-y-1">
                {item.perms.map((perm) => (
                  <li key={perm} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
