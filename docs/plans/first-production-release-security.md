# First production release — security and validation plan

## Objective and acceptance

Close the three confirmed QA Security Advisor blockers, resolve the budget PDF path integrity gap, validate an additive migration locally and in QA, and progress through the requested release gates without touching DR. Production changes, commit, push and deploy depend on the earlier gates in the user's release sequence.

## Current evidence

- QA ref `zxvpyxvhymuibaxgxetf` has migrations 0001–0032 and 117 classified Security Advisor findings in ignored artifacts. Three callable internal helpers are release blockers.
- Production ref `sqouddqzpmkofenyufuj`; DR ref `qprzxkolbbnqfopamfhj`.
- Worktree was dirty before this task. Preserve all existing edits.
- Historical migrations 0001–0032 are immutable. Existing app and tests contain no direct calls to the three helpers; their callers are SQL wrappers/triggers.

## Scope and ownership

| File group | Planned change | Owner |
| --- | --- | --- |
| New migration 0033 | Revoke three helper grants; bind PDF path to budget; low-risk trigger grants | Main agent |
| Focused integration tests | Direct denial, valid wrappers, PDF path denial | Main agent |
| Local homologation runner and test expectations | Recognize migration 0033 | Main agent |
| Release attestation and evidence | Add gate only after QA evidence | Main agent |
| Security/call graph/PDF/release review | Independent read-only analysis | Specialist agents |

## Database and security

- Keep the existing SECURITY DEFINER owners and fixed search paths. Internal callers must continue working after client EXECUTE is revoked.
- Evaluate trigger-only grants separately and test legitimate trigger execution.
- Reject budget PDF paths whose prefix differs from the budget ID. Keep authorized path behavior and RLS.
- Do not edit historical migrations, relax RLS, expose service_role, or copy real data.
- Reprove exact target before any remote mutation. No Production mutation before QA, homologation, attestation, Production preflight and recovery gates pass.

## Stages

| Stage | State | Evidence |
| --- | --- | --- |
| Analyze call graph and current state | In progress | `rg` of app, scripts, tests and migrations; independent reviewers |
| Implement additive migration and tests | Pending | New migration and focused integration |
| Local laboratory and full applicable tests | Pending | Recorded commands and counts |
| Independent security review | Pending | Reviewer report after diff |
| QA migration/advisors/smoke/cleanup | Pending | Guarded QA evidence |
| Final homologation and release attestation | Pending | Fingerprint-matched evidence |
| Production preflight/recovery/plan | Pending | Read-only evidence before mutation |
| Commit, push, Production migration/deploy/smoke | Pending | Only after all dependent gates |

## Risks and stop conditions

- SQL helper grant revocation may affect authorized wrappers; integration must prove they still work.
- A Production project that is inactive, contains real data without suitable recovery, or lacks a safe deploy sequence stops the release.
- Any failed critical test, new security blocker, QA residue, fingerprint mismatch or unknown environment target stops downstream mutations.
