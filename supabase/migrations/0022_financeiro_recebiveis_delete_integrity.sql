-- Corrige a limpeza transacional de recebiveis sem permitir DML ao cliente.
-- Pagamentos permanecem protegidos por FK RESTRICT; somente recebivel -> parcelas
-- usa CASCADE, para que um recebivel sem pagamentos possa ser removido por rotinas
-- administrativas de QA/retencao com as parcelas dependentes na mesma transacao.
begin;

alter table public.financeiro_parcelas
  drop constraint if exists financeiro_parcelas_recebivel_id_fkey;

alter table public.financeiro_parcelas
  add constraint financeiro_parcelas_recebivel_id_fkey
  foreign key (recebivel_id)
  references public.financeiro_recebiveis(id)
  on delete cascade;

-- O gatilho continua estrito enquanto o recebivel existe. Durante uma exclusao
-- em cascata, o pai ja nao existe ao fim da transacao e nao ha total a validar.
create or replace function public.assert_receivable_installments_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_recebivel_id uuid := case when tg_op = 'DELETE' then old.recebivel_id else new.recebivel_id end;
  v_total integer;
  v_parcelas_total bigint;
begin
  select valor_total_centavos into v_total
  from public.financeiro_recebiveis where id = v_recebivel_id;

  if not found then
    return null;
  end if;

  select coalesce(sum(valor_centavos), 0) into v_parcelas_total
  from public.financeiro_parcelas where recebivel_id = v_recebivel_id;

  if v_parcelas_total <> v_total then
    raise exception 'A soma das parcelas deve corresponder ao valor total do recebivel.' using errcode = '23514';
  end if;

  return null;
end;
$$;

commit;
