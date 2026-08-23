-- Migration 0003: pacientes, alertas clinicos atuais, busca e autorizacao.
-- Sprint 2 - RF-04, RF-05, RF-06 parcial, RF-20, RN-05 e RNF-01.
-- Aditiva: migrations 0001 e 0002 permanecem imutaveis.

begin;

-- Normalizacao deterministica para busca por nome, sem dependencia de
-- extensoes. A funcao remove acentos mais comuns do portugues, pontuacao e
-- espacos duplicados. O valor original continua preservado em `nome`.
create function public.normalize_patient_search(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(
        lower(p_value),
        'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
        'aaaaaaeeeeiiiiooooouuuucnyy'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

revoke execute on function public.normalize_patient_search(text)
  from public, anon, authenticated;

-- O modelo atual representa exatamente um perfil por usuario. Um dentista
-- clinicamente autorizado precisa ter perfil de dentista ativo E vinculo
-- profissional ativo. Administrador puro nao recebe acesso clinico.
create function public.is_active_dentist()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.usuarios as usuario
    join public.profissionais as profissional
      on profissional.usuario_id = usuario.id
    where usuario.id = (select auth.uid())
      and usuario.perfil = 'dentista'::public.perfil_usuario
      and usuario.status = 'ativo'::public.status_usuario
      and profissional.status = 'ativo'::public.status_usuario
  );
$$;

revoke execute on function public.is_active_dentist() from public, anon;
grant execute on function public.is_active_dentist() to authenticated;

create table public.pacientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  data_nascimento date,
  telefone_contato text,
  documento_identificacao text,
  ativo boolean not null default true,
  nome_busca text generated always as (
    public.normalize_patient_search(nome)
  ) stored,
  telefone_busca text generated always as (
    regexp_replace(coalesce(telefone_contato, ''), '[^0-9]+', '', 'g')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios (id) on delete restrict,
  updated_by uuid not null references public.usuarios (id) on delete restrict,
  constraint pacientes_nome_valid check (
    nome = btrim(nome) and char_length(nome) between 2 and 200
  ),
  constraint pacientes_data_nascimento_valid check (
    data_nascimento is null or data_nascimento <= current_date
  ),
  constraint pacientes_telefone_contato_valid check (
    telefone_contato is null
    or (
      telefone_contato = btrim(telefone_contato)
      and char_length(telefone_contato) between 1 and 30
    )
  ),
  constraint pacientes_documento_identificacao_valid check (
    documento_identificacao is null
    or (
      documento_identificacao = btrim(documento_identificacao)
      and char_length(documento_identificacao) between 1 and 80
    )
  )
);

comment on table public.pacientes is
  'Cadastro administrativo de pacientes (RF-04/RF-05). Sem exclusao fisica pela aplicacao.';
comment on column public.pacientes.nome_busca is
  'Valor interno normalizado para busca acento-insensivel; nao substitui o nome original.';
comment on column public.pacientes.telefone_busca is
  'Somente digitos para comparacao; o telefone original permanece em telefone_contato.';

create table public.paciente_alertas_clinicos (
  paciente_id uuid primary key references public.pacientes (id) on delete restrict,
  alergias text,
  intolerancias text,
  medicamentos_em_uso text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios (id) on delete restrict,
  updated_by uuid not null references public.usuarios (id) on delete restrict,
  constraint paciente_alertas_alergias_valid check (
    alergias is null
    or (alergias = btrim(alergias) and char_length(alergias) between 1 and 2000)
  ),
  constraint paciente_alertas_intolerancias_valid check (
    intolerancias is null
    or (
      intolerancias = btrim(intolerancias)
      and char_length(intolerancias) between 1 and 2000
    )
  ),
  constraint paciente_alertas_medicamentos_valid check (
    medicamentos_em_uso is null
    or (
      medicamentos_em_uso = btrim(medicamentos_em_uso)
      and char_length(medicamentos_em_uso) between 1 and 2000
    )
  )
);

comment on table public.paciente_alertas_clinicos is
  'Retrato clinico atual do paciente. Nao e prontuario nem historico longitudinal.';

create index pacientes_ativo_nome_idx
  on public.pacientes (ativo, nome, id);

create trigger pacientes_set_updated_at
  before update on public.pacientes
  for each row execute function public.set_updated_at();

create trigger paciente_alertas_set_updated_at
  before update on public.paciente_alertas_clinicos
  for each row execute function public.set_updated_at();

alter table public.pacientes enable row level security;
alter table public.paciente_alertas_clinicos enable row level security;

create policy pacientes_select_active_user
  on public.pacientes for select
  to authenticated
  using ((select public.is_active_user()));

create policy paciente_alertas_select_active_dentist
  on public.paciente_alertas_clinicos for select
  to authenticated
  using ((select public.is_active_dentist()));

revoke insert, update, delete on public.pacientes from anon, authenticated;
revoke insert, update, delete on public.paciente_alertas_clinicos
  from anon, authenticated;
grant select on public.pacientes to authenticated;
grant select on public.paciente_alertas_clinicos to authenticated;
grant all on public.pacientes to service_role;
grant all on public.paciente_alertas_clinicos to service_role;

-- Mantem a lista de eventos fechada sem editar a migration homologada 0002.
alter table public.auditoria
  drop constraint if exists auditoria_evento_check;

alter table public.auditoria
  add constraint auditoria_evento_check check (
    evento in (
      'usuario_convidado',
      'convite_aceito',
      'usuario_ativado',
      'usuario_desativado',
      'perfil_alterado',
      'acao_administrativa_negada',
      'senha_redefinida',
      'configuracao_acesso_alterada',
      'paciente_criado',
      'paciente_atualizado',
      'paciente_inativado',
      'paciente_reativado',
      'alertas_clinicos_atualizados'
    )
  );

create function public.create_patient(
  p_nome text,
  p_data_nascimento date default null,
  p_telefone_contato text default null,
  p_documento_identificacao text default null,
  p_alergias text default null,
  p_intolerancias text default null,
  p_medicamentos_em_uso text default null
)
returns public.pacientes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_patient public.pacientes%rowtype;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_telefone text := nullif(btrim(p_telefone_contato), '');
  v_documento text := nullif(btrim(p_documento_identificacao), '');
  v_alergias text := nullif(btrim(p_alergias), '');
  v_intolerancias text := nullif(btrim(p_intolerancias), '');
  v_medicamentos text := nullif(btrim(p_medicamentos_em_uso), '');
  v_has_clinical_data boolean;
begin
  if not public.is_active_user() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  v_has_clinical_data := v_alergias is not null
    or v_intolerancias is not null
    or v_medicamentos is not null;

  if v_has_clinical_data and not public.is_active_dentist() then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;

  insert into public.pacientes (
    nome,
    data_nascimento,
    telefone_contato,
    documento_identificacao,
    created_by,
    updated_by
  ) values (
    v_nome,
    p_data_nascimento,
    v_telefone,
    v_documento,
    v_actor_id,
    v_actor_id
  )
  returning * into v_patient;

  insert into public.paciente_alertas_clinicos (
    paciente_id,
    alergias,
    intolerancias,
    medicamentos_em_uso,
    created_by,
    updated_by
  ) values (
    v_patient.id,
    v_alergias,
    v_intolerancias,
    v_medicamentos,
    v_actor_id,
    v_actor_id
  );

  insert into public.auditoria (
    usuario_id, evento, entidade, entidade_id, dados
  ) values (
    v_actor_id,
    'paciente_criado',
    'pacientes',
    v_patient.id,
    jsonb_build_object(
      'campos_preenchidos', to_jsonb(array_remove(array[
        'nome',
        case when p_data_nascimento is not null then 'data_nascimento' end,
        case when v_telefone is not null then 'telefone_contato' end,
        case when v_documento is not null then 'documento_identificacao' end
      ]::text[], null))
    )
  );

  if v_has_clinical_data then
    insert into public.auditoria (
      usuario_id, evento, entidade, entidade_id, dados
    ) values (
      v_actor_id,
      'alertas_clinicos_atualizados',
      'paciente_alertas_clinicos',
      v_patient.id,
      jsonb_build_object(
        'campos_alterados', to_jsonb(array_remove(array[
          case when v_alergias is not null then 'alergias' end,
          case when v_intolerancias is not null then 'intolerancias' end,
          case when v_medicamentos is not null then 'medicamentos_em_uso' end
        ]::text[], null))
      )
    );
  end if;

  return v_patient;
end;
$$;

create function public.update_patient(
  p_paciente_id uuid,
  p_nome text,
  p_data_nascimento date default null,
  p_telefone_contato text default null,
  p_documento_identificacao text default null
)
returns public.pacientes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_before public.pacientes%rowtype;
  v_after public.pacientes%rowtype;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_telefone text := nullif(btrim(p_telefone_contato), '');
  v_documento text := nullif(btrim(p_documento_identificacao), '');
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if not public.is_active_user() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into v_before
  from public.pacientes
  where id = p_paciente_id
  for update;

  if not found then
    raise exception 'Paciente nao encontrado.' using errcode = 'P0002';
  end if;

  if v_before.nome is distinct from v_nome then
    v_changed_fields := v_changed_fields || jsonb_build_array('nome');
  end if;
  if v_before.data_nascimento is distinct from p_data_nascimento then
    v_changed_fields := v_changed_fields || jsonb_build_array('data_nascimento');
  end if;
  if v_before.telefone_contato is distinct from v_telefone then
    v_changed_fields := v_changed_fields || jsonb_build_array('telefone_contato');
  end if;
  if v_before.documento_identificacao is distinct from v_documento then
    v_changed_fields := v_changed_fields || jsonb_build_array('documento_identificacao');
  end if;

  update public.pacientes
  set nome = v_nome,
      data_nascimento = p_data_nascimento,
      telefone_contato = v_telefone,
      documento_identificacao = v_documento,
      updated_by = v_actor_id
  where id = p_paciente_id
  returning * into v_after;

  if jsonb_array_length(v_changed_fields) > 0 then
    insert into public.auditoria (
      usuario_id, evento, entidade, entidade_id, dados
    ) values (
      v_actor_id,
      'paciente_atualizado',
      'pacientes',
      v_after.id,
      jsonb_build_object('campos_alterados', v_changed_fields)
    );
  end if;

  return v_after;
end;
$$;

create function public.update_patient_clinical_alerts(
  p_paciente_id uuid,
  p_alergias text default null,
  p_intolerancias text default null,
  p_medicamentos_em_uso text default null
)
returns public.paciente_alertas_clinicos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_before public.paciente_alertas_clinicos%rowtype;
  v_after public.paciente_alertas_clinicos%rowtype;
  v_alergias text := nullif(btrim(p_alergias), '');
  v_intolerancias text := nullif(btrim(p_intolerancias), '');
  v_medicamentos text := nullif(btrim(p_medicamentos_em_uso), '');
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if not public.is_active_dentist() then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;

  select * into v_before
  from public.paciente_alertas_clinicos
  where paciente_id = p_paciente_id
  for update;

  if not found then
    raise exception 'Paciente nao encontrado.' using errcode = 'P0002';
  end if;

  if v_before.alergias is distinct from v_alergias then
    v_changed_fields := v_changed_fields || jsonb_build_array('alergias');
  end if;
  if v_before.intolerancias is distinct from v_intolerancias then
    v_changed_fields := v_changed_fields || jsonb_build_array('intolerancias');
  end if;
  if v_before.medicamentos_em_uso is distinct from v_medicamentos then
    v_changed_fields := v_changed_fields || jsonb_build_array('medicamentos_em_uso');
  end if;

  update public.paciente_alertas_clinicos
  set alergias = v_alergias,
      intolerancias = v_intolerancias,
      medicamentos_em_uso = v_medicamentos,
      updated_by = v_actor_id
  where paciente_id = p_paciente_id
  returning * into v_after;

  if jsonb_array_length(v_changed_fields) > 0 then
    insert into public.auditoria (
      usuario_id, evento, entidade, entidade_id, dados
    ) values (
      v_actor_id,
      'alertas_clinicos_atualizados',
      'paciente_alertas_clinicos',
      v_after.paciente_id,
      jsonb_build_object('campos_alterados', v_changed_fields)
    );
  end if;

  return v_after;
end;
$$;

create function public.set_patient_active(
  p_paciente_id uuid,
  p_ativo boolean
)
returns public.pacientes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_before public.pacientes%rowtype;
  v_after public.pacientes%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Acesso administrativo negado.' using errcode = '42501';
  end if;

  if p_ativo is null then
    raise exception 'Status invalido.' using errcode = '22023';
  end if;

  select * into v_before
  from public.pacientes
  where id = p_paciente_id
  for update;

  if not found then
    raise exception 'Paciente nao encontrado.' using errcode = 'P0002';
  end if;

  update public.pacientes
  set ativo = p_ativo,
      updated_by = v_actor_id
  where id = p_paciente_id
  returning * into v_after;

  if v_before.ativo is distinct from v_after.ativo then
    insert into public.auditoria (
      usuario_id, evento, entidade, entidade_id, dados
    ) values (
      v_actor_id,
      case when v_after.ativo then 'paciente_reativado' else 'paciente_inativado' end,
      'pacientes',
      v_after.id,
      jsonb_build_object('ativo', v_after.ativo)
    );
  end if;

  return v_after;
end;
$$;

create function public.search_patients(
  p_query text default null,
  p_page integer default 1,
  p_page_size integer default 20,
  p_include_inactive boolean default false
)
returns table (
  id uuid,
  nome text,
  data_nascimento date,
  telefone_contato text,
  ativo boolean,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_raw_query text := btrim(coalesce(p_query, ''));
  v_name_query text;
  v_phone_query text;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
begin
  if not public.is_active_user() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if char_length(v_raw_query) > 100 then
    raise exception 'Busca muito longa.' using errcode = '22023';
  end if;

  v_name_query := coalesce(public.normalize_patient_search(v_raw_query), '');
  v_phone_query := regexp_replace(v_raw_query, '[^0-9]+', '', 'g');

  return query
  select
    paciente.id,
    paciente.nome,
    paciente.data_nascimento,
    paciente.telefone_contato,
    paciente.ativo,
    count(*) over() as total_count
  from public.pacientes as paciente
  where (coalesce(p_include_inactive, false) or paciente.ativo)
    and (
      v_raw_query = ''
      or (
        v_name_query <> ''
        and not exists (
          select 1
          from unnest(string_to_array(v_name_query, ' ')) as termos(termo)
          where paciente.nome_busca not like '%' || termos.termo || '%'
        )
      )
      or (
        char_length(v_phone_query) >= 3
        and paciente.telefone_busca like '%' || v_phone_query || '%'
      )
    )
  order by paciente.nome, paciente.id
  limit v_page_size
  offset (v_page - 1) * v_page_size;
end;
$$;

revoke execute on function public.create_patient(
  text, date, text, text, text, text, text
) from public, anon;
revoke execute on function public.update_patient(
  uuid, text, date, text, text
) from public, anon;
revoke execute on function public.update_patient_clinical_alerts(
  uuid, text, text, text
) from public, anon;
revoke execute on function public.set_patient_active(uuid, boolean)
  from public, anon;
revoke execute on function public.search_patients(text, integer, integer, boolean)
  from public, anon;

grant execute on function public.create_patient(
  text, date, text, text, text, text, text
) to authenticated;
grant execute on function public.update_patient(
  uuid, text, date, text, text
) to authenticated;
grant execute on function public.update_patient_clinical_alerts(
  uuid, text, text, text
) to authenticated;
grant execute on function public.set_patient_active(uuid, boolean)
  to authenticated;
grant execute on function public.search_patients(text, integer, integer, boolean)
  to authenticated;

alter default privileges in schema public
  revoke execute on functions from public;

commit;
