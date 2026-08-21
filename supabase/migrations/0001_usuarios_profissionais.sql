-- Migration 0001: usuarios + profissionais
-- Sprint 1 - RF-01 (autenticacao) e RF-02 (usuarios e perfis).
-- Nao validado por execucao real neste ambiente (sem acesso ao Supabase
-- a partir daqui) - ver docs/DECISIONS.md.

-- ============================================================
-- Tabela: usuarios
-- Perfil de aplicacao em relacao 1:1 com auth.users (Supabase Auth).
-- ============================================================

create type perfil_usuario as enum ('administrador', 'dentista', 'recepcao');
create type status_usuario as enum ('ativo', 'inativo');

create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text not null unique,
  perfil perfil_usuario not null,
  status status_usuario not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.usuarios is
  'Perfil de aplicacao dos usuarios do sistema (RF-02). 1:1 com auth.users.';

-- ============================================================
-- Tabela: profissionais
-- ============================================================

create table public.profissionais (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references public.usuarios (id) on delete restrict,
  registro_profissional text,
  status status_usuario not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profissionais is
  'Dados especificos de profissionais (dentistas). registro_profissional (CRO) e '
  'opcional nesta fase - PONTO A VALIDAR (PAV do documento de requisitos) se e '
  'obrigatorio para todos os perfis que atendem paciente.';

-- ============================================================
-- updated_at automatico
-- ============================================================

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger usuarios_set_updated_at
  before update on public.usuarios
  for each row execute function public.set_updated_at();

create trigger profissionais_set_updated_at
  before update on public.profissionais
  for each row execute function public.set_updated_at();

-- ============================================================
-- Funcao auxiliar para RLS: is_admin()
--
-- Por que SECURITY DEFINER: uma policy em `usuarios` que consultasse a
-- propria tabela `usuarios` para saber o perfil do usuario logado
-- entraria em recursao de avaliacao de RLS. Esta funcao roda com os
-- privilegios do dono (que enxerga a tabela sem RLS), quebrando o ciclo.
-- Padrao documentado pelo proprio Supabase para RBAC auto-referenciado.
-- ============================================================

create function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid() and perfil = 'administrador' and status = 'ativo'
  );
$$;

comment on function public.is_admin() is
  'Retorna true se o usuario autenticado for administrador ativo. '
  'SECURITY DEFINER para evitar recursao de RLS em usuarios.';

-- ============================================================
-- RLS: usuarios
-- ============================================================

alter table public.usuarios enable row level security;

-- Qualquer usuario autenticado le o proprio registro.
create policy usuarios_select_own
  on public.usuarios for select
  to authenticated
  using (id = auth.uid());

-- Administrador le todos os registros.
create policy usuarios_select_admin
  on public.usuarios for select
  to authenticated
  using (public.is_admin());

-- Administrador pode atualizar qualquer registro (ex.: mudar perfil/status).
create policy usuarios_update_admin
  on public.usuarios for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Nenhuma policy de INSERT/DELETE para o role "authenticated": a criacao
-- de usuario acontece via lib/supabase/admin.ts (service role, que
-- ignora RLS), sempre depois de uma checagem explicita de admin no
-- server action (ver app/(app)/usuarios/actions.ts). Isso e proposital -
-- nunca dependemos so da UI para bloquear quem nao e admin.

-- ============================================================
-- RLS: profissionais
-- ============================================================

alter table public.profissionais enable row level security;

-- Qualquer usuario autenticado pode ver a lista de profissionais (nomes
-- sao necessarios, por exemplo, para a Agenda em sprints futuras).
create policy profissionais_select_authenticated
  on public.profissionais for select
  to authenticated
  using (true);

create policy profissionais_update_admin
  on public.profissionais for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Mesma logica do INSERT de usuarios: criacao via service role apenas.
