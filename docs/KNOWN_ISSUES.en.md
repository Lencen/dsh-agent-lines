# Known issues and boundaries

English | [中文](KNOWN_ISSUES.md)

> This file lists **what is known to break** and **what is deliberately not built**.
> Writing it down is not weakness: it lets users plan ahead, lets issues cite it, and lets upgrades be evaluated.
> Design rationale: [PHILOSOPHY](PHILOSOPHY.en.md). Operations: [DEPLOY](DEPLOY.en.md).

## 1. Design boundaries (not bugs, will not be "fixed")

| # | Boundary | Detail |
|---|---|---|
| B1 | One plugin instance serves one manager/team | Running several teams inside one DSH process is unsupported; a separate profile/DB is a workaround, not the product model |
| B2 | One DSH Session has one writer | Opening a line's Session from another DSH process (e.g. the main Web UI) yields `session/writer-held`; the message eventually fails after the retry budget |
| B3 | No cross-machine, no active-active | Local SQLite + local lease (PHILOSOPHY T3) |
| B4 | No process isolation, no in-plugin policy sandbox | Permissions belong to DSH itself (`agentPreset` / tool allowlists) |
| B5 | No static encryption, no sender signatures | Data at rest relies on full-disk encryption; peer content is prompt-level mitigation, not a hard boundary ([SECURITY](SECURITY.en.md)) |
| B6 | Network filesystems unsupported | Databases on NFS/CIFS/SMB/FUSE are rejected with `LINE_NETWORK_FILESYSTEM` |
| B7 | `maxLines` (default 16) is a deployment-level cap | Not a per-line/per-task hard limit; the DSH official Agent Teams plugin (built into DSH) exposes neither per-line caps nor a pre-spawn interception API |
| B8 | Read-only fusion with the official board, no write-back | PHILOSOPHY T5 |

## 2. Known gaps (pending, with target version)

| # | Gap | Symptom / impact | Plan |
|---|---|---|---|
| G1 | ✅ Closed in **0.8.0**: `failed` / `expired` invisible to agent tools | `line_messages` by state and `line_trace` timeline | 0.8.0 |
| G2 | ✅ Closed in **0.8.0**: no `line_redeliver` / `line_purge` | Provided (purge defaults to dryRun, requires before) | 0.8.0 |
| G3 | ✅ Closed in **0.8.0**: `delivered` has no ack timeout | `ackTimeoutMs` flags and counts only (`line_metrics`); never auto-redelivers | 0.8.0 |
| G4 | ✅ Closed in **0.8.0**: no message-level event stream | `message_events` (schema v13) + `line_trace` | 0.8.0 |
| G5 | ✅ Closed in **0.9.0**: no `protocolVersion` in the envelope | Envelopes carry `protocolVersion` (0.4); major/minor rules in PROTOCOL "Version negotiation" | 0.9.0 |
| G6 | ✅ Closed in **0.9.0**: protocol not machine-checkable | `schema/envelope.v0_4.json` + `schema/message.v0_4.json` + `conformance/` (7 suites / 25 cases, runnable from any language) | 0.9.0 |
| G7 | ✅ Closed in **0.9.0**: no DSH capability probing | `line_status.capabilities` (three-state) + `LINE_CAPABILITY_MISSING` + workspace degradation; version range not widened | 0.9.0 |
| G8 | Partially closed (0.10.0 S3a+S3b): no cost controls | Daily deltas/rates (`line_metrics.tokens`, estimated) and **idle hibernation** (`line_hibernate`/`line_wake`, three states) are shipped; **budget caps are still missing** | 0.10.0 (S3a deltas/rate + S3b hibernation shipped; budget under evaluation) |
| G9 | Team shape is not a file artifact | Teams are generated in conversation; not reproducible, reviewable, or portable | 0.10.0 evaluation (`team.yaml`, must respect I5: validate, never intercept) |
| G10 | Real context usage is unavailable | Only an activity proxy (turns/steps/lastActivityAt); DSH does not expose per-Session window occupancy, and we never fake a percentage | **Blocked** on DSH; surfaced as soon as 0.9.0 capability probing finds it |
| G11 | Partially closed: snapshots carry `schemaVersion` + `protocolVersion` and fields are additive-only (0.9.0 F7); **no read-only status API yet** | Consumers still read snapshot files | 0.10.0 evaluates a read-only status endpoint |
| G12 | No message priority (jump the queue) | The queue is time-ordered; P0 instructions cannot jump ahead | **Not planned**: conflicts with at-least-once + ack ordering semantics until designed |
| G13 | No line grouping / subteam labels | The department view expresses hierarchy, not cross-cutting groups like "production/QA" | 0.10.0 evaluation |
| G14 | ✅ Closed in **0.8.1**: the published package did not ship its own verification gates | 0.8.0's `files` omitted `scripts/`, so business-smoke and the two gates were not inside the package | 0.8.1 adds `scripts` to `files` |

