begin;

-- These are implementation details of authorized RPCs or triggers. They run
-- under postgres-owned SECURITY DEFINER callers and need no Data API entry.
revoke all on function public.refresh_treatment_plan_state(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_budget_total(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_payment_links(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- PostgreSQL executes an installed trigger without requiring the DML caller
-- to have EXECUTE on its trigger function. Remove unused direct API grants.
revoke all on function public.refresh_treatment_plan_state_after_attendance_finalized()
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_return_when_appointment_attended()
  from public, anon, authenticated, service_role;

-- A budget PDF version may only refer to a path in that budget's namespace.
-- Existing mismatched rows fail the migration rather than being rewritten.
alter table public.orcamento_pdf_versoes
  add constraint orcamento_pdf_path_matches_budget
  check (split_part(storage_path, '/', 1) = orcamento_id::text);

create or replace function public.register_budget_pdf_version(
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
  if split_part(p_storage_path, '/', 1) is distinct from p_orcamento_id::text then
    raise exception 'Caminho de PDF invalido.' using errcode = '23514';
  end if;
  perform 1 from storage.objects
  where bucket_id = 'arquivos-paciente' and name = p_storage_path;
  if not found then raise exception 'PDF nao encontrado.' using errcode = '23514'; end if;

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

commit;
