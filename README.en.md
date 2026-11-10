# dsh-agent-lines

> **Agents: read [docs/AI-USAGE.md](docs/AI-USAGE.md) first** (five-step team setup; do not scan source).

English | [中文](README.md)

GitHub: [Lencen/dsh-agent-lines](https://github.com/Lencen/dsh-agent-lines)

> Community plugin for DeepSeek Harness. Not an official DeepSeek product.

> **100% Vibe Coding.** The architecture, code, tests, and docs were produced in AI agent sessions. It is experimental: review the code and run an integration test before production use.

A drop-in super-agent alternative for DSH.

Stop reopening sessions and copying context by hand. Give one lead agent a long-lived team: each member has a name and a role, messages survive restarts, and the lead collects and reports the results.

## Quick Context (for AI assistants)

> Structured context for AI: paste this repo into an AI assistant and let it read this first; it reduces guessing and hallucination. Humans can skip it.

- **Runtime**: a DeepSeek Harness (DSH) community plugin, running inside the DSH Host process — not a standalone app, not an official product. DSH `>=0.2.1-rc.5 <0.3.0`; Node `^22.19.0 || >=24.0.0`.
- **Storage**: local SQLite (default `DSH_HOME/agent-lines/lines.db`; override with config `dbPath` or env `DSH_AGENT_LINES_DB`); network filesystems are refused.
- **Core entities**: **Manager Line** (the line named by `createFrom`) / **Worker Line**; a line = `label` (stable name) + `sessionId` (replaceable Session) + lease.
- **Hard constraints**: only the `createFrom` line (with `allowCreate: true`) may call `line_create`; **do not enable `allowCreate` on worker profiles**; one writer per Session; never open a line's Session in another DSH process (`session/writer-held`).
- **Zero-config**: an unbound root Session can bind itself with `line_claim_manager({ confirm: "bind-manager" })` (needs `allowClaim`; on by default in zero-config).
- **Delivery semantics**: at-least-once; idempotency authority is DSH's `requestId`; failed states are queryable and recoverable (`line_messages` / `line_trace` / `line_redeliver`); **ack timeout is reported, never auto-retried**.
- **AI operation contract**: [AGENTS.md](AGENTS.md) (config keys, 22 tools, `line_status` fields, hard rules). Design: [docs/PHILOSOPHY.en.md](docs/PHILOSOPHY.en.md) | [web](https://lencen.github.io/dsh-agent-lines/en/philosophy.html).

## When to use it / when not to

| Scenario | Choose dsh-agent-lines | Don't (better fit) |
|---|---|---|
| Long-running project, no desire to re-explain context | ✅ each role keeps long-term memory | ❌ one-off small task: a normal Session is faster |
| Several agents with stable roles (research/dev/test/release) | ✅ assign by name | ❌ only need a one-shot burst inside one Session: official Agent Teams is lighter |
| Work must survive closing the window / restarting DSH | ✅ messages and state are durable | ❌ no restart survival needed |
| Context fills up; the role must change but the role must not | ✅ `line_handoff` / `line_rebind` | ❌ only one-off multi-agent collaboration |
| Need task dependency control, quality gates, a task board | ⚠️ read-only fusion with the official board; no own DAG | ✅ use the official DSH Agent Teams plugin (task DAG + panel) |
| Need cross-machine / active-active / strong isolation | ❌ unsupported (local SQLite + local lease) | ✅ choose a distributed solution |


## How the two team shapes look

### Official "Agent Teams" plugin

~~~text
one DSH session
  └─ several subagents inside that session
~~~

- One session is one official team.
- Subagents are task-scoped members: started around a task, usually released or reused when it ends.
- A subagent is not a long-lived role; do not treat it as a fixed member with long-term memory.
- The official team has a task board, task dependencies and a web panel.
- Subtasks run concurrently inside the team.

### dsh-agent-lines

~~~text
several DSH sessions form a team
  ├─ manager session
  ├─ developer role session
  ├─ tester role session
  └─ proofreader role session
~~~

- The team is made of sessions, not "one session stuffed with subagents".
- Each session has its own durable memory.
- A role can work continuously in its session, or come back later.
- When a session fills up, swap the session — never the role.
- The manager decomposes, dispatches and accepts results in its own session.
- dsh-agent-lines itself provides no task board.

## How it differs from official Agent Teams

Not a replacement: they complement each other. One line: **Agent Teams owns the work, dsh-agent-lines owns the people and the messages.**

| Dimension | Official Agent Teams | dsh-agent-lines |
|---|---|---|
| Focus | Task orchestration and team collaboration | Long-lived roles and durable messaging |
| Roles | Named teammates around tasks, process-internal lifetime | Lines persist across sessions and restarts |
| Tasks | Shared task board, DAG, blocked_by, Web panel | No task board; reliably delivers tasks/messages to roles |
| Messages | Direct inbox for current team work; no restart retry guarantee | SQLite queue with lease, ack, retry, resume after restart |
| Context full | Spawn a new teammate | handoff + replace; same role, new Session |
| Workspace | Members share a workspace | Each line can bind its own workspace |
| Best for | One-off or short multi-agent orchestration | Long novels, video series, research, ongoing operations |

**Together:** lines own people, Agent Teams owns tasks, files own memory. The user sends work to the manager; the manager reads Agent Teams tasks and line status automatically, with no user export or config.

Official Agent Teams is experimental; dsh-agent-lines is a community plugin, not an official DeepSeek product.

## Agent Teams integration (read-only; 0.5.1+, department view since 0.6.0)

The user only sends a task to the manager. The manager automatically reads official Agent Teams tasks/members, maps teammate names to lines; no user export, no mapping config, no plugin buttons.

Precondition: the manager line must also be the Agent Teams Lead/member; otherwise unavailable, never fall back to user export.

Read-only: no task writes, no lines.db writes, no manager turn; L2 is not approved.

### The three levels after integration

~~~~text
L1 manager session (the user only states goals)
  └─ L2 role session (long-lived role, durable memory, line capabilities)
       └─ L3 official Agent Teams team inside that role session (teammates, task-scoped, parallel, released after use)
~~~~

- **L1 owns lines**: create lines, dispatch, approve policy (`subteamPolicy`), accept results.
- **L2 owns the work**: decompose, decide "do it myself or open an internal team", produce and self-check, report back to L1.
- **L3 owns parallelism**: only the carved-out subtasks, cross-verification, one-off quality points; **never a long-lived role**.
- Memory and delivery evidence live in **files**; the official task board owner can only be a teammate (L1/L2 cannot own tasks).

### Who does the work: the role line, or its internal team?

**Default: L2 does it itself.** Open L3 only when at least one holds and no prohibition applies:

- ≥2 independent proposals or review angles (parallel verification);
- ≥3 independent output units that can be produced in parallel;
- an independent quality point after production (review/proofread/fact-check);
- a long critical path where parallelism clearly shortens the window.

**Always L2**: needs long-lived role memory; tasks write the same files; smaller than one turn; requires final acceptance to the user; requires a cross-session handoff.

Full policy (seven dimensions, A/B rules, `subteamPolicy` semantics, standard delegation steps, update loop and review metrics): [docs/DELEGATION-POLICY.en.md](docs/DELEGATION-POLICY.en.md).
Read-only fusion fields and boards: [docs/en/AGENT-TEAMS.md](docs/en/AGENT-TEAMS.md).

> Boundary: the plugin **does not auto-detect tasks, auto-dispatch, or hard-block team building** — the L2 agent decides by the policy above; the plugin records, displays and audits. A hard gate needs the official per-line cap or a pre-spawn interception API.

## Any team type, not just development

The plugin does not limit team types. It is "one manager + several long-lived members".
The examples below use a development team; novel, video, research, or operations teams only change roles and tasks.

- Novel: editor-in-chief, outline, writer, editor, proofreader, reviewer;
- Video: manager, planning, script, editing, cover, publishing;
- Development: manager, developer, tester, acceptance;
- Research: manager, research, analysis, writing, review.

You do not need to know the roles up front. Tell the manager "build a novel team and set up its workflow and mechanisms"; it proposes the team shape first.

## Design philosophy (why it is built this way)

One line: **a DSH session is a person, subagents are temporary helpers, tasks are work, files are memory, the manager orchestrates, quality belongs to roles, and the user only states goals.**

There is exactly one pivot: `line = label (stable identity) + sessionId (replaceable carrier)`. In DSH the only thing carrying memory across turns is a Session, so a long-lived role must live in a Session; and because Sessions fill up and get replaced, identity cannot be bound to a Session — `line_retire` / `line_rebind` / `line_handoff` are all projections of that one decision.

Four hard rules (breaking any one of them is a bug):

- at most one live owner process per line (local lease, not distributed locking);
- a given msgId takes effect at most once in the target Session log (the idempotency authority is DSH, not the SQLite queue);
- label is constant, sessionId is replaceable: change the person, never the role; retiring keeps history;
- peer messages are always peer content, never promoted to user instructions.

**Explicit non-goals**: exactly-once, cross-machine active-active, process isolation or an in-plugin policy sandbox, static encryption or sender signatures, bidirectional write-back to the official board, built-in org templates or fixed quality gates, full IM.

Full text (invariants I1–I7, the five tradeoffs and what they cost, non-goals, evolution rules, glossary): [docs/PHILOSOPHY.en.md](docs/PHILOSOPHY.en.md) | [中文](docs/PHILOSOPHY.md).
Known breakage and open gaps: [docs/KNOWN_ISSUES.en.md](docs/KNOWN_ISSUES.en.md).

## What each version adds (business scenarios)

### 0.11.0-30: unified teamRoot semantics (unreleased)

- Team dir = explicit/config teamRoot or manager cwd, plus teamName; parent dirs resolve newest child; line_status discovers teams under cwd.

### 0.11.0-29: board follows newest team under a parent teamRoot (unreleased)

- Parent `--team-root` resolves to the newest child team; each team reads its own TEAM.md goal/flow.

### 0.11.0-28: new lines are visible immediately (unreleased)

- line_create always bootstraps and waits until blank=false (visibleInSidebar); per-call bootstrap:false ignored.
- Visibility beats token; docs updated.

### 0.11.0-27: board collaboration flow is data-driven (unreleased)

- Org view reads optional `TEAM.md` `## 协作流程`; no more fixed dev flow; missing shows "not collected".
- docs updated.

### 0.11.0-26: fix batch replace returning non-lossless JSON (unreleased)

- Batch items are JSON-safe (missing lifecycle → null, added replaced flag); the replace operations themselves always ran, only the return failed validation.
- Regression test added.

### 0.11.0-25: token metrics now use totalTokens (unreleased)

- line_metrics/board default to totalTokens (uncached input + output + cache); output buckets kept.
- Sampling reads DSH tokenUsage projection; docs updated.

### 0.11.0-24: batch line creation + sampling-short display + token basis (unreleased)

- line_create accepts lines[] batch (returns created/skipped/failed/counts).
- Cost card shows "sampling not ready" + cumulative decodeTokens when samples<2 instead of a misleading 0k.
- docs add the token basis: decodeTokens counts output only; DSH total (input/cache) measured 30–80× larger.

### 0.11.0-23: line_init_team parameter fix + decision status (unreleased)

- `line_init_team({teamRoot, teamName})` now treats teamRoot as parent and teamName as subdir (fixes the "flatten to parent -> generate then mv -> overwrite errors" chain).
- decisions support `## 状态`: 已采纳/已执行/已处理/已完成 are not counted as pending; do not put setup audit notes under decisions/.

### 0.11.0-22: per-line chart includes manager + low-token setup (unreleased)

- Per-line chart includes the manager line; messages counted per line.
- AI-USAGE adds low-token setup: bootstrap:false (~65k tokens saved for 8 lines), one status call, no metrics during setup.

### 0.11.0-21: agent usage manual v2 (unreleased)

- Rewrote docs/AI-USAGE.md: five-step setup, board guide, common errors → next step, acceptance checklist, doc index; aligned with real data and plugin version display.

### 0.11.0-20: board detail fixes (unreleased)

- Goal badge restored; progress reflects real completion; cost chart includes the manager line.
- High-fidelity layout unchanged.

### 0.11.0-19: board static slots and asset fix (unreleased)

- All static data slots (topbar/overview/org/data/cost/footer) now bind to real data; fixed the ECharts asset path (/vendor/echarts.min.js) so data/cost charts render.
- High-fidelity layout unchanged.

### 0.11.0-18: restore high-fidelity UIUX + real-data adapter (unreleased)

- Board restored to the approved high-fidelity prototype (layout/components/interactions/themes unchanged); only the data layer was rebuilt with real team goal/org/tasks/data/cost/charters.
- Footer shows the plugin version; substitute hacks and demo copy removed.

### 0.11.0-17: footer version fix (unreleased)

- Footer prints the raw `/api/health.version` value (no more hardcoded 0.11.0- prefix).

### 0.11.0-16: board shows plugin version (unreleased)

- Topbar "插件版本 v0.11.0-16" and footer both show the plugin version, sourced from `/api/health.version`.

### 0.11.0-15: board metric alignment (unreleased)

- Overview "members" uses the official task-board projection (team-board.members); the data view shows both official-members (snapshot) and team-board members.
- The rest is the same as 0.11.0-14.

### 0.11.0-14: board real-data fix (unreleased)

Scenario: after 0.11.0-13, a hard refresh still showed prototype demo content (team goal / focus / org detail / tasks).
Fix: repaired the inline adapter syntax error in `web/board.html`; removed all demo data; five views are pure data-driven (`/api/live` + `/api/team-board` + `/api/team-metrics`); line detail reads real charter sections; tasks view shows the official task projection; added the `check-board-scripts` gate.
Effect: no prototype residue; missing data renders as "no data / unavailable / not collected" instead of fabricated values.

### 0.11.0-13: team workspace and board (unreleased)

- Read-only teamRoot: registry.json, charters, TEAM.md (goal/summary/plan/cadence), decisions; missing shows unavailable.
- New manager-only line_init_team (tools 25->26): idempotent init of TEAM.md, manager/line charters, decisions README, registry.
- Zero-config manager role defaults to 负责人; charter is manage-only (no execution), coordinates resources, extracts goals and updates TEAM.md.
- Board: five views, docked detail, ECharts, visible-only polling (10s adjustable, ETag).
- status --json adds teamWorkspace/teamGoal/decisions; no DB migration, no protocol change.

### 0.10.0: cost trend and hibernation

Scenario: a long-running team; you want to know daily token spend and how to park idle lines.
Use: line_metrics exposes tokens.today/perDay[] and byLine[].ratePerMinute (estimated, not billing); tokenSampleMs / tokenRetentionDays control sampling and retention; line_hibernate / line_wake park and wake idle lines (stop delivery, **reject outbound sends from that line too**, release the lease, keep Session/history; no auto-wake).
Effect: costs become answerable (daily deltas and rates); sampling dedup + 30-day retention by default; hibernation is distinct from retire and needs an explicit wake.

### 0.9.0: versioned, machine-checkable protocol

Scenario: multiple implementations or plugin versions must interoperate, and message failures must be diagnosable.
Use: every envelope carries protocolVersion (0.4); self-test interop with schema/ and conformance/; line_status.capabilities shows what the running profile supports; handle failures with line_messages / line_trace / line_redeliver.
Effect: incompatible major is rejected (LINE_PROTOCOL_MISMATCH), newer minor ignores unknown fields; legacy messages are treated as 0.3; schema v13 -> v14 is additive (no manual migration); new memory transport.

### 0.8.1: self-contained package

Scenario: a released package (npm / Release asset) must be testable as-is.
Use: unpack and run the bundled scripts: scripts/business-smoke.mjs, scripts/check-docs-consistency.mjs, scripts/check-bento-alignment.mjs.
Effect: the package can self-run 9 business smoke checks plus docs/board gates on its own; no functional change.

### 0.8.0: message visibility and remediation

Scenario: a message gets no reply or fails; you need to know where it is stuck, whether it can be rescued, and whether it will be re-sent.
Use: line_messages (query failed/expired), line_trace (lifecycle timeline), line_redeliver (rescue failed/expired), line_purge (cleanup, dryRun by default), ackTimeoutMs (report-only), doctor health.
Effect: the full message lifecycle is visible; failures are kept and rescurable; ack timeouts are flagged but never auto-redelivered (preserves I2).

### 0.7.0: design constitution and docs (no behavior change)

Scenario: you want to know why the plugin is built this way, what must not be touched, and what it will never do — or you need to align a second implementation.
Use: read [docs/PHILOSOPHY.en.md](docs/PHILOSOPHY.en.md) and [docs/KNOWN_ISSUES.en.md](docs/KNOWN_ISSUES.en.md); the CHANGELOG now separates breaking and non-breaking changes.
Effect: invariants I1–I7, five tradeoffs and non-goals are written down; known boundaries and open gaps are listed by severity; **plugin behavior is unchanged**.
Note: the read-only board cut shipped in **0.6.6**; 0.7.0 does not declare it again.

### 0.6.6: Web board UIUX acceptance

Scenario: review the org/tasks/department/communications/metrics board against the UIUX line's Bento spec (DESIGN-SPEC §11, finalized 2026-11-09).
Use: dsh-agent-lines board --port 4090 --db $DSH_HOME/agent-lines/lines.db.
Effect: read-only; fixed slots, equal-height rows, inner scrolling, data-level, breadcrumbs; no board-side actions or messages.

### 0.6.5: manager local actions

Scenario: the manager wants to send, approve/reject pending tasks, or hand off directly from the browser board.
Use: board actions require `x-board-token`; still bound to 127.0.0.1; without a token the board is read-only.
Effect: functional version only; no hard subteam blocking (still waiting on the official API).

### 0.6.4: built-in read-only web board

Scenario: the manager does not want to call tools every time and wants to see team tasks/departments in a browser.
Use: `dsh-agent-lines board` on 127.0.0.1:4090, reading `team-board.json` / `team-board.<line>.json`.
Effect: org tree, tasks and department drawers; no write API; never exposed to the public network automatically.

### 0.6.3: unified data board

Scenario: the manager needs a read-only data surface for tasks, lines, subteams and message trends.
Use: `line_metrics({ days })` returns task/line/subteam stats, message kind/state with daily trends, and per-line current tokens.
Effect: official tasks have no timestamp and no per-task tokens; trends are never faked.

### 0.6.2: communication board

Scenario: the manager needs to see messages between lines and between a line and its official team.
Use: `line_communications` filters by line, task, kind and state.
Effect: read-only work trail; internal private chats of official subagents are declared unreadable, never fabricated.

### 0.6.1: internal team policy and audit

Scenario: the manager wants to cap whether a role line may create an internal team and how many members it may have.  
Use: line_send with subteamPolicy (auto/ask/never) and maxMembers; the board shows the line-level policy and audit.  
Effect: line_team_board.lines[] exposes the line policy; line_department_board returns task policy and subteamAudit; records/shows/audits only, does not block official spawn.

### 0.6.0: three-level organization and department view

Scenario: the manager has several long-lived role lines, and each line has its own official team.  
Use: line_department_board({ line }) lazily reads that line's official team, tasks, summary and messages.  
Effect: three-level org tree; the parent sees department summaries without merging child task boards; taskScope prevents same task-id collisions across teams.

### 0.5.1: official team board and host snapshot

Scenario: the team keeps long-lived roles but also wants to see the official Agent Teams board.  
Use: the manager calls line_team_board; the plugin reads official tasks/members and writes team-board.json.  
Effect: read-only integration; no user export/config; contract fields messages/quality/team/approval/deliveries.

### 0.4.1: the manager can see cross-line traffic

Scenario: lines message each other directly; the manager needs visibility without every message becoming a manager turn.  
Use: line_observe({ line: "writer", limit: 20 }) or CLI observe --json.  
Effect: a read-only feed with from/to/state/summary; no prompt injection and no state change; line_send semantics unchanged.

### 0.3.8: know when to replace

Scenario: the manager wants to see which line is close to saturation or has gone quiet.  
Use: line_status / line_list expose activity.level, turns, steps, lastActivityAt.  
Effect: a low/medium/high activity proxy, not a fake "78% context used"; exact context usage waits for DSH.

### 0.3.7: hand off before replacing

Scenario: the new writer does not know what the old line finished, what is next, or which traps to avoid.  
Use: line_handoff({ line: "writer", format: "md" }).  
Effect: a structured snapshot (progress, backlog, recent messages, lifecycle) without a model call; the new line reads it first.

### 0.3.6: replace a role when context is full

Scenario: a writer line has worked long enough that its context is saturated and quality drops.  
Use: the manager calls line_create({ label: "writer", replace: true, force: true, reason: "context full" }).  
Effect: the same label moves to a clean Session; the old Session is retired but kept; queued/claimed messages migrate; delivered/acked are never re-delivered; no manual routing.

## Install

One-command install (recommended; no need to find a profile):

    curl -fsSL https://raw.githubusercontent.com/Lencen/dsh-agent-lines/main/install.sh -o install.sh
    bash install.sh

The script picks the DSH Web profile, installs the plugin, and verifies agent-lines. If it cannot decide, it lists existing profiles and tells you how to specify one.

**Restart DSH Web after install or update.** A running process does not load new plugin code. With no plugin config the plugin starts in zero-config mode: one unbound manager line, and a root Session can call line_claim_manager to bind itself. The explicit "Manager config" block is optional, for a fixed manager/worker setup.

Offline or when npm is unavailable, use the local tarball:

    bash install.sh ./dsh-agent-lines-0.6.0.tgz

After install and restart, it works without a config. When you want a fixed manager/worker setup, paste the "Manager config" block below into the file printed by the installer.

### Manager config (optional)

```yaml
- id: agent-lines
  name: dsh-agent-lines
  config:
    agentId: agent-demo
    dbPath: /home/me/.dsh/agent-lines/lines.db
    allowCreate: true
    allowClaim: true
    allowSelfSend: false
    dedupeWindowMs: 5000
    maxReplyDepth: 8
    createFrom: manager-line
    maxLines: 16
    childPreset: standard
    lines:
      - label: manager-line
        sessionId: session-lines-manager
        role: 任务对接、拆解与调度
```

Only `createFrom` may call `line_create`. Worker profiles should leave `allowCreate` false.

### New line bootstrap

When the manager calls line_create, the plugin queues a no-work onboarding message by default so the blank Session gets its first message and appears in the sidebar; pass bootstrap: false to skip it.

line_status / line_list return materialized, visibleInSidebar, and bootstrapQueued; a new line may remain blank until its first message.

## Quick start

1. Run the installer above.
2. **Restart DSH Web** so the plugin is loaded.
3. Open any root Session. The zero-config path needs no YAML.
4. Call line_status; if the Session is not bound, call line_claim_manager({ confirm: "bind-manager" }).
5. Say "create the first-use team"; wait for the member lines, then send the first task separately.

## First use: build a development team

Copy this into a new root Session. The prompt starts with binding, then creates one team. Replace the task later; do not let the manager execute the work.

> Use dsh-agent-lines. Make this Session the development team lead; bind it first if needed.
>
> You own task decomposition, assignment, coordination, progress tracking, result collection, and reporting. You manage and coordinate only; do not execute development tasks.
>
> Form the team. Use short English names and Chinese roles: research (调研), architecture (架构), uiux (UIUX), dev (开发), test (测试), acceptance (验收), release (发布), ops (运维).
>
> After the team is ready, wait for my first task. Do not start by yourself.

Member names are short English names; Chinese is the role. This prompt creates one team. Version 0.3 does not support multiple simultaneous teams in one plugin instance.

Copyable calls (the manager Session runs these):

~~~js
line_create({ label: "research", role: "调研" })
line_create({ label: "architecture", role: "架构" })
line_create({ label: "uiux", role: "UIUX" })
line_create({ label: "dev", role: "开发" })
line_create({ label: "test", role: "测试" })
line_create({ label: "acceptance", role: "验收" })
line_create({ label: "release", role: "发布" })
line_create({ label: "ops", role: "运维" })
~~~

After creation, call line_list to confirm.

![First use: bind manager, create 8 member lines, list them](docs/assets/first-use.gif)

Actual DSH Web demo profile, generic labels; no internal data.

## Scenario: one manager, several execution lines

The lead creates the team first; the work comes next.

1. The lead creates members by role: research, architecture, UI/UX, development, testing, acceptance, release, operations.
2. You give the lead one concrete task, for example "add CSV export to the reports page, with tests and a one-page runbook."
3. The lead decomposes it and sends each part to the right member; every message stays local.
4. Members receive the task, execute it, acknowledge it, and reply to the lead when needed.
5. The lead collects results, resolves disagreements, and aligns the answer.
6. You see the lead's summary; each member keeps its own context and message history.

This is a prompt-driven team pattern, not a built-in org chart: the lead model decides how to split work. Technical details are in "Use" and "Delivery semantics" below.

## Context activity

line_status / line_list return activity: turns/steps/decodeTokens/level/lastActivityAt.
level is an activity proxy (low/medium/high), not a context-usage percentage; DSH does not expose the context window today.

## Team cost trend (0.10.0+)

`line_metrics` shows daily token deltas and rates (estimated, not billing): `tokenSampleMs` controls the sampling interval and `tokenRetentionDays` (default 30 days) controls retention; unchanged values are not sampled again.

## Message visibility and remediation (0.8.0+)

Failed states are no longer a black hole: four tools plus one CLI command.

- `line_messages({ line?, states?, since?, limit? })`: query by state (including `failed`/`expired`), returns `counts.byState`; the manager may query any line, other lines only their own.
- `line_trace({ messageId })`: full lifecycle timeline of one message (state, time, attempt, actor, error) from `message_events`.
- `line_redeliver({ messageId, to?, resetAttempts? })`: manager only; works on `failed`/`expired` only, may retarget another line of the same agent, keeps hop and writes an audit event.
- `line_purge({ before, states?, dryRun? })`: manager only; `before` required, `dryRun` defaults to true, only terminal states by default, writes a `purged` audit event before deleting.
- `ackTimeoutMs` (default 600000): messages sitting in `delivered` longer than that are **flagged and counted** (`line_metrics.messages.ackOverdue`), **never auto-redelivered** (that would break I2).
- CLI: `dsh-agent-lines --json doctor` reports `health { failed, expired, ackOverdue }` plus next-step hints; `tail --line` shows every state.

## Use

A manager can be driven entirely by conversation:

> You are the manager line. Create frontend-line, backend-line and ops-line with `line_create`, then list them with `line_list`.

Tools:

| Tool | Purpose |
|---|---|
| `line_status` | Read-only: current Session binding, manager Session live/persisted, lines, repair command; visible even when unbound; includes activity (not contextUsage) |
| `line_claim_manager` | Bind this live root Session as manager; requires `allowClaim: true` and `confirm: "bind-manager"`; global, no shell needed |
| `line_list` | List lines, status, unread counts, current line and role |
| `line_create` | Manager only: create a line; same label is idempotent; replace:true swaps the label to a fresh Session |
| `line_handoff` | Manager only: structured handoff snapshot (JSON/Markdown), no model call |
| `line_observe` | Manager only: read-only cross-line feed with kind/approval state; no prompt injection, no state change |
| `line_manager_ack` | Manager only: approve/reject a pending_approval task |
| `line_team_board` | Manager only: read-only fused board; auto-reads Agent Teams tasks/members + lines; no user export/config |
| `line_retire` | Manager only: soft-retire; reject new sends, keep Session and history |
| `line_rebind` | Manager only: atomically switch a line to a new live Session, optionally migrating backlog |
| `line_rename` | Manager only: rename the sidebar title and persist it in lines.db |
| `line_move_workspace` | Manager only: attach an existing line Session to a workspace whose path exactly matches the Session cwd |
| `line_send` | Send to `line` or `agent#line`; optional `kind`, `ccManager`, `idempotencyKey`, `replyTo`, `noReply`, `forceDistinct`, `ttlMs` |
| `line_inbox` | Read delivered messages for the current line |
| `line_ack` | Acknowledge a delivered message |

Line tools other than `line_status` and `line_claim_manager` are registered only on Sessions bound to a line. Both control tools are global: `line_status` is read-only, and `line_claim_manager` is root-only and gated by `allowClaim`.

`line_create` creates an ordinary DSH Session in the manager workspace (or in the manager cwd when no workspace exists). It does **not** create a separate OS process, profile, or port; all lines in that call share the DSH process. It also does not transfer an existing Session.

### Replacing a line when context is full

A line does not inherit the old Session context. Recommended flow:

1. Have the old line write a handoff file (line_handoff is available from 0.3.7);
2. The manager calls `line_create({ label, replace: true, force: true, reason: "context full" })`;
3. The plugin creates a clean Session, atomically swaps the same label, and marks the old Session retired but keeps it;
4. queued/claimed messages migrate to the new line; delivered/acked stay on the old Session and are never re-delivered.

With `migrate: "none"`, a non-empty queue returns `LINE_BACKLOG_NOT_EMPTY` instead of silently switching.

Created lines are recorded with `created_by` and restored by the manager on process startup. line_create uses the manager's workspace (workspaceId, so DSH attaches the Session) when one exists; otherwise it falls back to the manager cwd and the line is ungrouped. Pass `workspace` (existing path or id) to create in another workspace. A line whose Session was never materialized may fail on first delivery with `session/not-found`; send it a task (or recreate it) to persist the Session.

CLI:

```bash
dsh-agent-lines list
dsh-agent-lines send --from frontend-line --to backend-line --text "hi"
dsh-agent-lines inbox --line backend-line
dsh-agent-lines ack --line backend-line --id msg_...
dsh-agent-lines --json observe --line writer --limit 20
dsh-agent-lines claim --agent agent-demo --line manager --session "$DSH_SESSION_ID"
dsh-agent-lines doctor
```

Use `--db` or `DSH_AGENT_LINES_DB` to point the CLI at the plugin's database.

## Transports

`transport` defaults to `sqlite` (local-first) and is the only transport shipped in 0.3. Installing the plugin never requires Postgres or a Python service.

## Architecture

~~~mermaid
flowchart LR
  U[User] --> M[Manager DSH Session]
  M -->|line_create / line_send| P[dsh-agent-lines]
  P --> Q[(SQLite lines.db)]
  P -->|prompt requestId| W1[Worker line Session A]
  P -->|prompt requestId| W2[Worker line Session B]
  W1 -->|line_inbox / line_ack| P
  W2 -->|line_inbox / line_ack| P
~~~

~~~text
dsh-agent-lines/
├── Manager Line            # manager (createFrom): decompose, dispatch, collect
│   ├── line_create         # create worker lines (manager only)
│   ├── line_send           # assign work / reply
│   ├── line_inbox          # receive worker reports
│   └── line_messages / line_trace / line_redeliver / line_purge   # visibility (0.8.0+)
├── Worker Line             # worker: executes the actual work
│   ├── (durable memory)    # context survives restarts
│   └── line_inbox / line_ack
├── Official Agent Teams    # official plugin: task board / deps / panel (read-only fusion)
└── lines.db                # local state: lines, roles, messages, events, leases
~~~

The DSH adapter owns line identity and delivery into a Session; the transport owns durable messages and cross-process storage. The default transport is local SQLite. Public architecture: [English](docs/ARCHITECTURE.en.md) | [中文](docs/ARCHITECTURE.md).

## Requirements

- DSH `>=0.2.1-rc.5 <0.3.0`
- Node.js `^22.19.0 || >=24.0.0`
- A local filesystem for the SQLite database (NFS/CIFS/SMB/FUSE are refused)

## Workspaces

DSH groups Sessions by workspace membership, not by cwd. line_create resolves the
manager's workspace with workspaceRegistry.resolveByPath and passes workspaceId,
so the new Session is attached and appears under that workspace instead of
"Ungrouped". If the manager has no workspace, the plugin falls back to cwd; the
line remains ungrouped until a workspace is created/attached.

line_move_workspace attaches an existing line to a target workspace. DSH itself
only allows attachment when the Session cwd exactly equals the workspace path;
the plugin returns WORKSPACE_ATTACH_FAILED otherwise. It does not move a Session
between different directories (that would require a new Session/handover).

## Manager binding and claim

The manager line is a real DSH Session. If you open a different Session, it is not the manager and the line tools are intentionally absent. Use `line_status` to see the configured manager and repair instructions.

A root Session can bind itself without a shell:

```json
line_claim_manager({ "confirm": "bind-manager" })
```

The tool validates that the caller is a live root, releases the old manager lease, rebinds the manager line, and persists the choice in `manager_bindings`. No profile edit or restart is needed. It requires `allowClaim: true`.

An operator can still use the CLI:

```bash
dsh-agent-lines claim --agent agent-demo --line manager --session "$DSH_SESSION_ID"
```

Claim is never automatic for every new Session: it needs an explicit user request or an explicit CLI call.

## Message kinds and task approval

`line_send` supports four kinds:

| kind | Meaning | Non-manager send |
|---|---|---|
| info | Informational sync | delivered directly |
| request | Request help | delivered directly |
| task | Assign work | becomes pending_approval; delivered only after manager approve |
| alert | Alert | delivered directly |

Manager tasks skip approval. Use `line_observe` to see pending tasks and `line_manager_ack({ messageId, decision: "approve" | "reject" })` to decide.

## Echo and duplicate protection

- Same `idempotencyKey` returns the existing message.
- Without a key, identical sends within `dedupeWindowMs` (default 5s) collapse to one; use `forceDistinct: true` for two intentional identical messages.
- `replyTo` increments `hop`; over `maxReplyDepth` (default 8) is rejected with `LINE_REPLY_DEPTH_EXCEEDED`.
- A `noReply: true` message cannot be replied to; attempts fail with `LINE_NO_REPLY`.
- Self-send is rejected by default (`LINE_SELF_SEND_FORBIDDEN`); set `allowSelfSend: true` only for deliberate notes.

This is transport-level protection. It does not guarantee that two agents will not choose to keep chatting; use `noReply` and reply depth for that.

## Delivery semantics

`queued → claimed → delivered → acked`

- `delivered` means the target DSH Session accepted the prompt.
- `acked` means an agent explicitly called `line_ack`.
- Delivery is **at-least-once**; DSH's `requestId` idempotency makes retries effectively-once in the Session log. It is not a distributed exactly-once guarantee.
- An offline receiver keeps messages queued; 0.3 has no automatic process wake.
- **One Session, one writer.** Do not open a line's Session in another DSH process (for example the main Web UI). DSH rejects delivery with `session/writer-held`; close the other view or use a dedicated Session.

## Security

- The plugin runs in the DSH Host process with host permissions. Install only packages you trust.
- Default transport is local SQLite; no network listener in 0.3.
- Only the configured manager line can create lines; `maxLines` bounds growth.
- Peer messages are marked as peer content, not user instructions.
- See [docs/SECURITY.en.md](docs/SECURITY.en.md).

## Limitations

- A Session cannot be moved to a different directory (`line_move_workspace` only attaches when the Session cwd equals the workspace path exactly); change who serves a role with `line_handoff` / `line_rebind` / `line_create({ replace: true })`.
- Same-process multi-line, not process isolation.
- One manager/team per plugin instance. Simultaneous teams (for example development and novel) in one DSH process are not supported; separate profile/DB is only a workaround, not the product model.
- No `line_delete`; a created line is durable, so testing creates real rows.
- A blank line Session may need its first task before it is persisted.
- DSH allows one writer per Session; do not open a line Session from another DSH process.

## Status

Experimental `0.7.x`. DSH is in developer preview and its APIs can change. Pin both the DSH version and this plugin's version.

## Credits

- Human vibecoding: **Lencen**
- Development agent: **DeepSeek Harness agent (DSH)**
- Model: **deepseek v4.1 flash 1017**
- Contact: [iamlencen@qq.com](mailto:iamlencen@qq.com)

## Contributing

See [CONTRIBUTING.en.md](CONTRIBUTING.en.md); code of conduct [CODE_OF_CONDUCT.en.md](CODE_OF_CONDUCT.en.md); docs site [lencen.github.io/dsh-agent-lines](https://lencen.github.io/dsh-agent-lines/).

## License

Apache-2.0. See [LICENSE](LICENSE).