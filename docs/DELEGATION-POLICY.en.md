# Delegation policy: should the role line do the work, or its internal agent team?

English | [中文](DELEGATION-POLICY.md)

> Version **v1** (2026-11-10) | Status: active | Maintained by: dsh-plugin-line
> Scope: in the three-level organization, the **first decision a level-2 role line makes** after receiving a task.
> How this document is kept current: see §6 (it is a living document, shipped with releases).

## 0. Who makes the call

- **The call is made by the manager agent inside the role-line session**, following this policy plus its own role card.
- **The plugin does not auto-detect, auto-dispatch, or hard-block**: it provides the `subteamPolicy` / `maxMembers` fields, a read-only department view, and an audit trail (invariant I5).
- A real "hard gate" requires an official per-line cap or a pre-spawn interception API. Neither exists today (see 0.6.6-CONDITION), so we **never pretend a spawn was blocked**.

## 1. Who owns what in the three levels

| Level | Who | Owns | Memory |
|---|---|---|---|
| **L1** manager line | the manager session (the user talks here) | create lines, dispatch, approve policy, accept results, cross-line coordination | long-lived |
| **L2** role line | a role session (line) | decompose, **decide L2 vs L3**, produce and self-check, report back to L1 | long-lived, across sessions |
| **L3** internal agent team | official teammates spawned inside that role session | parallel subtasks, cross-review, one-off quality points | short, released per task |
| Files | the project directory | the single source of truth for memory and delivery evidence | durable |

Three boundaries you must know:

1. The official task board's `ownerName` can only be a teammate — **L1/L2 cannot be a task owner** (read-only mapping since 0.6.0, no write-back).
2. L3 is task-scoped, **never a long-lived role** — anything needing cross-session memory stays in L2.
3. When an L2 context fills up, use `line_handoff` / `line_rebind` (change the person, never the role; I3/I4). **Do not use L3 to avoid a context problem.**

## 2. Decision inputs: seven dimensions (ask in order)

| # | Dimension | Question | Leans |
|---|---|---|---|
| D1 | Memory ownership | Needs memory across sessions/restarts, or historical decisions? | yes → **L2** |
| D2 | Splittability | Can it be cut into ≥2 independent subtasks? | no → **L2** |
| D3 | Parallel payoff | Does parallelism shorten the critical path (tight window)? | no → **L2** |
| D4 | Write conflicts | Would subtasks write the same files or the same task-board dependency chain? | yes → **L2 or serial** |
| D5 | Independent quality point | Needs independent review, competing proposals, or fact-checking? | yes → **L3** |
| D6 | Context cost | Does it fit in one L2 context? | yes → **L2 (cheaper)** |
| D7 | Risk and rollback | High cost of failure, must be right first time? | L2 drafts first, then L3 verifies in parallel |

## 3. Decision rules (directly executable)

**Default: the line does it itself (L2). Do not build a team when L2 can finish it.**

**Minimum sufficient conditions to open L3 (any one, and none of §3.2 may apply)**

- **A1 Parallel verification**: ≥2 independent proposals or review angles → 2–3 teammates
- **A2 Chunked production**: ≥3 independent output units (files/chapters/modules) → 2–4
- **A3 Independent quality point**: review/proofread/fact-check must run after production → 1
- **A4 Time window**: the critical path exceeds the single-line budget and parallelism halves it

**Always L2 (do not open L3)**

- B1 Needs long-lived role memory and conventions (continuity, settings, foreshadowing, prior decisions)
- B2 Writes the same files, or the same task-board dependency chain (parallel work will collide)
- B3 Smaller than one turn (team overhead exceeds the gain)
- B4 Requires a final commitment or acceptance signature to the user
- B5 Requires a cross-session handoff (`line_handoff` applies to lines, not to teammates)

**Hard constraints**: keep a team at ≤4 members (the deployment-level `maxMembers` defaults to 16; it is not a per-line or per-task cap); every team creation must record **reason + expected output** for the audit trail.

**Tie-breakers**: D5 (quality point) → D2 (splittability) → D6 (cost); if still unclear, **choose L2** (cheaper to undo).

## 4. `subteamPolicy` semantics (implemented; record and audit only)

| Value | Meaning | Enforced by |
|---|---|---|
| `auto` (default) | L2 may decide to build a team following this policy | L2 |
| `ask` | L2 must ask L1 first; L1 approves with `line_manager_ack` | L2 asks, L1 approves |
| `never` | No team building; the task must be done by L2 | L2 |

Recorded in: `line_send({ subteamPolicy, maxMembers })`, `line_team_board.lines[]`, and `line_department_board`'s `subteamAudit`. **Recorded, never enforced** (0.6.1 design, respects I5).

## 5. Standard steps for one L3 delegation (copyable)

1. **Decompose**: subtask list + deliverables + acceptance points + **non-overlapping file scopes**
2. **Build**: spawn ×N; give each a **complete** brief (teammates do not share the parent session's memory)
3. **Parallelize**: independent files only; **never write the same file concurrently**
4. **Collect**: L2 reads all outputs → cross-checks → merges → self-checks
5. **Report to L1**: output paths + key judgments + uncovered items; L3 is released afterwards
6. **Bookkeeping**: reason / member count / actual duration / was it worth it (for §6 reviews)

## 6. How this stays current

- This document carries a **version number and a §8 change log**, in both languages, shipped with the next release (docs changes ship too).
- **Triggers to update** (any one, don't wait for a refactor):
  1. L3 outputs rejected by L2 at >30%
  2. No measurable critical-path gain after building a team
  3. A retrospective disagreement about "should have done it alone / should have delegated"
  4. Official API changes (per-line caps, pre-spawn interception, owner=line)
- **Update flow**: edit this file → sync both languages → append a change log row → ship with the version → cite it in the release notes.
- **Observed metrics** (observation only, no automatic blocking): L3 usage rate, average member count, L2 rejection rate, average task duration, tokens per task (session-level proxy, never faked as per-task).

## 7. What is not automated today (honest boundary)

- The plugin does **not** identify tasks or dispatch them automatically; identification and dispatch are done by the L2 agent following this policy.
- The official task board **cannot** set L1/L2 as owner and has no write-back (non-goal T5).
- There is **no** per-line or per-task member cap (only the deployment-level `maxMembers`).
- Once the official plugin exposes a pre-spawn interception or pre-execution approval API, this policy can become a **hard gate** (former 0.6.7 condition).

## 8. Change log

| Version | Date | Change | Basis |
|---|---|---|---|
| v1 | 2026-11-10 | First version: level responsibilities + 7 dimensions + 4 A/B rules + `subteamPolicy` semantics + standard steps + review loop + honest boundaries | User asked for an explicit "L2 vs L3" decision rule; review §2/§7; external feedback 11-08 §5.4 (owner=line constraint) |

## 9. Related documents

- [PHILOSOPHY](PHILOSOPHY.en.md): invariant I5 (no policy enforcement), T5 (read-only fusion)
- [AGENT-TEAMS](AGENT-TEAMS.md): read-only fusion fields and boards
- [KNOWN_ISSUES](KNOWN_ISSUES.en.md): B7 deployment-level cap, G9 team shape not reproducible
