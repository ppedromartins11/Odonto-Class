-- Sprint 22.1: AAL2 apenas em RPCs que ja exigem administrador.
-- Sem GUC customizado: usa exclusivamente o claim JWT oficial do Supabase.

begin;

create function public.require_admin_aal2()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_perfil public.perfil_usuario;
  v_status public.status_usuario;
begin
  if (select auth.uid()) is null then
    raise exception 'Acesso nao autorizado.' using errcode = '42501';
  end if;
  select perfil, status into v_perfil, v_status
  from public.usuarios where id = (select auth.uid());
  if not found or v_status <> 'ativo'::public.status_usuario then
    raise exception 'Acesso nao autorizado.' using errcode = '42501';
  end if;
  -- Nao concede permissao: o RBAC original da RPC continua obrigatorio.
  if v_perfil = 'administrador'::public.perfil_usuario
    and coalesce((select auth.jwt() ->> 'aal'), 'aal1') <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.require_admin_aal2() from public, anon;
grant execute on function public.require_admin_aal2() to authenticated;

-- Cada rotina historica e renomeada e perde EXECUTE do cliente. A API publica
-- preserva assinatura, grants e RBAC, adicionando somente o gate AAL2.
alter function public.update_user_access(uuid, public.perfil_usuario, public.status_usuario) rename to update_user_access_rbac;
revoke all on function public.update_user_access_rbac(uuid, public.perfil_usuario, public.status_usuario) from public, anon, authenticated;
create function public.update_user_access(p_usuario_id uuid, p_perfil public.perfil_usuario default null, p_status public.status_usuario default null) returns public.usuarios language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.update_user_access_rbac(p_usuario_id,p_perfil,p_status); end; $$;
revoke execute on function public.update_user_access(uuid, public.perfil_usuario, public.status_usuario) from public, anon;
grant execute on function public.update_user_access(uuid, public.perfil_usuario, public.status_usuario) to authenticated;

alter function public.update_user_profile(uuid, text, text) rename to update_user_profile_rbac;
revoke all on function public.update_user_profile_rbac(uuid, text, text) from public, anon, authenticated;
create function public.update_user_profile(p_usuario_id uuid,p_nome text,p_registro_profissional text default null) returns public.usuarios language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.update_user_profile_rbac(p_usuario_id,p_nome,p_registro_profissional); end; $$;
revoke execute on function public.update_user_profile(uuid, text, text) from public, anon;
grant execute on function public.update_user_profile(uuid, text, text) to authenticated;

alter function public.set_patient_active(uuid, boolean) rename to set_patient_active_rbac;
revoke all on function public.set_patient_active_rbac(uuid, boolean) from public, anon, authenticated;
create function public.set_patient_active(p_paciente_id uuid,p_ativo boolean) returns public.pacientes language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.set_patient_active_rbac(p_paciente_id,p_ativo); end; $$;
revoke execute on function public.set_patient_active(uuid, boolean) from public, anon;
grant execute on function public.set_patient_active(uuid, boolean) to authenticated;

alter function public.create_stock_material(text,text,public.unidade_estoque,integer,integer,date,text,boolean) rename to create_stock_material_rbac;
revoke all on function public.create_stock_material_rbac(text,text,public.unidade_estoque,integer,integer,date,text,boolean) from public, anon, authenticated;
create function public.create_stock_material(p_nome text,p_categoria text,p_unidade public.unidade_estoque,p_quantidade_inicial integer,p_estoque_minimo integer,p_validade date default null,p_fornecedor text default null,p_ativo boolean default true) returns public.materiais_estoque language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.create_stock_material_rbac(p_nome,p_categoria,p_unidade,p_quantidade_inicial,p_estoque_minimo,p_validade,p_fornecedor,p_ativo); end; $$;
revoke execute on function public.create_stock_material(text,text,public.unidade_estoque,integer,integer,date,text,boolean) from public, anon;
grant execute on function public.create_stock_material(text,text,public.unidade_estoque,integer,integer,date,text,boolean) to authenticated;

