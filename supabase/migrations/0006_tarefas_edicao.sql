begin;
alter table public.auditoria drop constraint if exists auditoria_evento_check;
alter table public.auditoria add constraint auditoria_evento_check check (evento in (
  'usuario_convidado','convite_aceito','usuario_ativado','usuario_desativado','perfil_alterado','acao_administrativa_negada','senha_redefinida','configuracao_acesso_alterada','paciente_criado','paciente_atualizado','paciente_inativado','paciente_reativado','alertas_clinicos_atualizados','agendamento_criado','agendamento_remarcado','agendamento_alterado','agendamento_confirmado','agendamento_cancelado','agendamento_falta_registrada','agendamento_atendido','atendimento_iniciado','atendimento_criado_direto','atendimento_alterado','atendimento_finalizado','procedimento_criado','procedimento_atualizado','retorno_criado','retorno_atualizado','retorno_agendado','retorno_concluido','retorno_cancelado','tarefa_criada','tarefa_atualizada','tarefa_concluida','tarefa_cancelada','documento_criado','arquivo_enviado','arquivo_removido'
));
create function public.update_task(p_tarefa_id uuid,p_titulo text,p_descricao text,p_prazo date,p_responsavel_id uuid,p_paciente_id uuid default null,p_agendamento_id uuid default null)
returns public.tarefas language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_before public.tarefas%rowtype;v_after public.tarefas%rowtype;
begin
 select * into v_before from public.tarefas where id=p_tarefa_id for update;if not found then raise exception 'Tarefa nao encontrada.' using errcode='P0002';end if;
 if not public.can_manage_operational() and v_before.created_by<>v_actor then raise exception 'Acesso negado.' using errcode='42501';end if;
 if v_before.status<>'pendente' then raise exception 'Tarefa encerrada.' using errcode='23514';end if;
 if not exists(select 1 from public.usuarios where id=p_responsavel_id and status='ativo') then raise exception 'Responsavel invalido.' using errcode='23514';end if;
 update public.tarefas set titulo=btrim(coalesce(p_titulo,'')),descricao=nullif(btrim(p_descricao),''),prazo=p_prazo,responsavel_id=p_responsavel_id,paciente_id=p_paciente_id,agendamento_id=p_agendamento_id,updated_by=v_actor where id=v_before.id returning * into v_after;
 insert into public.auditoria(usuario_id,evento,entidade,entidade_id,dados) values(v_actor,'tarefa_atualizada','tarefas',v_after.id,jsonb_build_object('campos_alterados',jsonb_build_array('titulo','descricao','prazo','responsavel_id','paciente_id','agendamento_id')));return v_after;
end;$$;
revoke execute on function public.update_task(uuid,text,text,date,uuid,uuid,uuid) from public,anon;
grant execute on function public.update_task(uuid,text,text,date,uuid,uuid,uuid) to authenticated;
commit;
