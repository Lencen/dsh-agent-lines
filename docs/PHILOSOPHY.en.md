# Design Philosophy

English | [中文](PHILOSOPHY.md) | [Plain-language version (web)](philosophy-plain.html)

> This document answers **why the project is designed this way**, not how to use it.
> Usage: [README](../README.en.md). Layering: [ARCHITECTURE](ARCHITECTURE.en.md). Envelope and state machine: [PROTOCOL](PROTOCOL.en.md). Trust model: [SECURITY](SECURITY.en.md).
>
> Reading order: start with §1 (the pivot), then §3 (invariants — **breaking any one of them is a bug**), then §4 (tradeoffs) and §5 (non-goals).
> Every non-goal can be quoted in an issue to close a feature request.

## 1. One line and the pivot

**One line**: a DSH session is a person, subagents are temporary helpers, tasks are work, files are memory, the manager orchestrates, quality belongs to roles, and the user only states goals.

**Boundary**: the plugin provides organizational infrastructure only (roles / messages / persistence / read-only board); how to decompose, accept and route work is business intelligence, owned by the manager model and role prompts. This is the fundamental difference from DAG workflow engines and chat-bot rosters.

**The pivot (The One Decision)**:

    line = label (stable identity) + sessionId (replaceable carrier)

The reasoning has four steps and everything else follows from it:

