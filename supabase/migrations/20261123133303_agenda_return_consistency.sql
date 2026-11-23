-- A1: uma chamada cria a consulta e vincula o retorno na mesma transacao.
-- Migrations 0004, 0005 e 0030 permanecem imutaveis.
begin;

alter table public.agendamentos add column request_id uuid;
create unique index agendamentos_request_id_unique
  on public.agendamentos (request_id) where request_id is not null;

-- Nao corrigir historico potencialmente inconsistente sem revisao nominal.
do $$
begin
  if exists (
    select 1 from public.retornos r
    join public.agendamentos a on a.id = r.agendamento_id
    where a.paciente_id <> r.paciente_id
      or (r.status = 'agendado' and a.status not in ('agendado', 'confirmado'))
  ) then
    raise exception 'A1_PREEXISTING_RETURN_INCONSISTENCY' using errcode = '23514';
  end if;
end;
$$;

-- Um retorno nao pode ser transferido silenciosamente para outra consulta.
create or replace function public.link_return_appointment(p_retorno_id uuid, p_agendamento_id uuid)
returns public.retornos language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_before public.retornos%rowtype;
  v_appt public.agendamentos%rowtype;
  v_after public.retornos%rowtype;
begin
  if not public.can_manage_operational() then
    raise exception 'Acesso operacional negado.' using errcode = '42501';
  end if;
  -- A agenda e bloqueada antes do retorno, como no cancelamento/falta.
  select * into v_appt from public.agendamentos where id = p_agendamento_id for update;
  if not found or v_appt.status not in ('agendado', 'confirmado') then
    raise exception 'Agendamento invalido.' using errcode = '23514';
  end if;
  select * into v_before from public.retornos where id = p_retorno_id for update;
  if not found then
    raise exception 'Retorno nao encontrado.' using errcode = 'P0002';
  end if;
  if v_appt.paciente_id <> v_before.paciente_id then
    raise exception 'Agendamento de outro paciente.' using errcode = '23514';
  end if;
  if v_before.status = 'agendado' and v_before.agendamento_id = v_appt.id then
    return v_before;
  end if;
  if v_before.status not in ('pendente', 'agendado') then
    raise exception 'RETURN_NOT_PENDING' using errcode = '23514';
  end if;
  if v_before.status <> 'pendente' or v_before.agendamento_id is not null then
    raise exception 'RETURN_ALREADY_SCHEDULED' using errcode = '23514';
  end if;
  update public.retornos
  set agendamento_id = v_appt.id, status = 'agendado', updated_by = v_actor
  where id = v_before.id returning * into v_after;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (v_actor, 'retorno_agendado', 'retornos', v_after.id,
    jsonb_build_object('agendamento_id', v_appt.id));
  return v_after;
end;
$$;

revoke execute on function public.link_return_appointment(uuid, uuid) from public, anon;
grant execute on function public.link_return_appointment(uuid, uuid) to authenticated;

create function public.create_appointment_consistent(
  p_request_id uuid,
  p_paciente_id uuid,
  p_profissional_id uuid,
  p_inicio_local timestamp without time zone,
  p_fim_local timestamp without time zone,
  p_observacoes_administrativas text default null,
  p_retorno_id uuid default null
)
returns public.agendamentos language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.agendamentos%rowtype;
  v_appointment public.agendamentos%rowtype;
  v_return public.retornos%rowtype;
  v_inicio timestamptz := p_inicio_local at time zone 'America/Cuiaba';
  v_fim timestamptz := p_fim_local at time zone 'America/Cuiaba';
  v_note text := nullif(btrim(p_observacoes_administrativas), '');