## 3. Known traps (usage and operations)

| # | Trap | Handling |
|---|---|---|
| K1 | No `line_delete` | Creating lines leaves durable rows; tests leave real data. Use a separate `--db` for tests |
| K2 | A blank Session is hidden from the sidebar until its first turn | Since 0.11.0 `line_create` always bootstraps and waits for `blank=false`; per-call `bootstrap:false` is ignored; only deployment-level `bootstrapOnCreate:false` keeps a line hidden |
| K3 | `line_create` may succeed while `attachSession` fails, leaving an orphan Session | The error carries `detail.sessionId`; nothing is deleted automatically |
| K4 | Duplicate labels cannot be recreated | `line_create` returns `created:false`; use `line_create({ replace: true })` / `line_rebind` |
| K5 | `inactive` does not mean offline | It only means no turn is currently running; a message wakes the line |
| K6 | Deleting a Session kills the line | Messages then fail permanently (`session/not-found`) |
| K7 | Opening a line's Session in another DSH process | `session/writer-held`; close that view or give the line a dedicated Session |
| K8 | Users who patched 0.3.5 locally | Title renaming was patched into `lib/index.js`/`lib/tools.js`; 0.6.x ships `line_rename`, so the patch can be reverted |
| K9 | MACS client local spool may replay messages that are already terminal on the platform | Entries whose platform `delivery_status=read/expired/deleted` **must be dropped, never injected** (query platform status by mid before replay; drop if unknown). Root fix lives in `packages/lions_client` (owner=macs-backend-2); the plugin does not implement it | Gate: `node scripts/check-spool-replay-age.cjs` (in the **lions repo**, not this repo); mark "fixed" once the client ships the fix |

## 4. How to report a problem

Include all four; missing one makes triage hard:

1. Versions: plugin + DSH + Node;
2. Site: `dsh-agent-lines --json doctor` and `dsh-agent-lines --json list` output;
3. Message: the message id (`msg_...`) and its current state;
4. Expected vs actual, in one sentence.

For failed messages (until G1 is fixed): `dsh-agent-lines --json tail --line <line>` lists every state for that line.

## 5. Related documents

| Document | Content |
|---|---|
| [PHILOSOPHY](PHILOSOPHY.en.md) | why it is designed this way, invariants, non-goals |
| [DEPLOY](DEPLOY.en.md) | deployment, writer conflicts, operations |
| [PROTOCOL](PROTOCOL.en.md) | message state machine and error codes |
| [SECURITY](SECURITY.en.md) | trust model and "what we do not do" |

## 6. Naming drift (known boundary since 0.12.0)

- DSH sidebar titles can be renamed manually and may drift from the DB title / charter header; the plugin cannot read sidebar titles today, so this is a **documented convention only**; the read-only titleCheck API lands in 0.13.
- The board reads only the DB and charters: it can show registry-vs-title mismatches but not sidebar drift.

## 7. 0.13 backlog: five-block overview redesign

- The 0.12.0 board integration covers the L1.5 list in the tasks view, standalone work-item/member pages and four metrics; it does **not** include the five-block overview redesign (goal / plan / workflow / rhythm / L1.5).
- That redesign is planned for 0.13; the overview stays as-is until then.

