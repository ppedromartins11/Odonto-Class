-- Sprint 19.1: edicao administrativa de nome e registro profissional (CRO).
-- Aditiva: migrations 0001-0019 permanecem imutaveis.

begin;

-- O schema original nao possuia unicidade para o registro. A comparacao
-- normalizada impede que o mesmo CRO seja associado a dois dentistas.
create unique index profissionais_registro_profissional_unique_idx
  on public.profissionais (lower(btrim(registro_profissional)))
  where nullif(btrim(registro_profissional), '') is not null;

create function public.update_user_profile(
  p_usuario_id uuid,
  p_nome text,
  p_registro_profissional text default null
)
returns public.usuarios
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_target public.usuarios%rowtype;
  v_professional public.profissionais%rowtype;
  v_nome text := nullif(btrim(p_nome), '');
  v_registro_profissional text := nullif(btrim(p_registro_profissional), '');
  v_changed_fields text[] := array[]::text[];
begin
  if not public.is_admin() then
    raise exception 'Acesso administrativo negado.' using errcode = '42501';
  end if;

  if v_nome is null or char_length(v_nome) < 2 or char_length(v_nome) > 160 then
    raise exception 'Informe um nome completo entre 2 e 160 caracteres.' using errcode = '23514';
  end if;
  if v_registro_profissional is not null and char_length(v_registro_profissional) > 80 then
    raise exception 'O registro profissional deve ter no maximo 80 caracteres.' using errcode = '23514';
  end if;

  select * into v_target
  from public.usuarios
  where id = p_usuario_id
  for update;

  if not found then
    raise exception 'Usuario nao encontrado.' using errcode = 'P0002';
  end if;

  if v_target.perfil <> 'dentista'::public.perfil_usuario
     and v_registro_profissional is not null then
    raise exception 'Registro profissional pode ser alterado somente para dentistas.' using errcode = '23514';
  end if;

  if v_target.perfil = 'dentista'::public.perfil_usuario then
    select * into v_professional
    from public.profissionais
    where usuario_id = v_target.id
    for update;

    if not found then
      raise exception 'Dados profissionais inconsistentes. Atualize o perfil/acesso antes de editar o CRO.' using errcode = '23514';
    end if;
  end if;

  if v_target.nome is distinct from v_nome then
    update public.usuarios
    set nome = v_nome
    where id = v_target.id
    returning * into v_target;
    v_changed_fields := array_append(v_changed_fields, 'nome');
  end if;

  if v_target.perfil = 'dentista'::public.perfil_usuario
     and v_professional.registro_profissional is distinct from v_registro_profissional then
    update public.profissionais
    set registro_profissional = v_registro_profissional
    where id = v_professional.id;
    v_changed_fields := array_append(v_changed_fields, 'registro_profissional');
  end if;

  if cardinality(v_changed_fields) > 0 then
    insert into public.auditoria (usuario_id, evento, entidade, entidade_id, dados)
    values (
      v_actor_id,
      'usuario_dados_atualizados',
      'usuarios',
      v_target.id,
      jsonb_build_object(
        'usuario_id', v_target.id,
        'campos_alterados', to_jsonb(v_changed_fields)
      )
    );
  end if;

  return v_target;
exception
  when unique_violation then
    raise exception 'Este registro profissional ja esta associado a outro dentista.' using errcode = '23505';
end;
$$;

alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in (
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','usuario_dados_atualizados','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada',
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

revoke execute on function public.update_user_profile(uuid, text, text) from public, anon;
grant execute on function public.update_user_profile(uuid, text, text) to authenticated;

commit;