alter function public.update_stock_material(uuid,text,text,public.unidade_estoque,integer,date,text) rename to update_stock_material_rbac;
revoke all on function public.update_stock_material_rbac(uuid,text,text,public.unidade_estoque,integer,date,text) from public, anon, authenticated;
create function public.update_stock_material(p_material_id uuid,p_nome text,p_categoria text,p_unidade public.unidade_estoque,p_estoque_minimo integer,p_validade date default null,p_fornecedor text default null) returns public.materiais_estoque language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.update_stock_material_rbac(p_material_id,p_nome,p_categoria,p_unidade,p_estoque_minimo,p_validade,p_fornecedor); end; $$;
revoke execute on function public.update_stock_material(uuid,text,text,public.unidade_estoque,integer,date,text) from public, anon;
grant execute on function public.update_stock_material(uuid,text,text,public.unidade_estoque,integer,date,text) to authenticated;

alter function public.set_stock_material_active(uuid,boolean) rename to set_stock_material_active_rbac;
revoke all on function public.set_stock_material_active_rbac(uuid,boolean) from public, anon, authenticated;
create function public.set_stock_material_active(p_material_id uuid,p_ativo boolean) returns public.materiais_estoque language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.set_stock_material_active_rbac(p_material_id,p_ativo); end; $$;
revoke execute on function public.set_stock_material_active(uuid,boolean) from public, anon;
grant execute on function public.set_stock_material_active(uuid,boolean) to authenticated;

alter function public.set_stock_lot_control(uuid,boolean,text,date,date,text) rename to set_stock_lot_control_rbac;
revoke all on function public.set_stock_lot_control_rbac(uuid,boolean,text,date,date,text) from public, anon, authenticated;
create function public.set_stock_lot_control(p_material_id uuid,p_controla boolean,p_codigo_lote_inicial text default null,p_data_validade date default null,p_data_fabricacao date default null,p_fornecedor text default null) returns public.materiais_estoque language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.set_stock_lot_control_rbac(p_material_id,p_controla,p_codigo_lote_inicial,p_data_validade,p_data_fabricacao,p_fornecedor); end; $$;
revoke execute on function public.set_stock_lot_control(uuid,boolean,text,date,date,text) from public, anon;
grant execute on function public.set_stock_lot_control(uuid,boolean,text,date,date,text) to authenticated;

alter function public.set_stock_lot_active(uuid,boolean) rename to set_stock_lot_active_rbac;
revoke all on function public.set_stock_lot_active_rbac(uuid,boolean) from public, anon, authenticated;
create function public.set_stock_lot_active(p_lote_id uuid,p_ativo boolean) returns public.materiais_lotes language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.set_stock_lot_active_rbac(p_lote_id,p_ativo); end; $$;
revoke execute on function public.set_stock_lot_active(uuid,boolean) from public, anon;
grant execute on function public.set_stock_lot_active(uuid,boolean) to authenticated;

alter function public.update_stock_lot_metadata(uuid,text,date,date,text) rename to update_stock_lot_metadata_rbac;
revoke all on function public.update_stock_lot_metadata_rbac(uuid,text,date,date,text) from public, anon, authenticated;
create function public.update_stock_lot_metadata(p_lote_id uuid,p_codigo_lote text,p_data_validade date,p_data_fabricacao date default null,p_fornecedor text default null) returns public.materiais_lotes language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.update_stock_lot_metadata_rbac(p_lote_id,p_codigo_lote,p_data_validade,p_data_fabricacao,p_fornecedor); end; $$;
revoke execute on function public.update_stock_lot_metadata(uuid,text,date,date,text) from public, anon;
grant execute on function public.update_stock_lot_metadata(uuid,text,date,date,text) to authenticated;

