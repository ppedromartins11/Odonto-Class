begin;

-- Internal helpers are invoked by trusted SECURITY DEFINER routines,
-- not directly through the browser's Supabase Data API.
revoke all on function public.refresh_treatment_plan_state(uuid)
  from public, anon, authenticated;

revoke all on function public.refresh_budget_total(uuid)
  from public, anon, authenticated;

revoke all on function public.assert_payment_links(uuid, uuid, uuid)
  from public, anon, authenticated;

commit;
