-- Sprint documental: documentos oficiais, CID isolado e snapshots de orcamento.
-- Aditiva: migrations 0001-0018 permanecem imutaveis.

alter type public.tipo_documento add value if not exists 'declaracao_comparecimento';
alter type public.tipo_documento add value if not exists 'declaracao_acompanhamento';

begin;

create type public.unidade_afastamento as enum ('horas', 'dias');
create type public.tipo_autorizador_cid as enum ('paciente', 'responsavel');

alter table public.documentos
  add column atendimento_id uuid references public.atendimentos(id) on delete restrict,
  add column finalidade text,
  add column comparecimento_inicio timestamptz,
  add column comparecimento_fim timestamptz,
  add column afastamento_quantidade integer,
  add column afastamento_unidade public.unidade_afastamento,
  add column acompanhante_nome text,
  add column acompanhante_identificacao text,
  add column acompanhante_relacao text,
  add column layout_version integer not null default 1,
  add column pdf_sha256 text,
  add constraint documentos_finalidade_valida check (
    finalidade is null or (finalidade = btrim(finalidade) and char_length(finalidade) between 2 and 300)
  ),
  add constraint documentos_comparecimento_valido check (
    (comparecimento_inicio is null and comparecimento_fim is null)
    or (comparecimento_inicio is not null and comparecimento_fim is not null and comparecimento_fim > comparecimento_inicio)
  ),
  add constraint documentos_afastamento_valido check (
    (afastamento_quantidade is null and afastamento_unidade is null)
    or (afastamento_quantidade > 0 and afastamento_unidade is not null)
  ),
  add constraint documentos_acompanhante_nome_valido check (
    acompanhante_nome is null or (acompanhante_nome = btrim(acompanhante_nome) and char_length(acompanhante_nome) between 2 and 160)
  ),
  add constraint documentos_acompanhante_identificacao_valida check (
    acompanhante_identificacao is null or (acompanhante_identificacao = btrim(acompanhante_identificacao) and char_length(acompanhante_identificacao) between 2 and 120)
  ),
  add constraint documentos_acompanhante_relacao_valida check (
    acompanhante_relacao is null or (acompanhante_relacao = btrim(acompanhante_relacao) and char_length(acompanhante_relacao) between 2 and 120)
  ),
  add constraint documentos_layout_version_valida check (layout_version > 0),
  add constraint documentos_pdf_sha256_valido check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$');

comment on column public.documentos.profissional_id is 'Profissional autor do documento; o ator operacional permanece em created_by.';
comment on column public.documentos.pdf_sha256 is 'SHA-256 hexadecimal do binario PDF efetivamente armazenado no bucket privado.';

create table public.documento_cid (
  documento_id uuid primary key references public.documentos(id) on delete restrict,
  codigo text not null,
  autorizado boolean not null check (autorizado),
  autorizador_tipo public.tipo_autorizador_cid not null,
  autorizado_em timestamptz not null,
  registrado_por uuid not null references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint documento_cid_codigo_valido check (codigo = upper(btrim(codigo)) and char_length(codigo) between 3 and 12)
);

comment on table public.documento_cid is 'Dado clinico sensivel isolado. Leitura restrita ao dentista autor; nunca copiar para auditoria.';

create table public.orcamento_pdf_versoes (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references public.orcamentos(id) on delete restrict,
  versao integer not null,
  storage_path text not null unique,
  pdf_sha256 text not null,
  layout_version integer not null,
  tamanho_bytes integer not null,
  emitido_por uuid not null references public.usuarios(id) on delete restrict,
  emitido_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint orcamento_pdf_versoes_unica unique (orcamento_id, versao),
  constraint orcamento_pdf_versao_valida check (versao > 0),
  constraint orcamento_pdf_path_seguro check (storage_path ~ '^[0-9a-f-]{36}/orcamentos/[0-9a-f-]{36}\.pdf$'),
  constraint orcamento_pdf_sha256_valido check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  constraint orcamento_pdf_layout_valido check (layout_version > 0),
  constraint orcamento_pdf_tamanho_valido check (tamanho_bytes > 0 and tamanho_bytes <= 10485760)
);

comment on table public.orcamento_pdf_versoes is 'Versoes imutaveis dos PDFs emitidos de orcamentos; o binario privado e o snapshot oficial.';

