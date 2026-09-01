-- Sprint 14: odontograma FDI permanente vinculado a procedimentos.
-- Aditiva: preserva 0001-0015 e o campo textual legado procedimentos.dente.

begin;

create table public.procedimento_dentes (
  id uuid primary key default gen_random_uuid(),
  procedimento_id uuid not null references public.procedimentos(id) on delete restrict,
  dente_fdi smallint not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.usuarios(id) on delete restrict,
  constraint procedimento_dentes_fdi_valido check (dente_fdi in (
    11,12,13,14,15,16,17,18,
    21,22,23,24,25,26,27,28,
    31,32,33,34,35,36,37,38,
    41,42,43,44,45,46,47,48
  )),
  constraint procedimento_dentes_unico unique (procedimento_id, dente_fdi)
);

comment on table public.procedimento_dentes is
  'Dentes permanentes FDI relacionados a um procedimento. Nao representa faces, diagnosticos ou quantidade do procedimento.';
comment on column public.procedimento_dentes.dente_fdi is
  'Codigo FDI/ISO fechado para denticao permanente; complementa, sem substituir, procedimentos.dente.';

-- A constraint UNIQUE atende leituras por procedimento; este indice atende
-- consultas transversais por dente sem criar uma query por procedimento.
create index procedimento_dentes_fdi_procedimento_idx
  on public.procedimento_dentes(dente_fdi, procedimento_id);

alter table public.procedimento_dentes enable row level security;

create policy procedimento_dentes_select_own_dentist
  on public.procedimento_dentes for select to authenticated
  using (
    public.is_active_dentist()
    and exists (
      select 1
      from public.procedimentos procedimento
      join public.atendimentos atendimento on atendimento.id = procedimento.atendimento_id
      where procedimento.id = procedimento_dentes.procedimento_id
        and atendimento.profissional_id = public.current_professional_id()
    )
  );

revoke insert, update, delete on public.procedimento_dentes from anon, authenticated;
grant select on public.procedimento_dentes to authenticated;
grant all on public.procedimento_dentes to service_role;

create function public.set_procedure_teeth(
  p_procedimento_id uuid,
  p_dentes smallint[]
)
returns smallint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profissional uuid := public.current_professional_id();
  v_procedimento public.procedimentos%rowtype;
  v_atendimento public.atendimentos%rowtype;
  v_solicitados smallint[] := coalesce(p_dentes, '{}'::smallint[]);
  v_normalizados smallint[];
  v_anteriores smallint[];
begin
  if not public.is_active_dentist() or v_profissional is null then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(v_solicitados) as item(dente)
    where item.dente is null
      or not (item.dente = any (array[
        11,12,13,14,15,16,17,18,
        21,22,23,24,25,26,27,28,
        31,32,33,34,35,36,37,38,
        41,42,43,44,45,46,47,48
      ]::smallint[]))
  ) then
    raise exception 'Codigo FDI invalido.' using errcode = '22023';
  end if;

  select coalesce(array_agg(item.dente order by item.dente), '{}'::smallint[])
    into v_normalizados
  from (select distinct dente from unnest(v_solicitados) as source(dente)) item;

  select * into v_procedimento
  from public.procedimentos
  where id = p_procedimento_id
  for update;

  if not found then
    raise exception 'Procedimento nao encontrado.' using errcode = 'P0002';
  end if;

  select * into v_atendimento
  from public.atendimentos
  where id = v_procedimento.atendimento_id
  for update;

  if not found or v_atendimento.profissional_id <> v_profissional then
    raise exception 'Acesso clinico negado.' using errcode = '42501';
  end if;
  if v_atendimento.status <> 'em_andamento' then
    raise exception 'Atendimento finalizado e imutavel.' using errcode = '23514';
  end if;

  select coalesce(array_agg(dente.dente_fdi order by dente.dente_fdi), '{}'::smallint[])
    into v_anteriores
  from public.procedimento_dentes dente
  where dente.procedimento_id = v_procedimento.id;

  if v_anteriores is not distinct from v_normalizados then
    return v_normalizados;
  end if;

  delete from public.procedimento_dentes
  where procedimento_id = v_procedimento.id;

  insert into public.procedimento_dentes(procedimento_id, dente_fdi, created_by)
  select v_procedimento.id, item.dente, v_actor
  from unnest(v_normalizados) as item(dente);

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    'procedimento_dentes_atualizados',
    'procedimentos',
    v_procedimento.id,
    jsonb_build_object(
      'procedimento_id', v_procedimento.id,
      'atendimento_id', v_atendimento.id,
      'quantidade_dentes', cardinality(v_normalizados)
    )
  );

  return v_normalizados;
end;
$$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in (
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada',
  'paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados',
  'agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido',
  'atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','procedimento_dentes_atualizados',
  'retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada',
  'documento_criado','arquivo_enviado','arquivo_removido','orcamento_criado','orcamento_atualizado','orcamento_item_criado','orcamento_item_atualizado','orcamento_item_removido','orcamento_status_alterado','orcamento_pdf_gerado',
  'pagamento_criado','pagamento_cancelado','pagamento_estornado','material_estoque_criado','material_estoque_atualizado','material_estoque_ativado','material_estoque_inativado','estoque_entrada_registrada','estoque_saida_registrada','estoque_ajuste_registrado',
  'servico_criado','servico_atualizado','servico_ativado','servico_inativado','servico_materiais_alterado','servico_realizado','servico_realizado_atualizado','estoque_consumido_atendimento'
));

revoke execute on function public.set_procedure_teeth(uuid, smallint[]) from public, anon;
grant execute on function public.set_procedure_teeth(uuid, smallint[]) to authenticated;

commit;
