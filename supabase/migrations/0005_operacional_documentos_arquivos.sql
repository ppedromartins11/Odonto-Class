-- Migration 0005: retornos, tarefas, documentos e arquivos privados.
-- Aditiva: migrations 0001-0004 permanecem imutaveis.

begin;

create type public.status_retorno as enum ('pendente', 'agendado', 'concluido', 'cancelado');
create type public.status_tarefa as enum ('pendente', 'concluida', 'cancelada');
create type public.tipo_documento as enum ('atestado', 'declaracao');
create type public.categoria_arquivo_paciente as enum ('administrativo', 'clinico');
create type public.status_arquivo_paciente as enum ('ativo', 'removido');

create table public.retornos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  atendimento_origem_id uuid references public.atendimentos(id) on delete restrict,
  profissional_id uuid references public.profissionais(id) on delete restrict,
  data_prevista date not null,
  status public.status_retorno not null default 'pendente',
  observacao_administrativa text,
  agendamento_id uuid unique references public.agendamentos(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint retornos_observacao_valida check (observacao_administrativa is null or (observacao_administrativa = btrim(observacao_administrativa) and char_length(observacao_administrativa) between 1 and 1000)),
  constraint retornos_agendado_consistente check ((status = 'agendado' and agendamento_id is not null) or (status <> 'agendado'))
);

create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  status public.status_tarefa not null default 'pendente',
  prazo date,
  responsavel_id uuid not null references public.usuarios(id) on delete restrict,
  paciente_id uuid references public.pacientes(id) on delete restrict,
  agendamento_id uuid references public.agendamentos(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint tarefas_titulo_valido check (titulo = btrim(titulo) and char_length(titulo) between 2 and 200),
  constraint tarefas_descricao_valida check (descricao is null or (descricao = btrim(descricao) and char_length(descricao) between 1 and 2000))
);

create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  profissional_id uuid not null references public.profissionais(id) on delete restrict,
  tipo public.tipo_documento not null,
  emitido_em date not null default current_date,
  periodo_inicio date,
  periodo_fim date,
  texto_adicional text,
  storage_path text not null unique,
  nome_arquivo text not null,
  tamanho_bytes integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint documentos_periodo_valido check (periodo_fim is null or periodo_inicio is null or periodo_fim >= periodo_inicio),
  constraint documentos_texto_valido check (texto_adicional is null or (texto_adicional = btrim(texto_adicional) and char_length(texto_adicional) between 1 and 2000)),
  constraint documentos_path_seguro check (storage_path ~ '^[0-9a-f-]{36}/documentos/[0-9a-f-]{36}\.pdf$'),
  constraint documentos_nome_valido check (nome_arquivo = btrim(nome_arquivo) and char_length(nome_arquivo) between 5 and 255),
  constraint documentos_tamanho_valido check (tamanho_bytes > 0 and tamanho_bytes <= 10485760)
);

create table public.arquivos_paciente (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete restrict,
  storage_path text not null unique,
  nome_original text not null,
  mime_type text not null,
  tamanho_bytes integer not null,
  categoria public.categoria_arquivo_paciente not null,
  status public.status_arquivo_paciente not null default 'ativo',
  removido_em timestamptz,
  removido_por uuid references public.usuarios(id) on delete restrict,
  uploaded_by uuid not null references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.usuarios(id) on delete restrict,
  constraint arquivos_path_seguro check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'),
  constraint arquivos_nome_valido check (nome_original = btrim(nome_original) and char_length(nome_original) between 1 and 255),
  constraint arquivos_mime_valido check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  constraint arquivos_tamanho_valido check (tamanho_bytes > 0 and tamanho_bytes <= 10485760),
  constraint arquivos_remocao_consistente check ((status = 'ativo' and removido_em is null and removido_por is null) or (status = 'removido' and removido_em is not null and removido_por is not null))
);

create index retornos_pendentes_idx on public.retornos(status, data_prevista, id);
create index retornos_paciente_idx on public.retornos(paciente_id, data_prevista desc, id);
create index tarefas_responsavel_idx on public.tarefas(responsavel_id, status, prazo, id);
create index tarefas_paciente_idx on public.tarefas(paciente_id, created_at desc, id);
create index documentos_paciente_idx on public.documentos(paciente_id, emitido_em desc, id);
create index arquivos_paciente_idx on public.arquivos_paciente(paciente_id, categoria, status, created_at desc, id);

create trigger retornos_set_updated_at before update on public.retornos for each row execute function public.set_updated_at();
create trigger tarefas_set_updated_at before update on public.tarefas for each row execute function public.set_updated_at();
create trigger documentos_set_updated_at before update on public.documentos for each row execute function public.set_updated_at();
create trigger arquivos_paciente_set_updated_at before update on public.arquivos_paciente for each row execute function public.set_updated_at();