begin
  if not (public.is_admin() or public.is_active_reception()) then
    raise exception 'Acesso administrativo a agenda negado.' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Chave da solicitacao invalida.' using errcode = '22023';
  end if;

  -- Mesmo token, mesmo resultado; espera a transacao anterior terminar.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select * into v_existing from public.agendamentos
  where request_id = p_request_id for update;
  if found then
    if v_existing.created_by <> v_actor then
      raise exception 'Solicitacao de outro usuario.' using errcode = '42501';
    end if;
    if v_existing.status in ('cancelado', 'faltou') then
      raise exception 'Consulta encerrada.' using errcode = '23514';
    end if;
    if v_existing.paciente_id is distinct from p_paciente_id
      or v_existing.profissional_id is distinct from p_profissional_id
      or v_existing.inicio is distinct from v_inicio
      or v_existing.fim is distinct from v_fim
      or v_existing.observacoes_administrativas is distinct from v_note
      or (p_retorno_id is null and exists (
        select 1 from public.retornos where agendamento_id = v_existing.id
      ))
      then
      raise exception 'Solicitacao alterada ou retorno desvinculado.' using errcode = '23514';
    end if;
    if p_retorno_id is not null then
      select * into v_return from public.retornos where id = p_retorno_id for update;
      if not found or v_return.agendamento_id is distinct from v_existing.id
        or v_return.status <> 'agendado' then
        raise exception 'RETURN_NOT_PENDING' using errcode = '23514';
      end if;
    end if;
    return v_existing;
  end if;

  if p_retorno_id is not null then
    select * into v_return from public.retornos where id = p_retorno_id for update;
    if not found then
      raise exception 'Retorno nao encontrado.' using errcode = 'P0002';
    end if;
    if v_return.status not in ('pendente', 'agendado') then
      raise exception 'RETURN_NOT_PENDING' using errcode = '23514';
    end if;
    if v_return.status <> 'pendente' or v_return.agendamento_id is not null then
      raise exception 'RETURN_ALREADY_SCHEDULED' using errcode = '23514';
    end if;
    if v_return.paciente_id <> p_paciente_id then
      raise exception 'Retorno de outro paciente.' using errcode = '23514';
    end if;
  end if;

  -- Funcoes existentes preservam validacao de horario, paciente/profissional,
  -- conflito GiST, autorizacao e auditoria. Erro posterior reverte tudo.
  v_appointment := public.create_appointment(
    p_paciente_id, p_profissional_id, p_inicio_local, p_fim_local,
    p_observacoes_administrativas
  );
  update public.agendamentos set request_id = p_request_id
  where id = v_appointment.id returning * into v_appointment;
  if p_retorno_id is not null then
    perform public.link_return_appointment(p_retorno_id, v_appointment.id);
  end if;
  return v_appointment;
end;
$$;

revoke execute on function public.create_appointment_consistent(uuid, uuid, uuid, timestamp without time zone, timestamp without time zone, text, uuid) from public, anon;
grant execute on function public.create_appointment_consistent(uuid, uuid, uuid, timestamp without time zone, timestamp without time zone, text, uuid) to authenticated;

-- Consulta ligada nao pode ser transferida a outro paciente.
create function public.prevent_linked_appointment_patient_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.paciente_id is distinct from new.paciente_id and exists (
    select 1 from public.retornos
    where agendamento_id = old.id
  ) then
    raise exception 'Consulta vinculada a retorno nao pode trocar paciente.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger agendamentos_prevent_linked_patient_change
before update of paciente_id on public.agendamentos
for each row execute function public.prevent_linked_appointment_patient_change();

-- Cancelamento/falta liberam o retorno para novo agendamento atomicamente.
create function public.release_return_on_appointment_close()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_return_id uuid;
begin
  if new.status in ('cancelado', 'faltou') and old.status is distinct from new.status then
    update public.retornos
    set status = 'pendente', agendamento_id = null, updated_by = new.updated_by
    where agendamento_id = new.id and status = 'agendado'
    returning id into v_return_id;
    if v_return_id is not null then
      insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
      values (new.updated_by, 'retorno_atualizado', 'retornos', v_return_id,
        jsonb_build_object('agendamento_id_anterior', new.id,
          'status_novo', 'pendente', 'origem', 'agendamento_encerrado'));
    end if;
  end if;
  return new;
end;
$$;
create trigger agendamentos_release_return_after_close
after update of status on public.agendamentos
for each row execute function public.release_return_on_appointment_close();

revoke execute on function public.prevent_linked_appointment_patient_change(),
  public.release_return_on_appointment_close() from public, anon, authenticated;

commit;