1. In DSH, the **only** thing carrying memory across turns is a Session;
2. Therefore a long-lived role must live in a Session, not in a subagent (a subagent is released when its task ends; its persona lives inside the parent session's context and disappears when that context is compacted);
3. But a Session fills up, gets replaced, or is succeeded by a new session;
4. Therefore **identity must not be bound to a Session** → split it into label (who) + sessionId (who is doing it right now).

This yields `line_retire` (the role takes no new work, history is kept), `line_rebind` / `line_create({ replace: true })` (same label, fresh Session, generation+1), and `line_handoff` (compress memory into a handoff note before switching). These are not three features; they are three projections of one decision.

## 2. What each plugin is

DSH's official agent-teams plugin: **several subagents inside one session**.

    DSH session
      └─ subagents in that session (task-scoped, released or reused)

dsh-agent-lines: **several sessions forming one team**.

    multiple DSH sessions
      ├─ manager session
      ├─ developer role session
      ├─ tester role session
      └─ reviewer role session

| Dimension | Official agent teams | dsh-agent-lines |
|---|---|---|
| Unit of organization | subagents inside a session | role lines across sessions |
| Memory carrier | parent session context | each Session's durable history |
| Lifetime | task-scoped, short | role-scoped, across sessions and restarts |
| Task board | yes (DAG, blockers, web panel) | not provided; read-only fusion with the official board |
| Strength | concurrency, decomposition, live projection | stable roles, reliable messaging, no role lost on handoff |

Fused, the three-level organization is:

    manager session
      ├─ role session (department)
      │    └─ subagents inside that role session (department team)
      └─ role session (department)
           └─ subagents inside that role session (department team)

The task tree mirrors it: **total task → line task → official team task**, decomposed top-down and aggregated bottom-up. Each level reports counts (done / in progress / blocked / awaiting acceptance) and **never simply sums them**; completion = required subtasks complete + acceptance passed.

## 3. Invariants

> **Breaking any of them is a bug**, not a UX preference. Before changing anything, ask: which invariant does this touch?

| # | Invariant | Where it is honored |
|---|---|---|
| I1 | At most one live owner process per line at any time | Lease heartbeat `leaseTtlMs` (30s default); `LINE_LEASE_HELD` on conflict, `LINE_LEASE_LOST` on loss (`lib/store.js`) |
| I2 | A given msgId takes effect at most once in the target Session log; the idempotency authority is the DSH Session log, not the SQLite queue | Message id is passed down as `SessionPromptRequest.requestId` (`lib/delivery.js`) |
| I3 | label is constant, sessionId is replaceable; change the person, never the role | `line_rebind` / `replace` swap `session_id` only, `generation+1` |
| I4 | Retired lines never delete their Session or message history | `retire` only sets `lifecycle='retired'`; audit and rollback are preserved |
| I5 | The plugin is not a policy enforcement point: record, display, audit — never hard-block | Read-only fusion with the official task board; `subteamPolicy` records but does not intercept |
| I6 | Any "invisible state" must be queryable by a read-only tool | **Partially unmet**: `failed` / `expired` are visible only via CLI `tail --line`, not through agent tools; see §7 |
| I7 | Peer messages are always delivered as peer content and never promoted to user instructions | Declared both in the injected prefix and the system prompt (`lib/protocol.js`, `lib/prompt.js`) |

I6 is the repository's **only known self-violation**, and the highest-priority gap to close: errors must be explainable, not discovered by someone reporting "I never got it".

## 4. Seven tradeoffs (what was chosen / what was given up / why not the other option)

- **T1 Carry roles in Sessions, not subagents.** Gave up: lightweight, instant creation inside a process. Reason: only Sessions carry cross-turn memory in DSH.
- **T2 at-least-once + request-level idempotency, not exactly-once.** Gave up: a distributed "exactly once" promise. Reason: do not fake a guarantee you cannot deliver; hand idempotency authority back to the Session log, so effects are effectively once.
- **T3 Local leases, not distributed coordination.** Gave up: active-active and cross-machine queues. Reason: one writer per Session is a fact of DSH; within that boundary, a local file lock plus a lease is the cheapest correct design. The cost is written into [ARCHITECTURE](ARCHITECTURE.en.md) instead of being hidden.
- **T4 Local-first, single transport (SQLite + WAL), not pluggable backends.** Gave up: out-of-the-box Redis/Postgres. Reason: the SPI shape is kept, but **an SPI with no second implementation is an assumption, not an interface**. Wait until a second party actually needs it.
- **T5 Read-only fusion with the official plugin, not bidirectional write-back.** Gave up: one merged task board. Reason: write-back means ownership conflicts, concurrent overwrites and chasing the official schema — going from "complement" to "fight".
- **T6 Visibility before token savings; do not hide members to save cost.** Gave up: silent line creation that saves a first-turn token bill. Reason: if users cannot see members, they think the team was not created; token is explainable, missing is not. Since 0.11.0 `line_create` always bootstraps and waits for visibility; per-call `bootstrap:false` no longer applies.
- **T7 Team dir follows the workspace, and the board shows the truth instead of a fixed demo.** Gave up: a fixed teamRoot and static prototype flows/demo data. Reason: teams landing in "a directory I do not know" and a novel team showing a development flow are product incidents; since 0.11.0 teamRoot is optional and aligned with the current workspace, and the board/org view reads only the real TEAM.md, showing "not collected" when absent.

## 5. Non-goals

- No exactly-once / distributed consistency (see T2)
- No active-active or cross-machine queues
- No process isolation, no in-plugin policy sandbox (that belongs to DSH itself: `agentPreset` and tool allowlists; two permission systems will contradict each other)
- No static encryption (full-disk encryption is the stated answer), no sender signatures (`SECURITY.md` already states this is prompt-level mitigation, not a hard boundary)
- No bidirectional write-back to the official task board (T5)
- No built-in org templates and no built-in fixed quality-gate engine (quality points differ per domain, see §6)
- No full IM / chat application, no automatic scheduler
- No Claude Code / Codex adapters for the sake of "cross-harness" (wait for a second real request)
- Never widen the supported DSH version range to "support more people" (the answer is capability probing plus graceful degradation, see §7)

## 6. Quality belongs to roles; communication is a work trail

- **Quality belongs to roles**: quality points differ by domain (fiction: continuity, voice, typos; video: facts, pacing, subtitle compliance; software: self-test, cases, review). The plugin ships no fixed gates; it provides role titles, quality points, delivery evidence and manager acceptance.
- **Communication is a work trail, not a chat app**: messages must be traceable, acknowledgeable, approvable, handoff-able and replayable. Hence `kind` / `state` / `reply_to` / `hop`, and deliberately no social semantics beyond read receipts.

## 7. Evolution rules

**What counts as breaking** (must be called out in a dedicated CHANGELOG section and bump minor):

- adding/removing/changing envelope fields, required parameters, or tool result shapes
- changing state-machine semantics (`queued → claimed → delivered → acked`, side branches `failed` / `expired`)
- changing the meaning of an error code (codes may be added, never repurposed)
- modifying any invariant in §3

**What counts as compatible**: new optional tools, new read-only fields, new error codes, new optional configuration.

**Protocol version**: the envelope will carry `protocolVersion` (planned). A receiver rejects on a different major (`LINE_PROTOCOL_MISMATCH`) and ignores unknown fields on a newer minor.

**When DSH capabilities change**: probe capabilities and degrade gracefully (e.g. missing `workspace.attach` → the new line lands "ungrouped" instead of the whole plugin failing), and surface the capability table in `line_status`. Never widen the version range (§5).

**The self-violation to close soon**: the I6 visibility gap (query messages by state, redeliver failed ones, explicit purge, ack-timeout reporting). The principle stays the same: the plugin **reports anomalies, it does not decide for the human** — an ack timeout never auto-redelivers (that would break I2); it is flagged and counted, and the manager decides.

The 0.11.0 change "per-call bootstrap:false is ignored" is a visibility behavior change; it touches no envelope, state machine or error code, so it is treated as a compatible enhancement and listed separately in the CHANGELOG.

## 8. Bento UI principles (board, 0.6.6+)

- information blocks in the same row keep equal height;
- inside a card, fixed information slots: title, status, owner, time, actions;
- org tree / current tasks / details are three clearly separated columns;
- upper levels show department summaries only; child tasks load when a line is opened;
- technical vocabulary comes last — say "on duty / working memory / handoff", not Session or context window;
- empty, unavailable, offline and stale states all need a place;
- read-only boundaries must be labelled explicitly;
- the board is a read-only projection of real data, never demo data; missing data shows "not collected / unavailable", never fabricated;
- the org collaboration flow comes from the team own TEAM.md (`## 协作流程`), never a built-in fixed flow.

## 9. Glossary

| Term | Meaning |
|---|---|
| line | a long-lived role = label + current sessionId + lifecycle state |
| label | stable role identity; duplicate labels cannot be created, but can be taken over by `replace` / `rebind` |
| generation | how many times this label has been taken over; `generation > 1` means "the person changed" |
| owner / lease | the process currently allowed to deliver for that line, renewed by heartbeat |
| retired | out of service: no new messages; Session and history are kept |
| queued / claimed / delivered / acked | the main message state machine; only `acked` means the peer actually handled it |
| failed / expired | terminal side branches; **not yet visible to agents** (I6) |
| hop | number of forwards; the audit trail for migration and redelivery |
| peer content | messages from peers, never treated as user instructions (I7) |
| L1 / manager line / manager session / level 1 | Three names for one level: L1 = the manager session the user talks to |
| L2 / role line / role session / level 2 | L2 = a line carrying a long-lived role; one L1 has several L2s |
| L3 / official team / department team / level 3 | L3 = official teammates spawned inside an L2 session, task-scoped; "department" means an L2 plus its L3 together |

## 10. How this relates to the other documents

> After the fusion, "who does the work" (the role line vs its internal team) is decided by [DELEGATION-POLICY](DELEGATION-POLICY.en.md); the plugin records, displays and audits only (I5).

| Document | Answers |
|---|---|
| [README](../README.en.md) | what it is, how to install, what each version adds |
| **PHILOSOPHY.md (this file)** | why it is designed this way, what must not be touched, what it will never do |
| [ARCHITECTURE](ARCHITECTURE.en.md) | layering, delivery model, manager and claim, workspaces, boundaries |
| [PROTOCOL](PROTOCOL.en.md) | envelope, state machine, error codes, leases, idempotency keys |
| [SECURITY](SECURITY.en.md) | trust model, data at rest, network, peer content, DoD |
| [DEPLOY](DEPLOY.en.md) | deployment and operations |
| [AGENT-TEAMS](AGENT-TEAMS.md) | read-only fusion with the official agent-teams plugin (three levels, fields, boards) |
| [DELEGATION-POLICY](DELEGATION-POLICY.en.md) | should the role line do it or open an internal team (7 dimensions, A/B rules, `subteamPolicy` semantics, update loop) |

---

**Provenance**: written on 2026-11-10, merging an internal design draft with an external review (an independent read of 0.6.5). The reviewer independently reconstructed this philosophy and it matched the code facts; their invariants and tradeoffs are folded into §3 / §4. The I6 self-violation was reported by that review and is listed as pending.