create index documentos_atendimento_idx on public.documentos(atendimento_id, emitido_em desc, id);
create index orcamento_pdf_versoes_orcamento_idx on public.orcamento_pdf_versoes(orcamento_id, versao desc);

alter table public.documento_cid enable row level security;
alter table public.orcamento_pdf_versoes enable row level security;

create policy documento_cid_select on public.documento_cid for select to authenticated using (
  public.is_active_dentist() and exists (
    select 1 from public.documentos d
    where d.id = documento_id and d.profissional_id = public.current_professional_id()
  )
);

create policy orcamento_pdf_versoes_select on public.orcamento_pdf_versoes for select to authenticated using (
  public.is_active_user() and (public.can_manage_budgets() or public.can_access_own_budget(orcamento_id))
);

revoke all on public.documento_cid, public.orcamento_pdf_versoes from public, anon, authenticated;
grant select on public.documento_cid, public.orcamento_pdf_versoes to authenticated;
grant all on public.documento_cid, public.orcamento_pdf_versoes to service_role;

create function public.list_document_author_attendances(p_paciente_id uuid)
returns table(
  id uuid,
  profissional_id uuid,
  profissional_nome text,
  registro_profissional text,
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  status public.status_atendimento
)
language sql security definer set search_path = '' stable as $$
  select a.id, a.profissional_id, u.nome, p.registro_profissional, a.iniciado_em, a.finalizado_em, a.status
  from public.atendimentos a
  join public.profissionais p on p.id = a.profissional_id
  join public.usuarios u on u.id = p.usuario_id
  where public.is_active_user()
    and a.paciente_id = p_paciente_id
    and p.status = 'ativo'::public.status_usuario
    and u.status = 'ativo'::public.status_usuario
    and u.perfil = 'dentista'::public.perfil_usuario
    and (public.can_manage_operational() or a.profissional_id = public.current_professional_id())
  order by a.iniciado_em desc
  limit 50;
$$;

create function public.create_official_document(
  p_paciente_id uuid,
  p_atendimento_id uuid,
  p_profissional_autor_id uuid,
  p_tipo public.tipo_documento,
  p_emitido_em date,
  p_finalidade text,
  p_comparecimento_inicio timestamptz,
  p_comparecimento_fim timestamptz,
  p_afastamento_quantidade integer,
  p_afastamento_unidade public.unidade_afastamento,
  p_acompanhante_nome text,
  p_acompanhante_identificacao text,
  p_acompanhante_relacao text,
  p_texto_adicional text,
  p_cid_codigo text,
  p_cid_autorizado boolean,
  p_cid_autorizador_tipo public.tipo_autorizador_cid,
  p_storage_path text,
  p_nome_arquivo text,
  p_tamanho_bytes integer,
  p_layout_version integer,
  p_pdf_sha256 text
)
returns public.documentos
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.perfil_usuario;
  v_own_professional uuid := public.current_professional_id();
  v_attendance public.atendimentos%rowtype;
  v_professional record;
  v_result public.documentos%rowtype;
  v_event text;
  v_cid text := nullif(upper(btrim(p_cid_codigo)), '');