create function public.can_access_clinical_patient(p_paciente_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_active_dentist() and exists (
    select 1 from public.atendimentos a where a.paciente_id = p_paciente_id and a.profissional_id = public.current_professional_id()
    union all
    select 1 from public.agendamentos a where a.paciente_id = p_paciente_id and a.profissional_id = public.current_professional_id()
  );
$$;

create function public.can_manage_operational()
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_admin() or public.is_active_reception();
$$;

revoke execute on function public.can_access_clinical_patient(uuid) from public, anon;
revoke execute on function public.can_manage_operational() from public, anon;
grant execute on function public.can_access_clinical_patient(uuid), public.can_manage_operational() to authenticated;

alter table public.retornos enable row level security;
alter table public.tarefas enable row level security;
alter table public.documentos enable row level security;
alter table public.arquivos_paciente enable row level security;

create policy retornos_select on public.retornos for select to authenticated using (
  public.is_active_user() and (public.can_manage_operational() or (public.is_active_dentist() and profissional_id = public.current_professional_id()))
);
create policy tarefas_select on public.tarefas for select to authenticated using (
  public.is_active_user() and (public.can_manage_operational() or responsavel_id = auth.uid() or created_by = auth.uid())
);
create policy documentos_select on public.documentos for select to authenticated using (
  public.is_active_user() and (public.can_manage_operational() or (public.is_active_dentist() and profissional_id = public.current_professional_id()))
);
create policy arquivos_select on public.arquivos_paciente for select to authenticated using (
  public.is_active_user() and ((categoria = 'administrativo' and public.can_manage_operational()) or (categoria = 'clinico' and public.can_access_clinical_patient(paciente_id)))
);

revoke insert, update, delete on public.retornos, public.tarefas, public.documentos, public.arquivos_paciente from anon, authenticated;
grant select on public.retornos, public.tarefas, public.documentos, public.arquivos_paciente to authenticated;
grant all on public.retornos, public.tarefas, public.documentos, public.arquivos_paciente to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arquivos-paciente', 'arquivos-paciente', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

-- Nenhuma policy e concedida a anon/authenticated em storage.objects: acesso ao
-- bucket privado ocorre apenas por Server Actions autorizadas e signed URLs curtas.

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in (
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada',
  'paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados',
  'agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido',
  'atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado',
  'retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado',
  'tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada',
  'documento_criado','arquivo_enviado','arquivo_removido'
));

create function public.list_active_task_assignees()
returns table(id uuid, nome text, perfil public.perfil_usuario)
language sql security definer set search_path = '' stable as $$
  select u.id, u.nome, u.perfil from public.usuarios u where public.is_active_user() and u.status = 'ativo'::public.status_usuario order by u.nome;
$$;

create function public.create_return(p_atendimento_id uuid, p_data_prevista date, p_observacao_administrativa text default null)
returns public.retornos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_prof uuid := public.current_professional_id(); v_att public.atendimentos%rowtype; v_result public.retornos%rowtype; v_note text := nullif(btrim(p_observacao_administrativa), '');
begin
 if v_prof is null then raise exception 'Acesso clinico negado.' using errcode='42501'; end if;
 if p_data_prevista is null or p_data_prevista < current_date then raise exception 'Data prevista invalida.' using errcode='22023'; end if;
 select * into v_att from public.atendimentos where id=p_atendimento_id for update;
 if not found or v_att.profissional_id <> v_prof then raise exception 'Atendimento inacessivel.' using errcode='42501'; end if;
 insert into public.retornos(paciente_id,atendimento_origem_id,profissional_id,data_prevista,observacao_administrativa,created_by,updated_by) values(v_att.paciente_id,v_att.id,v_prof,p_data_prevista,v_note,v_actor,v_actor) returning * into v_result;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'retorno_criado','retornos',v_result.id,jsonb_build_object('paciente_id',v_result.paciente_id,'atendimento_origem_id',v_att.id,'data_prevista',v_result.data_prevista));
 return v_result;
end; $$;

create function public.link_return_appointment(p_retorno_id uuid, p_agendamento_id uuid)
returns public.retornos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_before public.retornos%rowtype; v_appt public.agendamentos%rowtype; v_after public.retornos%rowtype;
begin
 if not public.can_manage_operational() then raise exception 'Acesso operacional negado.' using errcode='42501'; end if;
 select * into v_before from public.retornos where id=p_retorno_id for update; if not found then raise exception 'Retorno nao encontrado.' using errcode='P0002'; end if;
 if v_before.status in ('concluido','cancelado') then raise exception 'Retorno encerrado.' using errcode='23514'; end if;
 select * into v_appt from public.agendamentos where id=p_agendamento_id for update; if not found or v_appt.paciente_id <> v_before.paciente_id then raise exception 'Agendamento invalido.' using errcode='23514'; end if;
 update public.retornos set agendamento_id=v_appt.id,status='agendado',updated_by=v_actor where id=v_before.id returning * into v_after;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'retorno_agendado','retornos',v_after.id,jsonb_build_object('agendamento_id',v_appt.id)); return v_after;
