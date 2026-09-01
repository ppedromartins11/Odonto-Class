-- Sprint 15.1: edicao administrativa segura de equipamentos de esterilizacao.
-- Aditiva: migrations 0001-0017 permanecem inalteradas.
begin;

create function public.update_sterilization_equipment(
  p_equipamento_id uuid,
  p_nome text,
  p_identificacao text,
  p_modelo text default null,
  p_fabricante text default null,
  p_numero_serie text default null
)
returns public.equipamentos_esterilizacao
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.equipamentos_esterilizacao%rowtype;
  v_result public.equipamentos_esterilizacao%rowtype;
  v_nome text := nullif(btrim(p_nome), '');
  v_identificacao text := nullif(btrim(p_identificacao), '');
  v_modelo text := nullif(btrim(p_modelo), '');
  v_fabricante text := nullif(btrim(p_fabricante), '');
  v_numero_serie text := nullif(btrim(p_numero_serie), '');
  v_fields text[];
begin
  if not public.is_admin() then
    raise exception 'Edicao de equipamento negada.' using errcode = '42501';
  end if;

  if v_nome is null or char_length(v_nome) not between 2 and 150
    or v_identificacao is null or char_length(v_identificacao) not between 2 and 100
    or (v_modelo is not null and char_length(v_modelo) > 120)
    or (v_fabricante is not null and char_length(v_fabricante) > 120)
    or (v_numero_serie is not null and char_length(v_numero_serie) > 120) then
    raise exception 'Metadados do equipamento invalidos.' using errcode = '23514';
  end if;

  select * into v_before
  from public.equipamentos_esterilizacao
  where id = p_equipamento_id
  for update;

  if not found then
    raise exception 'Equipamento nao encontrado.' using errcode = 'P0002';
  end if;

  update public.equipamentos_esterilizacao
  set nome = v_nome,
      identificacao = v_identificacao,
      modelo = v_modelo,
      fabricante = v_fabricante,
      numero_serie = v_numero_serie,
      updated_by = v_actor
  where id = v_before.id
  returning * into v_result;

  v_fields := array_remove(array[
    case when v_before.nome is distinct from v_result.nome then 'nome' end,
    case when v_before.identificacao is distinct from v_result.identificacao then 'identificacao' end,
    case when v_before.modelo is distinct from v_result.modelo then 'modelo' end,
    case when v_before.fabricante is distinct from v_result.fabricante then 'fabricante' end,
    case when v_before.numero_serie is distinct from v_result.numero_serie then 'numero_serie' end
  ], null);

  insert into public.auditoria(usuario_id, evento, entidade, entidade_id, dados)
  values (
    v_actor,
    'equipamento_esterilizacao_atualizado',
    'equipamentos_esterilizacao',
    v_result.id,
    jsonb_build_object('campos_alterados', to_jsonb(v_fields))
  );

  return v_result;
end;
$$;

revoke execute on function public.update_sterilization_equipment(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.update_sterilization_equipment(uuid, text, text, text, text, text) to authenticated;

commit;
