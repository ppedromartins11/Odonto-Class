# A1 production schema correction — 2026-11-23

## Scope and evidence

- Supabase project: `clinica` (project ref `sqouddqzpmkofenyufuj`).
- Before change: migration ledger versions 0001–0031; `create_appointment_consistent` absent, `agendamentos.request_id` absent.
- Operation: migration SQL identical to the previously reviewed `0035_agenda_return_consistency.sql`, applied **only** to the A1 agenda and return domain via the Supabase migration connector. No 0032–0034 migration was applied.
- Supabase generated migration version **`20261123133303`**, name `agenda_return_consistency`. To prevent replay of the 0035 SQL, the repository migration file is renamed to **`supabase/migrations/20261123133303_agenda_return_consistency.sql`** with identical contents; the old 0035-named file is removed from the migration directory.
- After change: `request_id uuid`, unique partial index, two agenda triggers, authenticated-only `create_appointment_consistent` RPC verified in the database catalog. PostgREST schema refresh notified.
- Aggregate audit: 16 appointments and 1 return before and after; zero pre-existing linked-return inconsistencies. **No clinical records were changed or test appointments inserted.**

## Outstanding gates and migration-history warning

- **Versions 0032 (initial admin bootstrap), 0033 (security helpers) and 0034 (verified patient upload) remain unapplied.** They are not prerequisites of A1 but are still pending and must be reviewed individually. Because an A1 migration with a later timestamp is already in the remote ledger, future CLI migrations may require reconciliation or repair before `db push`; do not blindly replay any migration.
- The Supabase organization is on the **Free** plan. Automated daily backups/PITR are not included. The older, partially rehearsed recovery snapshot is not a verified current restore point. Complete a fresh, private backup and a restore rehearsal before further production schema upgrades or release claims.
- SQL integration tests (concurrency, rollback, return links, idempotency, authorization with real sessions) remain unexecuted against an isolated Postgres environment; do not run fixture or cleanup tests against production.
- Static schema/catalog checks confirm the RPC's presence and grants. These checks do not prove end-to-end application success or user-role authorization. A designated operator should verify a legitimate appointment with an authenticated authorized account, without fake patient data.
- No application files, environment secrets, production patient data or roles were changed by this database action. This GitHub change only reconciles the migration filename and records operational evidence.