begin
  if not public.is_active_user() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select u.perfil into v_profile from public.usuarios u where u.id = v_actor and u.status = 'ativo';
  if v_profile is null then raise exception 'Acesso negado.' using errcode = '42501'; end if;

  if p_tipo not in ('atestado','declaracao_comparecimento','declaracao_acompanhamento') then
    raise exception 'Tipo documental invalido.' using errcode = '22023';
  end if;
  if p_atendimento_id is null then raise exception 'Vincule um atendimento ao documento.' using errcode = '23514'; end if;

  select * into v_attendance from public.atendimentos where id = p_atendimento_id;
  if not found or v_attendance.paciente_id is distinct from p_paciente_id
     or v_attendance.profissional_id is distinct from p_profissional_autor_id then
    raise exception 'Atendimento e profissional autor nao correspondem ao paciente.' using errcode = '23514';
  end if;

  select p.id, p.registro_profissional, p.status, u.id as usuario_id, u.nome, u.status as usuario_status, u.perfil
    into v_professional
  from public.profissionais p join public.usuarios u on u.id = p.usuario_id
  where p.id = p_profissional_autor_id;
  if not found or v_professional.status <> 'ativo' or v_professional.usuario_status <> 'ativo'
     or v_professional.perfil <> 'dentista' then
    raise exception 'Profissional autor invalido.' using errcode = '23514';
  end if;
  if nullif(btrim(v_professional.registro_profissional), '') is null then
    raise exception 'Complete o registro profissional do cirurgiao-dentista antes de emitir este documento.' using errcode = '23514';
  end if;

  if p_tipo = 'atestado' then
    if v_profile <> 'dentista' or v_own_professional is distinct from p_profissional_autor_id then
      raise exception 'Somente o dentista autor pode emitir atestado.' using errcode = '42501';
    end if;
  elsif v_profile = 'dentista' and v_own_professional is distinct from p_profissional_autor_id then
    raise exception 'Dentista nao pode emitir documento em nome de outro profissional.' using errcode = '42501';
  elsif v_profile not in ('administrador','recepcao','dentista') then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if nullif(btrim(p_finalidade), '') is null then raise exception 'Informe a finalidade do documento.' using errcode = '23514'; end if;
  if p_comparecimento_inicio is not null or p_comparecimento_fim is not null then
    if p_comparecimento_inicio is null or p_comparecimento_fim is null or p_comparecimento_fim <= p_comparecimento_inicio then
      raise exception 'Periodo de comparecimento invalido.' using errcode = '23514';
    end if;
  end if;
  if p_tipo in ('declaracao_comparecimento','declaracao_acompanhamento')
     and (p_comparecimento_inicio is null or p_comparecimento_fim is null) then
    raise exception 'Informe o horario de comparecimento.' using errcode = '23514';
  end if;

  if (p_afastamento_quantidade is null) <> (p_afastamento_unidade is null)
     or (p_afastamento_quantidade is not null and p_afastamento_quantidade <= 0) then
    raise exception 'Afastamento invalido.' using errcode = '23514';
  end if;
  if p_tipo <> 'atestado' and (p_afastamento_quantidade is not null or p_afastamento_unidade is not null) then
    raise exception 'Afastamento permitido somente em atestado.' using errcode = '23514';
  end if;

  if p_tipo = 'declaracao_acompanhamento' and nullif(btrim(p_acompanhante_nome), '') is null then
    raise exception 'Informe o nome do acompanhante.' using errcode = '23514';
  end if;
  if p_tipo <> 'declaracao_acompanhamento' and (
    nullif(btrim(p_acompanhante_nome), '') is not null
    or nullif(btrim(p_acompanhante_identificacao), '') is not null
    or nullif(btrim(p_acompanhante_relacao), '') is not null
  ) then raise exception 'Dados de acompanhante incompativeis com o tipo documental.' using errcode = '23514'; end if;

  if v_cid is not null then
    if p_tipo <> 'atestado' or not coalesce(p_cid_autorizado, false) or p_cid_autorizador_tipo is null then
      raise exception 'A inclusao do CID exige autorizacao registrada.' using errcode = '23514';
    end if;
  elsif coalesce(p_cid_autorizado, false) or p_cid_autorizador_tipo is not null then
    raise exception 'Autorizacao de CID sem codigo informado.' using errcode = '23514';
  end if;

  insert into public.documentos(
    paciente_id, profissional_id, tipo, emitido_em, periodo_inicio, periodo_fim, texto_adicional,
    storage_path, nome_arquivo, tamanho_bytes, created_by, updated_by, atendimento_id, finalidade,
    comparecimento_inicio, comparecimento_fim, afastamento_quantidade, afastamento_unidade,
    acompanhante_nome, acompanhante_identificacao, acompanhante_relacao, layout_version, pdf_sha256
  ) values (
    p_paciente_id, p_profissional_autor_id, p_tipo, coalesce(p_emitido_em, current_date),
    case when p_afastamento_unidade = 'dias' then coalesce(p_emitido_em, current_date) else null end,
    case when p_afastamento_unidade = 'dias' then coalesce(p_emitido_em, current_date) + p_afastamento_quantidade - 1 else null end,
    nullif(btrim(p_texto_adicional), ''), p_storage_path, btrim(p_nome_arquivo), p_tamanho_bytes,
    v_actor, v_actor, p_atendimento_id, btrim(p_finalidade), p_comparecimento_inicio, p_comparecimento_fim,
    p_afastamento_quantidade, p_afastamento_unidade, nullif(btrim(p_acompanhante_nome), ''),
    nullif(btrim(p_acompanhante_identificacao), ''), nullif(btrim(p_acompanhante_relacao), ''),
    p_layout_version, lower(p_pdf_sha256)
  ) returning * into v_result;

  if v_cid is not null then
    insert into public.documento_cid(documento_id, codigo, autorizado, autorizador_tipo, autorizado_em, registrado_por)
    values(v_result.id, v_cid, true, p_cid_autorizador_tipo, now(), v_actor);
  end if;

  v_event := case when v_profile = 'dentista' then 'documento_emitido' else 'documento_preparado' end;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values(v_actor, v_event, 'documentos', v_result.id, jsonb_build_object(
    'documento_id', v_result.id, 'tipo', v_result.tipo, 'paciente_id', v_result.paciente_id,
    'profissional_autor_id', v_result.profissional_id, 'preparado_por', v_actor,
    'atendimento_id', v_result.atendimento_id, 'layout_version', v_result.layout_version
  ));
  return v_result;
