import { describe, expect, it } from "vitest";
import { assertOwnedActorIdentity, assertOwnedInvitation } from "../scripts/homologacao/provision-actors.mjs";

const actor = { name: "QA_DENTISTA_A_reserved", role: "dentista", invitationId: "own-invite" };
const definition = { role: "dentista" };
const manifest = { databaseStartedAt: "2026-10-09T12:00:00Z" };
const row = { id: "own-user", nome: actor.name, perfil: "dentista", status: "ativo",
  created_at: "2026-10-09T12:01:00Z" };
const invitation = { id: "own-invite", created_by: "own-admin",
  consumed_at: "2026-10-09T12:01:00Z", usuario_id: "own-user" };

describe("QA actor ownership before any password mutation", () => {
  it("requires the exact reserved identity, role, active state and creation window", () => {
    expect(() => assertOwnedActorIdentity(row, actor, definition, manifest)).not.toThrow();
    for (const changed of [
      { nome: "QA_DENTISTA_A_foreign" }, { perfil: "administrador" }, { status: "inativo" },
      { created_at: "2026-10-09T11:59:00Z" },
    ]) expect(() => assertOwnedActorIdentity({ ...row, ...changed }, actor, definition, manifest))
      .toThrow("QA_ACTOR_EXISTING_IDENTITY_UNOWNED");
    expect(() => assertOwnedActorIdentity(row, { ...actor, authUserId: "another-user" }, definition, manifest))
      .toThrow("QA_ACTOR_EXISTING_IDENTITY_UNOWNED");
  });

  it("requires the exact consumed invitation linked to that Auth user", () => {
    expect(() => assertOwnedInvitation(invitation, actor, "own-admin", "own-user")).not.toThrow();
    for (const changed of [
      { id: "other-invite" }, { created_by: "other-admin" }, { consumed_at: null }, { usuario_id: "other-user" },
    ]) expect(() => assertOwnedInvitation({ ...invitation, ...changed }, actor, "own-admin", "own-user"))
      .toThrow("QA_ACTOR_INVITATION_UNOWNED");
  });
});
