# AGENTS.md — operation contract for AI assistants

> **Read this before driving or editing dsh-agent-lines.** Human-facing docs live in [README](README.md); design rationale in [PHILOSOPHY](docs/PHILOSOPHY.md); wire format in [PROTOCOL](docs/PROTOCOL.md); known gaps in [KNOWN_ISSUES](docs/KNOWN_ISSUES.md).
> This file is the canonical machine-facing contract. When README prose and this file disagree, **this file wins for operational details** (and the mismatch is a docs bug).

## 0. Project identity

- **What it is**: a DeepSeek Harness (DSH) **community plugin**, not a standalone app, not an official DeepSeek product.
- **What it does**: long-lived role lines (named Sessions) with durable messaging, so a lead agent can run a team across restarts and role handoffs.
- **Compatibility**: DSH `>=0.2.1-rc.5 <0.3.0`; Node `^22.19.0 || >=24.0.0`; local filesystem only (NFS/CIFS/SMB/FUSE refused with `LINE_NETWORK_FILESYSTEM`).

## 1. Runtime and storage (required fields)

| Item | Value |
|---|---|
| Runs inside | the DSH Host process (plugin), not a separate daemon |
| Default DB | `DSH_HOME/agent-lines/lines.db` (`DSH_HOME` defaults to `~/.dsh`); override with config `dbPath` or env `DSH_AGENT_LINES_DB` |
| DB mode | SQLite + WAL; file `0600`, directory `0700` |
| Schema version | **14** (`PRAGMA user_version`); additive migrations only |
| Cross-machine | **not supported** (local lease + local SQLite by design) |

## 2. Configuration keys

`createFrom` names the manager line. **Zero-config** means no `lines`/`line`/`sessionId` is provided: the plugin then creates an unbound `manager` line and defaults `allowCreate`/`allowClaim` to `true`.

| Key | Type | Default | Notes |
|---|---|---|---|
| `createFrom` | label | first configured line, else `manager` | **Only this line may call `line_create`** |
| `lines[]` | array | zero-config single `manager` | `{label, sessionId}`; labels unique, sessionIds unique |
| `allowCreate` | boolean | `true` only in zero-config, else `false` | Enables `line_create` for the manager |
| `allowClaim` | boolean | `true` only in zero-config, else `false` | Enables `line_claim_manager` |
| `bootstrapOnCreate` | boolean | `true` | Queue an onboarding message so a new Session is non-blank |
| `allowSelfSend` | boolean | `false` | Allow sending to your own line |
| `ackTimeoutMs` | int ms | `600000` (min 60000) | **Report-only**: flags overdue `delivered`, never auto-retries |
| `dbPath` | path | see §1 | Must be a local filesystem |
| `pollMs` | int ms | `500` | Delivery loop tick |
| `leaseTtlMs` | int ms | `30000` | Owner lease heartbeat |
| `claimBatch` | int | `20` | Messages claimed per tick |
| `claimTimeoutMs` | int ms | `30000` | Stale `claimed` requeued after this |
| `deliveryTimeoutMs` | int ms | `30000` | DSH prompt acceptance timeout |
| `maxAttempts` | int | `8` | After that a message becomes `failed` |
| `maxMessageBytes` | int | `65536` | Oversize rejected with `LINE_MESSAGE_TOO_LARGE` |
| `dedupeWindowMs` | int ms | `5000` | Same-body sends collapse unless `forceDistinct` |
| `maxReplyDepth` | int | `8` | `replyTo` chain limit (`LINE_REPLY_DEPTH_EXCEEDED`) |
| `maxLines` | int | `16` | Deployment-level cap, **not** per-line/per-task |
| `childPreset` | string | `standard` | DSH agent preset for created lines |
| `transport` | string | `sqlite` | `sqlite` or `memory` (in-memory SQLite; proves the transport seam and keeps tests instant) |

## 3. Tool contracts (22 tools)

Manager-only unless noted. "Delivered" = peer messages addressed to the calling line.

