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
| G1 | `failed` / `expired` invisible to agent tools | Only CLI `tail --line` shows them; models learn about failure from "I never got it", violating invariant I6 | 0.8.0 (`line_messages` by state) |
| G2 | No `line_redeliver` / `line_purge` | Failed messages can only be redelivered or cleaned by editing SQLite by hand | 0.8.0 |
| G3 | `delivered` has no ack timeout | A message can sit in `delivered` forever (agent crashed or forgot to ack) | 0.8.0: **flag and count only**, never auto-redeliver (that would break I2) |
| G4 | No message-level event stream | Only line-level `line_events`; cannot answer "how many times a message was claimed, where it stalled, queueing vs processing time" | 0.8.0 (`message_events` + `line_trace`) |
| G5 | No `protocolVersion` in the envelope | Implementations of different versions cannot negotiate, reject, or degrade | 0.9.0 |
| G6 | Protocol not machine-checkable | No JSON Schema, no conformance suite | 0.9.0 |
| G7 | No DSH capability probing | Hard version range `>=0.2.1-rc.5 <0.3.0`; a new rc may break everything instead of degrading | 0.9.0 (probe + graceful degradation) |
| G8 | No cost controls | `line_metrics` exposes per-line `decodeTokens` but no daily deltas, rate, budget or idle hibernation | 0.10.0 |
| G9 | Team shape is not a file artifact | Teams are generated in conversation; not reproducible, reviewable, or portable | 0.10.0 evaluation (`team.yaml`, must respect I5: validate, never intercept) |

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