end; $$;

create function public.set_return_status(p_retorno_id uuid, p_status public.status_retorno, p_observacao_administrativa text default null)
returns public.retornos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_before public.retornos%rowtype; v_after public.retornos%rowtype; v_event text; v_note text:=nullif(btrim(p_observacao_administrativa),'');
begin
 if not public.can_manage_operational() then raise exception 'Acesso operacional negado.' using errcode='42501'; end if;
 if p_status not in ('concluido','cancelado') then raise exception 'Status invalido.' using errcode='22023'; end if;
 select * into v_before from public.retornos where id=p_retorno_id for update; if not found or v_before.status in ('concluido','cancelado') then raise exception 'Retorno inacessivel.' using errcode='P0002'; end if;
 v_event:=case when p_status='concluido' then 'retorno_concluido' else 'retorno_cancelado' end;
 update public.retornos set status=p_status,observacao_administrativa=coalesce(v_note,observacao_administrativa),updated_by=v_actor where id=v_before.id returning * into v_after;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,v_event,'retornos',v_after.id,jsonb_build_object('status_anterior',v_before.status,'status_novo',v_after.status)); return v_after;
end; $$;

create function public.resolve_return_when_appointment_attended()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_return_id uuid;
begin
  if new.status = 'atendido'::public.status_agendamento and old.status is distinct from new.status then
    update public.retornos set status = 'concluido', updated_by = new.updated_by
    where agendamento_id = new.id and status = 'agendado'::public.status_retorno
    returning id into v_return_id;
    if v_return_id is not null then
      insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
      values (new.updated_by, 'retorno_concluido', 'retornos', v_return_id, jsonb_build_object('agendamento_id', new.id, 'origem', 'atendimento_finalizado'));
    end if;
  end if;
  return new;
end; $$;
create trigger agendamentos_resolve_return_after_attended
after update of status on public.agendamentos
for each row execute function public.resolve_return_when_appointment_attended();

create function public.create_task(p_titulo text,p_descricao text,p_prazo date,p_responsavel_id uuid,p_paciente_id uuid default null,p_agendamento_id uuid default null)
returns public.tarefas language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_result public.tarefas%rowtype;
begin
 if not public.is_active_user() then raise exception 'Usuario inativo.' using errcode='42501'; end if;
 if not exists(select 1 from public.usuarios where id=p_responsavel_id and status='ativo') then raise exception 'Responsavel invalido.' using errcode='23514'; end if;
 if p_paciente_id is not null and not exists(select 1 from public.pacientes where id=p_paciente_id and ativo) then raise exception 'Paciente invalido.' using errcode='23514'; end if;
 insert into public.tarefas(titulo,descricao,prazo,responsavel_id,paciente_id,agendamento_id,created_by,updated_by) values(btrim(coalesce(p_titulo,'')),nullif(btrim(p_descricao),''),p_prazo,p_responsavel_id,p_paciente_id,p_agendamento_id,v_actor,v_actor) returning * into v_result;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'tarefa_criada','tarefas',v_result.id,jsonb_build_object('responsavel_id',v_result.responsavel_id,'paciente_id',v_result.paciente_id)); return v_result;
end; $$;

create function public.set_task_status(p_tarefa_id uuid,p_status public.status_tarefa)
returns public.tarefas language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_before public.tarefas%rowtype; v_after public.tarefas%rowtype; v_event text;
begin
 select * into v_before from public.tarefas where id=p_tarefa_id for update; if not found then raise exception 'Tarefa nao encontrada.' using errcode='P0002'; end if;
 if not public.can_manage_operational() and v_before.responsavel_id<>v_actor and v_before.created_by<>v_actor then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_status not in ('concluida','cancelada') or v_before.status<>'pendente' then raise exception 'Transicao invalida.' using errcode='23514'; end if;
 v_event:=case when p_status='concluida' then 'tarefa_concluida' else 'tarefa_cancelada' end;
 update public.tarefas set status=p_status,updated_by=v_actor where id=v_before.id returning * into v_after;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,v_event,'tarefas',v_after.id,jsonb_build_object('status_anterior',v_before.status,'status_novo',v_after.status)); return v_after;
end; $$;

