begin;

-- Trigger functions are executed by PostgreSQL when their trigger fires.
-- Public API roles never need direct EXECUTE permission on them.
revoke all on function public.refresh_treatment_plan_state_after_attendance_finalized()
  from public, anon, authenticated;

revoke all on function public.resolve_return_when_appointment_attended()
  from public, anon, authenticated;

commit;
