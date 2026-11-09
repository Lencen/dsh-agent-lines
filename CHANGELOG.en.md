# Changelog

English | [中文](CHANGELOG.md)

## 0.3.7 (2026-11-09)

- Added line_handoff: structured handoff snapshots (JSON/Markdown), no model call.
- line_status / line_list now expose lifecycle/title/generation/pending/lastActivityAt/oldSessionId.
- rebind sends a noReply handoff notice to the new line; replace reuses the onboarding message.
- list --json can feed an external dashboard; added examples/dashboard notes.
- Tests 33/33 pass.

## 0.3.6 (2026-11-09)

- Added line lifecycle: line_retire, line_rebind, line_create replace:true, line_rename.
- Schema v7: lines.title/lifecycle/generation/rebind_at/rebind_from + line_events audit; additive migration from v6.
- Backlog migration: queued/claimed migrate; delivered/acked are never re-delivered; migrate:none fails closed when backlog is non-empty.
- Persistent titles: line_create/line_rename write lines.title and survive restarts.
- Tests 32/32 pass; existing 0.3.5 behavior unchanged.

## 0.3.5 (2026-11-05)

- Integrated P0/P1 bootstrap: line_create queues an onboarding message by default, adds bootstrapOnCreate, and line_status/line_list expose materialized / visibleInSidebar / bootstrapQueued.
- Kept the 0.3.4 docs and wording; README bootstrap notes were added manually on top of 0.3.4, not overwritten from the older local tree.
- No schema change; remains v6.

## 0.3.4 (2026-11-05)

- Removed the conflicting suggestion that one-off subtasks should use subagent / Agent Teams.
- The plugin is positioned for long-running, multi-role teams that need durable messages; one-off subtasks are left to the user's DSH-native choice.
- Synced the npm package and Release artifact; no runtime behavior change; schema remains v6.

## 0.3.3 (2026-11-04)

- Scenario-first landing page: hero, three cards, four-step real usage, first-use claim prompt, restart note.
- Landing page and social-preview are now included in the npm package and GitHub Release artifact.
- No runtime behavior change; schema remains v6.

## 0.3.2 (2026-11-04)

- Zero-config bootstrap: with no plugin config, start one unbound manager line; a root Session can call line_claim_manager to bind itself.
- Default DB path follows DSH_HOME; without it, still ~/.dsh/agent-lines/lines.db.
- README now requires a DSH Web restart after install/update; explicit manager/worker config is optional.
- No schema change; remains v6.

## 0.3.1 (2026-11-04)

- README is now user-first: scenarios and install come first; technical details are later.
- Added install.sh, which picks the DSH Web profile automatically and verifies agent-lines.
- The npm 0.3.1 package now carries the same bilingual README and install docs as the public repo.
- No runtime behavior change; schema remains v6.

## 0.3.0 (2026-11-04)

- Transport seam (`transport: sqlite` default).
- `line_create` resolves the manager workspace and passes `workspaceId`, so created lines are attached to the workspace instead of "Ungrouped"; optional `workspace` argument for an existing workspace.
- `line_move_workspace` attaches an existing line Session to a workspace whose path matches its cwd.
- Echo guards: self-send disabled by default, 5s default dedupe window, `maxReplyDepth` (default 8), `noReply` messages, and hop/root metadata.

- Read-only `line_status` visible to every Session, including unbound ones.
- `dsh-agent-lines claim --line manager --session <id>`: writes a durable claim request; the running plugin rebinds the manager line without a restart.
- `manager_bindings` persistence: the claimed manager Session survives a restart even when the profile config still names an older Session.
- Startup validates configured Sessions via `sessionPersistence.stat`; missing Sessions stay unbound instead of appearing online.
- `line_claim_manager` global tool: a live root Session can bind itself with `confirm: "bind-manager"`; CLI claim remains the fallback.
- `allowClaim` config gates claim polling (default false).
- Schema v6: `claim_requests`, `manager_bindings`, and message `hop`/`no_reply`/`root_message_id`.

## 0.2.0 (2026-11-04)

- Multi-line support in one DSH process: `lines[]` config, Session→line mapping, per-line delivery loops and per-agent prompt sections.
- `line_create` for the configured manager line (`allowCreate`, `createFrom`): creates an ordinary DSH Session in the manager's cwd and registers it as a line.
- Idempotent creation by label (`created:false`) and `maxLines` bound (default 16).
- `role` and `created_by` columns with automatic migration; managers restore their created lines on startup.
- Legacy single-line config (`line`/`sessionId`) remains supported.
- Line tools are scoped to bound Sessions; unbound chats no longer see them.
- Process-exit lease release reduces `LINE_LEASE_HELD` after a fast restart.

## 0.1.0 (2026-11-04)

- First MVP: local SQLite line registry and durable message queue.
- Owner-process delivery through `ctx.sessionController.prompt` with `requestId` idempotency.
- Leases, heartbeats, stale-claim recovery, exponential retry, TTL.
- Tools: `line_list`, `line_send`, `line_inbox`, `line_ack`.
- CLI: `list`, `send`, `inbox`, `ack`, `doctor`, `tail`.
- Explicit `delivered` vs `acked`; at-least-once with effectively-once Session log semantics.
- Local filesystem check (NFS/CIFS/SMB/FUSE refused).

Not included: HTTP transport, Web UI, Postgres adapter, automatic process wake.