## 8. 0.14 data gaps (explicit 未采集, never fabricated)

| ID | Gap | Current state / required fields | Suggested owner |
|---|---|---|---|
| D1 | work-items entity contract | /api/work-items is still a stub (available:false); needs id/title/status/stage/linkedRefs/sourceMessageId/planStartEnd. Sample data has been removed from the default view; the page now shows "未接入" (workItems contract v0.7) | plugin (contract v0.7) |
| D2 | per-role agent ownership | team-board.members[] only has lead, no line/label ownership; needs a line field | macs/official projection |
| D3 | member-level runs / tokens | only per-line (session-level) sampling; must not be split per member; needs a member-level token projection | plugin + DSH projection |
| D4 | work duration / parallel semantics | no sampled duration or parallel-semantics field | plugin (sampling) |
| D5 | official L3 task view | official Agent Teams task API has no L3 view; snapshot-expiry rule: a team-board.json whose generatedAt is older than 24h must not show numbers — show "未采集（快照过期 · 最近更新 <date>）" explicitly | macs/official |
| D6 | task completion/cancel terminal state | no task-state field; only message-terminal approximation is possible today | plugin (contract v0.7) |
| D7 | 104 legacy reference snapshot | no usable 104 snapshot fixture (samples/104-* is static reference only) | uiux |
| D8 | receipts must carry taskRef verbatim | a receipt without taskRef is not aggregated by byTaskRef, so the board task disappears (user-reported 2026-11-24 09:33); receipts must carry taskRef verbatim | all lines (protocol) |
| D9 | legacy board keeps sample data | web/board-legacy.html:700-702 still holds 3 sample tasks; 0.14.2 removed it from the main path (default entry no longer routes here) — registered, not fixed in this version; D9 must not be used to excuse fake data on the default board2 path | plugin (0.15.x) |

> **D9 addendum (Lead 12:06, task E conclusion)**: `web/board-legacy.html` is a **human-authored reference baseline** — its only reader is the V10 criterion at `scripts/board2-views-smoke.mjs:41`, it has no writer, it entered the repo in 74b8368 ("S1 infra: legacy frozen"), and its measured sha256 matches the baseline (MATCH=true). So it is **not machine-rewritten**: no `git rm --cached`, no ignore rule, and the file itself is not modified.

### D6 message-terminal approximation semantics (must know)

- done / in-progress = message-terminal approximation, not task completion state: a task whose messages are all acked is treated as done; tasks with unconfirmed messages are in progress (merged from byTaskRef[].byState).
- Used for factual/approximate display on the data page, task history and work-item completion rate; it is not a task completion state and must not be used as an acceptance conclusion.
- Real task-state fields (D6) are required to replace the approximation.

### 0.14 new read-only fields (S1)

- /api/members: sessionId / agentId / instanceId / createdAt (from lines.session_id/agent_id/instance_id/created_at).
- /api/live: messages.byDay (all days) and messages.byLineDay (last 30 days per line per day; participation = from_line + to_line).
- Field whitelist test: body/text/token/prompt must not leak.

## 9. Design deviations (DESIGN-DEVIATION)

> Intentional deviations from the prototype/upstream are registered here in one place (no separate parity file).
> The Criteria column points at the 0.14.2 acceptance criteria.

| Item | Deviation | Reason | Approved by / date | Criteria |
|---|---|---|---|---|
| 5 KPI cards | the task page KPI grows from 4 (prototype) to 5 (adds "completed") | explicit user request, 2026-11-24 09:30 | user / 2026-11-24 | C6 (0.14.2) |
| No L1.5 samples in the default view | the overview L1.5 area shows 0 rows by default; samples appear only with ?demo=1 | user asked for "real data first, never fake it with samples" | user / 2026-11-24 | C1, C2 (0.14.2) |
| Three-element empty state | the "reason + next step + source" empty state is NOT landed in this round (batch B) | depends on the KPI definition (C6) and UIUX review; honesty first, actionability next | user / 2026-11-24 (pending) | C5 (0.14.2, not landed) |
