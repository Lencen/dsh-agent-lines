# Changelog

English | [中文](CHANGELOG.md)

## 0.8.0 (2026-11-10)

> User decision 2026-11-10: no separate 0.7.1; docs fixes are folded into this release; **ship as soon as dev+tests (including business tests) are done, no fixed window**. Release execution is scheduled by the commercialization line and performed by github-maintenance-line.

### Documentation fixes (landed; folded from the former 0.7.1 candidate)

- Fix the 0.6.6 gate wording: the `check-bento-alignment` script exists but in the **lions repository**, not in this package and not part of `npm test` (cross-repository reference); the 0.7.0 GitHub Release notes were corrected too.
- AGENT-TEAMS (both languages): task-tree parent/child relations are projected by the lines layer (`parentTaskRef` → `parentTaskId`); the board field table now lists `parentTaskId`.
- PHILOSOPHY (both languages) glossary: map L1/L2/L3 to manager line / role line / official team (department / department team).
- README (both languages): "UIUX 0.6 bento rules" → "the UIUX line's Bento spec (DESIGN-SPEC §11)".

### Visibility and remediation (S1)

- `message_events` (append-only message-level event stream) + schema **v13** (additive; older DBs get the table automatically).
- `line_messages({ line?, states?, since?, limit? })`: query by state (including `failed`/`expired`) with `counts.byState`; the manager may query any line.
- `line_trace({ messageId })`: full lifecycle timeline (state/time/attempt/actor/error).
- `line_redeliver({ messageId, to?, resetAttempts? })`: manager only, `failed`/`expired` only, may retarget another line of the same agent, writes an audit event.
- `line_purge({ before, states?, dryRun? })`: manager only, `before` required, `dryRun` defaults to true, terminal states only, writes a `purged` event before deleting.
- `ackTimeoutMs` (default 600000): overdue `delivered` messages are flagged and counted (`line_metrics.messages.ackOverdue`), **never auto-redelivered** (preserves I2).
- CLI `doctor`: reports `health { failed, expired, ackOverdue }` plus next-step hints; `tail --line` shows every state.
- New in-package gates: `scripts/check-bento-alignment.mjs` (9 checks) and `scripts/check-docs-consistency.mjs` (11 checks), both wired into `npm test`.
- Crash-injection test `test/crash-injection.test.js`: kill -9 ×100 converges with zero unexplained messages.
- Details: `dsh-agent-lines-internal/DESIGN-0.8.0-S1-2026-11-10.md` and `TRAIN-0.8.0-2026-11-10.md`.

## 0.7.0 (2026-11-10)

This release is a **design-constitution release**: no behavior change.

### Breaking

- None.

### Non-breaking

- Add `docs/PHILOSOPHY.md` / `docs/PHILOSOPHY.en.md`: design philosophy, the pivot (label + sessionId), invariants I1–I7, five tradeoffs, non-goals, evolution rules, glossary.
- Add `docs/KNOWN_ISSUES.md` / `.en`: design boundaries (B1–B8), known gaps (G1–G9, with target versions), known traps (K1–K8), and what to include in a report.
- Add `docs/DELEGATION-POLICY.md` / `.en`: delegation policy v1 for **should the role line do it or open an internal team** (7 dimensions, A/B rules, `subteamPolicy` semantics, standard steps, update loop).
- README/AGENT-TEAMS (both languages) explain the three levels after integration and "who does the work".
- README (both languages) gains a "Design philosophy" section; the docs site nav and footer link to it.
- CHANGELOG now separates breaking and non-breaking changes.

### Corrections to earlier wording

- The read-only board cut **already shipped in 0.6.6** (see the 0.6.6 entry); 0.7.0 no longer declares it again.
- The docs site linked to a `v0.7.0` Release that did not exist; it now points to `releases/latest`.
- README "Limitations" no longer claims "no handover" (handoff / rebind / replace exist since 0.3.6); status version `0.3.x` → `0.7.x`.
- The 0.6.6 entry claimed a "check-bento-alignment gate": the script **does exist**, but in the **lions repository** (`lions/scripts/check-bento-alignment.cjs`), not inside this plugin package and not part of `npm test` (`test/*.test.js`) → for the plugin release it was a **cross-repository reference**, not reproducible. Reworded; shipping an in-package gate wired into `npm test` is now a 0.8.0 item.

## 0.6.6 (2026-11-10)

