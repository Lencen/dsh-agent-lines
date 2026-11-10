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
| B7 | `maxLines` (default 16) is a deployment-level cap | Not a per-line/per-task hard limit; the official plugin exposes neither per-line caps nor a pre-spawn interception API |
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
| K2 | A blank line Session may only persist after its first task | An onboarding message is queued by default (disable with `bootstrap:false`, but the line may then be missing from the sidebar) |
| K3 | `line_create` may succeed while `attachSession` fails, leaving an orphan Session | The error carries `detail.sessionId`; nothing is deleted automatically |
| K4 | Duplicate labels cannot be recreated | `line_create` returns `created:false`; use `line_create({ replace: true })` / `line_rebind` |
| K5 | `inactive` does not mean offline | It only means no turn is currently running; a message wakes the line |
| K6 | Deleting a Session kills the line | Messages then fail permanently (`session/not-found`) |
| K7 | Opening a line's Session in another DSH process | `session/writer-held`; close that view or give the line a dedicated Session |
| K8 | Users who patched 0.3.5 locally | Title renaming was patched into `lib/index.js`/`lib/tools.js`; 0.6.x ships `line_rename`, so the patch can be reverted |

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