create function public.create_document_metadata(p_paciente_id uuid,p_profissional_id uuid,p_tipo public.tipo_documento,p_emitido_em date,p_periodo_inicio date,p_periodo_fim date,p_texto_adicional text,p_storage_path text,p_nome_arquivo text,p_tamanho_bytes integer)
returns public.documentos language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_prof uuid:=public.current_professional_id(); v_result public.documentos%rowtype;
begin
 if not public.can_manage_operational() and v_prof is distinct from p_profissional_id then raise exception 'Emissor nao autorizado.' using errcode='42501'; end if;
 if not exists(select 1 from public.pacientes where id=p_paciente_id and ativo) then raise exception 'Paciente invalido.' using errcode='23514'; end if;
 if not exists(select 1 from public.profissionais where id=p_profissional_id and status='ativo') then raise exception 'Profissional invalido.' using errcode='23514'; end if;
 insert into public.documentos(paciente_id,profissional_id,tipo,emitido_em,periodo_inicio,periodo_fim,texto_adicional,storage_path,nome_arquivo,tamanho_bytes,created_by,updated_by) values(p_paciente_id,p_profissional_id,p_tipo,coalesce(p_emitido_em,current_date),p_periodo_inicio,p_periodo_fim,nullif(btrim(p_texto_adicional),''),p_storage_path,btrim(p_nome_arquivo),p_tamanho_bytes,v_actor,v_actor) returning * into v_result;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'documento_criado','documentos',v_result.id,jsonb_build_object('paciente_id',p_paciente_id,'tipo',p_tipo)); return v_result;
end; $$;

create function public.create_patient_file_metadata(p_paciente_id uuid,p_storage_path text,p_nome_original text,p_mime_type text,p_tamanho_bytes integer,p_categoria public.categoria_arquivo_paciente)
returns public.arquivos_paciente language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_result public.arquivos_paciente%rowtype;
begin
 if not public.is_active_user() then raise exception 'Usuario inativo.' using errcode='42501'; end if;
 if p_categoria='administrativo' and not public.can_manage_operational() then raise exception 'Acesso administrativo negado.' using errcode='42501'; end if;
 if p_categoria='clinico' and not public.can_access_clinical_patient(p_paciente_id) then raise exception 'Acesso clinico negado.' using errcode='42501'; end if;
 insert into public.arquivos_paciente(paciente_id,storage_path,nome_original,mime_type,tamanho_bytes,categoria,uploaded_by,updated_by) values(p_paciente_id,p_storage_path,btrim(p_nome_original),p_mime_type,p_tamanho_bytes,p_categoria,v_actor,v_actor) returning * into v_result;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'arquivo_enviado','arquivos_paciente',v_result.id,jsonb_build_object('paciente_id',p_paciente_id,'categoria',p_categoria,'mime_type',p_mime_type,'tamanho_bytes',p_tamanho_bytes)); return v_result;
end; $$;

create function public.soft_delete_patient_file(p_arquivo_id uuid)
returns public.arquivos_paciente language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_before public.arquivos_paciente%rowtype; v_after public.arquivos_paciente%rowtype;
begin
 select * into v_before from public.arquivos_paciente where id=p_arquivo_id for update; if not found or v_before.status<>'ativo' then raise exception 'Arquivo inacessivel.' using errcode='P0002'; end if;
 if (v_before.categoria='administrativo' and not public.can_manage_operational()) or (v_before.categoria='clinico' and not public.can_access_clinical_patient(v_before.paciente_id)) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 update public.arquivos_paciente set status='removido',removido_em=now(),removido_por=v_actor,updated_by=v_actor where id=v_before.id returning * into v_after;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'arquivo_removido','arquivos_paciente',v_after.id,jsonb_build_object('paciente_id',v_after.paciente_id,'categoria',v_after.categoria)); return v_after;
end; $$;

revoke execute on function public.list_active_task_assignees(), public.create_return(uuid,date,text), public.link_return_appointment(uuid,uuid), public.set_return_status(uuid,public.status_retorno,text), public.create_task(text,text,date,uuid,uuid,uuid), public.set_task_status(uuid,public.status_tarefa), public.create_document_metadata(uuid,uuid,public.tipo_documento,date,date,date,text,text,text,integer), public.create_patient_file_metadata(uuid,text,text,text,integer,public.categoria_arquivo_paciente), public.soft_delete_patient_file(uuid) from public, anon;
grant execute on function public.list_active_task_assignees(), public.create_return(uuid,date,text), public.link_return_appointment(uuid,uuid), public.set_return_status(uuid,public.status_retorno,text), public.create_task(text,text,date,uuid,uuid,uuid), public.set_task_status(uuid,public.status_tarefa), public.create_document_metadata(uuid,uuid,public.tipo_documento,date,date,date,text,text,text,integer), public.create_patient_file_metadata(uuid,text,text,text,integer,public.categoria_arquivo_paciente), public.soft_delete_patient_file(uuid) to authenticated;
alter default privileges in schema public revoke execute on functions from public;

commit;