- Rebuild the web board to the UIUX 0.6 eight-rule bento layout.
- Org tree + overview/tasks/department/communications/metrics views; fixed slots; equal-height rows; inner scrolling; data-level; breadcrumbs.
- The read-only board cut **ships in this version** (0.7.0 does not declare it again).
- Add the browser E2E script `test/uiux-board-e2e.mjs` (standalone, requires playwright, not wired into `npm test`).

## 0.6.5 (2026-11-09)

- Web board adds local manager actions: send message, approve/reject pending, handoff.
- Actions require x-board-token; still localhost-only; read-only without token.
- No hard subteam enforcement; hard limits wait for official API.

## 0.6.4 (2026-11-09)

- Add built-in read-only web board: dsh-agent-lines board.
- Defaults to 127.0.0.1:4090; reads team-board.json / team-board.<line>.json.
- Org/task view and department drawer; no write API; not public by default.

## 0.6.3 (2026-11-09)

- Add line_metrics: manager-only read-only data board.
- Current task/line/team counts; message kind/state and daily trend; per-line current tokens.
- Explicitly no official task timestamps or per-task tokens; no invented trends.

## 0.6.2 (2026-11-09)

- Add line_communications: manager-only read-only communication board; filter by line/task/kind/state.
- Explicitly does not expose official internal sub-agent private messages.
- Read-only; no message state change.

## 0.6.1 (2026-11-09)

- subteamPolicy (auto/ask/never) and maxMembers message fields; schema v12.
- line_team_board tasks expose subteamPolicy/maxMembers.
- line_department_board adds subteamAudit (members/tasks/policies/maxMembers/overLimit).
- Records/shows/audits only; does not block official spawn.

## 0.6.0 (2026-11-09)

- line_department_board: lazily read a line's official team (lead/members/tasks/summary/messages).
- line_team_board lines[] adds officialTeamLead/officialTeamAvailable/deptSummary.
- line_send adds parentTaskRef; schema v10; parentTaskId projection for the task tree.
- Read-only; no merging into the parent task board; no task writes.

## 0.5.1 (2026-11-09)

- line_team_board writes a host snapshot at DSH_HOME/agent-lines/team-board.json (0600, atomic replace).
- Board contract adds messages[], quality[], team, approval detail, deliveries, schemaVersion, epoch-ms generatedAt.
- The manager refreshes it by calling the board; no user export/config.

## 0.5.0 (2026-11-09)

- Add line_team_board: manager-only read-only board that auto-reads ctx.agentTeams.listTasks/listMembers + lines.db.
- Auto maps teammate name/role to lines; unlinked when missing; no user export/config.
- available=false when Agent Teams is unavailable or the manager is not a member.
- line_send adds taskRef, linking messages to Agent Teams tasks; schema v9 additive.
- Read-only; no task/message writes; no manager turn.
- Docs: docs/en/AGENT-TEAMS.md + static board example.

## 0.4.1 (2026-11-09)

- Fix F1: after line_create replace / line_rebind, the new line did not re-acquire a lease, leaving it offline and messages queued until restart.
- Regression test: the replaced line must have a live lease.
- No schema change; 0.4.0 kinds/approval/docs/landing unchanged.

## 0.4.0 (2026-11-09)

- Message governance: line_send adds kind (info/request/task/alert) and ccManager; a non-manager task becomes pending_approval and is delivered only after line_manager_ack.
- Schema v8: messages.kind/cc_manager/approval_state/approved_by/approved_at; additive migration.
- Added line_manager_ack (approve/reject).
- line_observe shows kind/ccManager/approvalState; pending tasks do not enter the target inbox.
- README is team-agnostic; GitHub Pages is rewritten for beginners (DSH-assisted install, novel/video/dev scenarios, restart handoff card).

## 0.3.9 (2026-11-09)

- Added read-only line_observe: a manager feed of cross-line messages without prompts or state changes.
- Added CLI observe --json.
- README now documents version-by-version business scenarios; fixed line_handoff version (0.3.7).
- No schema change; line_send semantics unchanged.

## 0.3.8 (2026-11-09)

- line_status / line_list expose activity: turns/steps/decodeTokens/level/lastActivityAt.
- activityLevel is an activity proxy, not a context-window percentage; DSH does not expose context usage.
- Remains compatible with the 0.3.6/0.3.7 lifecycle/title work.
- Tests 35/35 pass.

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