alter function public.adjust_stock_lot(uuid,uuid,integer,text,text) rename to adjust_stock_lot_rbac;
revoke all on function public.adjust_stock_lot_rbac(uuid,uuid,integer,text,text) from public, anon, authenticated;
create function public.adjust_stock_lot(p_material_id uuid,p_lote_id uuid,p_nova_quantidade integer,p_motivo text,p_referencia text default null) returns public.movimentacoes_estoque language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.adjust_stock_lot_rbac(p_material_id,p_lote_id,p_nova_quantidade,p_motivo,p_referencia); end; $$;
revoke execute on function public.adjust_stock_lot(uuid,uuid,integer,text,text) from public, anon;
grant execute on function public.adjust_stock_lot(uuid,uuid,integer,text,text) to authenticated;

alter function public.create_sterilization_equipment(text,text,text,text,text) rename to create_sterilization_equipment_rbac;
revoke all on function public.create_sterilization_equipment_rbac(text,text,text,text,text) from public, anon, authenticated;
create function public.create_sterilization_equipment(p_nome text,p_identificacao text,p_modelo text default null,p_fabricante text default null,p_numero_serie text default null) returns public.equipamentos_esterilizacao language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.create_sterilization_equipment_rbac(p_nome,p_identificacao,p_modelo,p_fabricante,p_numero_serie); end; $$;
revoke execute on function public.create_sterilization_equipment(text,text,text,text,text) from public, anon;
grant execute on function public.create_sterilization_equipment(text,text,text,text,text) to authenticated;