end;
$$;

create function public.register_budget_pdf_version(
  p_orcamento_id uuid,
  p_storage_path text,
  p_pdf_sha256 text,
  p_layout_version integer,
  p_tamanho_bytes integer
)
returns public.orcamento_pdf_versoes
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_version integer;
  v_result public.orcamento_pdf_versoes%rowtype;
begin
  if not public.is_active_user()
     or (not public.can_manage_budgets() and not public.can_access_own_budget(p_orcamento_id)) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  perform 1 from public.orcamentos where id = p_orcamento_id for update;
  if not found then raise exception 'Orcamento nao encontrado.' using errcode = 'P0002'; end if;

  select coalesce(max(versao), 0) + 1 into v_version
  from public.orcamento_pdf_versoes where orcamento_id = p_orcamento_id;
  insert into public.orcamento_pdf_versoes(
    orcamento_id, versao, storage_path, pdf_sha256, layout_version, tamanho_bytes, emitido_por
  ) values (
    p_orcamento_id, v_version, p_storage_path, lower(p_pdf_sha256), p_layout_version, p_tamanho_bytes, v_actor
  ) returning * into v_result;
  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values(v_actor, 'orcamento_pdf_emitido', 'orcamentos', p_orcamento_id, jsonb_build_object(
    'versao_id', v_result.id, 'versao', v_result.versao, 'layout_version', v_result.layout_version
  ));
  return v_result;
end;
$$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in (
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada',
  'paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados',
  'agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido',
  'atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','procedimento_dentes_atualizados',
  'retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada',
  'documento_criado','documento_preparado','documento_emitido','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado','orcamento_pdf_emitido',
  'pagamento_criado','pagamento_cancelado','pagamento_estornado','material_estoque_criado','material_estoque_atualizado','material_estoque_ativado','material_estoque_inativado','estoque_entrada_registrada','estoque_saida_registrada','estoque_ajuste_registrado',
  'servico_criado','servico_atualizado','servico_ativado','servico_inativado','servico_materiais_alterado','servico_realizado','servico_realizado_atualizado','estoque_consumido_atendimento',
  'controle_lote_ativado','controle_lote_desativado','estoque_lote_entrada','estoque_lote_saida','estoque_lote_ajuste','lote_atualizado','lote_ativado','lote_inativado',
  'equipamento_esterilizacao_criado','equipamento_esterilizacao_atualizado','ciclo_esterilizacao_iniciado','ciclo_esterilizacao_concluido','ciclo_esterilizacao_reprovado','ciclo_esterilizacao_cancelado','pacote_esterilizacao_criado','pacote_esterilizacao_utilizado','pacote_esterilizacao_descartado'
));

revoke execute on function public.create_document_metadata(uuid,uuid,public.tipo_documento,date,date,date,text,text,text,integer) from authenticated;
revoke execute on function public.list_document_author_attendances(uuid), public.create_official_document(uuid,uuid,uuid,public.tipo_documento,date,text,timestamptz,timestamptz,integer,public.unidade_afastamento,text,text,text,text,text,boolean,public.tipo_autorizador_cid,text,text,integer,integer,text), public.register_budget_pdf_version(uuid,text,text,integer,integer) from public, anon;
grant execute on function public.list_document_author_attendances(uuid), public.create_official_document(uuid,uuid,uuid,public.tipo_documento,date,text,timestamptz,timestamptz,integer,public.unidade_afastamento,text,text,text,text,text,boolean,public.tipo_autorizador_cid,text,text,integer,integer,text), public.register_budget_pdf_version(uuid,text,text,integer,integer) to authenticated;

commit;
