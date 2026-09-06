-- Restaura a guarda de autorizacao presente na implementacao original da 0021.
-- A 0023 corrigiu a ambiguidade de coluna; esta migration preserva o mesmo RBAC.
begin;

create or replace function public.list_financial_installments(p_recebivel_id uuid)
returns table(
  id uuid, numero_parcela integer, total_parcelas integer, valor_centavos integer,
  vencimento date, status public.status_parcela_financeira, pagamento_id uuid, pagamento_status public.status_pagamento
)
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.can_manage_financial() then
    raise exception 'Acesso financeiro negado.' using errcode = '42501';
  end if;

  if not exists(
    select 1
    from public.financeiro_recebiveis as recebivel
    where recebivel.id = p_recebivel_id
  ) then
    raise exception 'Recebivel nao encontrado.' using errcode = 'P0002';
  end if;

  return query
  select parcela.id, parcela.numero_parcela, parcela.total_parcelas, parcela.valor_centavos,
    parcela.vencimento, parcela.status, pagamento.id, pagamento.status
  from public.financeiro_parcelas as parcela
  left join public.pagamentos as pagamento
    on pagamento.parcela_id = parcela.id and pagamento.status = 'pago'
  where parcela.recebivel_id = p_recebivel_id
  order by parcela.numero_parcela;
end;
$$;

revoke execute on function public.list_financial_installments(uuid) from public, anon;
grant execute on function public.list_financial_installments(uuid) to authenticated;

commit;