alter function public.update_sterilization_equipment(uuid,text,text,text,text,text) rename to update_sterilization_equipment_rbac;
revoke all on function public.update_sterilization_equipment_rbac(uuid,text,text,text,text,text) from public, anon, authenticated;
create function public.update_sterilization_equipment(p_equipamento_id uuid,p_nome text,p_identificacao text,p_modelo text default null,p_fabricante text default null,p_numero_serie text default null) returns public.equipamentos_esterilizacao language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.update_sterilization_equipment_rbac(p_equipamento_id,p_nome,p_identificacao,p_modelo,p_fabricante,p_numero_serie); end; $$;
revoke execute on function public.update_sterilization_equipment(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.update_sterilization_equipment(uuid,text,text,text,text,text) to authenticated;

alter function public.set_sterilization_equipment_active(uuid,boolean) rename to set_sterilization_equipment_active_rbac;
revoke all on function public.set_sterilization_equipment_active_rbac(uuid,boolean) from public, anon, authenticated;
create function public.set_sterilization_equipment_active(p_equipamento_id uuid,p_ativo boolean) returns public.equipamentos_esterilizacao language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.set_sterilization_equipment_active_rbac(p_equipamento_id,p_ativo); end; $$;
revoke execute on function public.set_sterilization_equipment_active(uuid,boolean) from public, anon;
grant execute on function public.set_sterilization_equipment_active(uuid,boolean) to authenticated;

alter function public.create_service(text,text,text,integer) rename to create_service_rbac;
revoke all on function public.create_service_rbac(text,text,text,integer) from public, anon, authenticated;
create function public.create_service(p_nome text,p_descricao text default null,p_categoria text default null,p_valor_padrao_centavos integer default 0) returns public.servicos language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.create_service_rbac(p_nome,p_descricao,p_categoria,p_valor_padrao_centavos); end; $$;
revoke execute on function public.create_service(text,text,text,integer) from public, anon;
grant execute on function public.create_service(text,text,text,integer) to authenticated;

alter function public.update_service(uuid,text,text,text,integer) rename to update_service_rbac;
revoke all on function public.update_service_rbac(uuid,text,text,text,integer) from public, anon, authenticated;
create function public.update_service(p_servico_id uuid,p_nome text,p_descricao text default null,p_categoria text default null,p_valor_padrao_centavos integer default 0) returns public.servicos language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.update_service_rbac(p_servico_id,p_nome,p_descricao,p_categoria,p_valor_padrao_centavos); end; $$;
revoke execute on function public.update_service(uuid,text,text,text,integer) from public, anon;
grant execute on function public.update_service(uuid,text,text,text,integer) to authenticated;

alter function public.set_service_active(uuid,boolean) rename to set_service_active_rbac;
revoke all on function public.set_service_active_rbac(uuid,boolean) from public, anon, authenticated;
create function public.set_service_active(p_servico_id uuid,p_ativo boolean) returns public.servicos language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.set_service_active_rbac(p_servico_id,p_ativo); end; $$;
revoke execute on function public.set_service_active(uuid,boolean) from public, anon;
grant execute on function public.set_service_active(uuid,boolean) to authenticated;

alter function public.configure_service_material(uuid,uuid,integer,boolean) rename to configure_service_material_rbac;
revoke all on function public.configure_service_material_rbac(uuid,uuid,integer,boolean) from public, anon, authenticated;
create function public.configure_service_material(p_servico_id uuid,p_material_id uuid,p_quantidade_padrao integer,p_ativo boolean default true) returns public.servico_materiais language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.configure_service_material_rbac(p_servico_id,p_material_id,p_quantidade_padrao,p_ativo); end; $$;
revoke execute on function public.configure_service_material(uuid,uuid,integer,boolean) from public, anon;
grant execute on function public.configure_service_material(uuid,uuid,integer,boolean) to authenticated;

alter function public.set_service_material_active(uuid,boolean) rename to set_service_material_active_rbac;
revoke all on function public.set_service_material_active_rbac(uuid,boolean) from public, anon, authenticated;
create function public.set_service_material_active(p_servico_material_id uuid,p_ativo boolean) returns public.servico_materiais language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.set_service_material_active_rbac(p_servico_material_id,p_ativo); end; $$;
revoke execute on function public.set_service_material_active(uuid,boolean) from public, anon;
grant execute on function public.set_service_material_active(uuid,boolean) to authenticated;

alter function public.get_payment_summary(date,date) rename to get_payment_summary_rbac;
revoke all on function public.get_payment_summary_rbac(date,date) from public, anon, authenticated;
create function public.get_payment_summary(p_data_inicio date,p_data_fim date) returns table(recebido_hoje_centavos bigint,recebido_periodo_centavos bigint,quantidade_pagamentos bigint,a_receber_centavos bigint,vencido_centavos bigint) language plpgsql security definer set search_path = '' stable as $$ begin perform public.require_admin_aal2(); return query select * from public.get_payment_summary_rbac(p_data_inicio,p_data_fim); end; $$;
revoke execute on function public.get_payment_summary(date,date) from public, anon;
grant execute on function public.get_payment_summary(date,date) to authenticated;

alter function public.set_payment_status(uuid,public.status_pagamento) rename to set_payment_status_rbac;
revoke all on function public.set_payment_status_rbac(uuid,public.status_pagamento) from public, anon, authenticated;
create function public.set_payment_status(p_pagamento_id uuid,p_status public.status_pagamento) returns public.pagamentos language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.set_payment_status_rbac(p_pagamento_id,p_status); end; $$;
revoke execute on function public.set_payment_status(uuid,public.status_pagamento) from public, anon;
grant execute on function public.set_payment_status(uuid,public.status_pagamento) to authenticated;

alter function public.cancel_financial_receivable(uuid) rename to cancel_financial_receivable_rbac;
revoke all on function public.cancel_financial_receivable_rbac(uuid) from public, anon, authenticated;
create function public.cancel_financial_receivable(p_recebivel_id uuid) returns public.financeiro_recebiveis language plpgsql security definer set search_path = '' as $$ begin perform public.require_admin_aal2(); return public.cancel_financial_receivable_rbac(p_recebivel_id); end; $$;
revoke execute on function public.cancel_financial_receivable(uuid) from public, anon;
grant execute on function public.cancel_financial_receivable(uuid) to authenticated;

commit;