| Tool | Caller | Key parameters | Effect |
|---|---|---|---|
| `line_create` | manager | `label`, `replace?`, `force?`, `migrate?(queued|none)`, `bootstrap?`, `agentPreset?`, `workspace?`, `cwd?` | Creates a new Session and registers the line; reusing a label returns `created:false` |
| `line_send` | anyone | `to`, `text`, `kind?(info|request|task|alert)`, `replyTo?`, `noReply?`, `taskRef?`, `parentTaskRef?`, `subteamPolicy?(auto|ask|never)`, `maxMembers?` | Durable enqueue; `task` from non-manager needs manager approval |
| `line_inbox` | anyone | `limit?`, `includeAcked?` | Read **delivered** messages, does not mark read |
| `line_ack` | anyone | `messageId` | Marks delivered → acked |
| `line_status` | anyone | — | Binding/manager/line health (§5) |
| `line_list` | anyone | — | Lines, online status, unread, activity |
| `line_messages` | anyone (own line); manager (any) | `line?`, `states?[]`, `since?`, `limit?` | Query by state incl. `failed`/`expired` + `counts.byState` |
| `line_trace` | manager or involved line | `messageId` | Lifecycle timeline from `message_events` |
| `line_redeliver` | manager | `messageId`, `to?`, `resetAttempts?` | Only `failed`/`expired`; requeue + audit event |
| `line_purge` | manager | `before` (required), `states?`, `dryRun?` (default true) | Delete terminal messages; writes `purged` events |
| `line_handoff` | manager | `line`, `format?(md|json)`, `limit?` | Structured handoff snapshot (no model call) |
| `line_retire` | manager | `line`, `reason?` | Soft retire; keeps Session/history |
| `line_rebind` | manager | `line`, `sessionId`, `migrate?`, `force?` | Point label at another Session |
| `line_rename` | manager | `line`, `title?` | Sidebar title |
| `line_move_workspace` | manager | `line`, `workspace` | Attach only when Session cwd == workspace path |
| `line_claim_manager` | any root | `confirm:"bind-manager"` | Binds this root Session as manager (needs `allowClaim`) |
| `line_manager_ack` | manager | `messageId`, `decision?(approve|reject)` | Approve/reject pending `task` messages |
| `line_observe` | manager | `line?`, `since?`, `limit?` | Read-only cross-line feed |
| `line_communications` | manager | filters | Read-only communication board |
| `line_metrics` | manager | `days?` | Read-only data board (+ `messages.ackOverdue`) |
| `line_team_board` | manager | — | Read-only official Agent Teams board + host snapshot |
| `line_department_board` | manager | `line` | Lazily read one line's official team/tasks |

## 4. Hard constraints (MUST / MUST NOT)

- **MUST** be the configured manager line to call `line_create`; **MUST NOT** enable `allowCreate` on worker profiles.
- **MUST NOT** open a line's Session in another DSH process while the line process serves it (DSH rejects with `session/writer-held`; the message eventually fails).
- **MUST NOT** delete a line's Session: delivery then fails permanently (`session/not-found`); use `line_retire`.
- **MUST NOT** auto-retry a delivered message to "fix" a missing ack: it breaks invariant I2 (at-most-once effect). Use `line_ack` or an explicit `line_redeliver`.
- **MUST NOT** write to the official Agent Teams board: the integration is read-only (non-goal).
- **MUST** keep the invariants I1–I7 in [PHILOSOPHY](docs/PHILOSOPHY.md); breaking one is a bug.

## 5. `line_status` fields

| Field | Meaning |
|---|---|
| `current` | `{sessionId, bound, line, role, title, lifecycle}` for the calling Session |
| `manager` | `{label, sessionId, live, persisted, lease}`; `live` = Session materialized in this process, `persisted` = Session file exists on disk |
| `lines[]` | `label, role, title, lifecycle(active|retired), generation, oldSessionId, pending, lastActivityAt, sessionId, createdBy, lease, live, materialized, activity` |
| `allowClaim` / `bootstrapOnCreate` | effective config |
| `repair` | human-readable next step (e.g. bind the manager, or recreate a missing Session) |

`materialized` = the Session object exists in this process; `live` = it is currently running. `inactive` is **not** offline.

## 5b. Capabilities and degradation

`line_status.capabilities` reports what the running DSH profile exposes: `session.create`, `session.prompt`, `session.rename`, `session.isLive`, `session.persistence`, `workspace.resolveByPath`, `workspace.attach`. `true` = observed, `false` = unavailable, `null` = indirect/unknown. Missing `session.create` -> `LINE_CAPABILITY_MISSING` (clear error, not a crash); missing workspace registry AND an explicit `workspace` argument -> `line_create` falls back to cwd and returns `workspaceFallback: 'registry-unavailable'` (without an explicit workspace request, cwd is used silently).

## 6. Versioning and gates (before any release)

```bash
npm test   # unit 97 + docs consistency 13 + bento 9 + business smoke 9
```

- Breaking = envelope fields, state-machine semantics, error-code meaning, invariants → CHANGELOG "breaking" section + minor bump.
- Release execution belongs to **github-maintenance-line**; this line ships candidate package + execution sheet only (never push/tag/Release/npm publish).

## 7. Where to change what

| Change | File(s) |
|---|---|
| Store/SQLite/events | `lib/store.js` |
| Tools (model-facing) | `lib/tools.js` |
| Plugin wiring/config | `lib/index.js` |
| Envelope/state machine/error codes | `lib/protocol.js` + `docs/PROTOCOL.md` |
| Delivery loop | `lib/delivery.js` |
| CLI | `bin/dsh-agent-lines.js` |
| Gates | `scripts/check-docs-consistency.mjs`, `scripts/check-bento-alignment.mjs`, `scripts/business-smoke.mjs` |
| Protocol schema | `schema/envelope.v0_4.json`, `schema/message.v0_4.json` |
| Conformance cases | `conformance/cases/*.json` + `conformance/README.md` |
| Human docs | `README.md` (+ `.en.md`), `docs/*.md` (+ `.en.md`), `docs/*.html` |

## 8. Common AI mistakes to avoid

1. Assuming a worker line can create more lines → needs `allowCreate` and must be `createFrom`.
2. Assuming `inactive` means offline → it only means no turn is running.
3. Assuming failed messages are lost → `line_messages({states:["failed"]})` + `line_redeliver`.
4. Assuming a missing ack should be retried automatically → never; report and decide.
5. Assuming the official task board can be written to → read-only fusion.
6. Assuming cross-machine/multi-active → local only.
