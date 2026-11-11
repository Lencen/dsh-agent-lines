# Agent Teams read-only integration (0.5.0)

One line: lines own people, Agent Teams owns tasks, files own memory.
The user only sends a task to the manager; no export, no config, no plugin buttons.

## The three levels after integration

~~~~text
L1 manager session (the user only states goals)
  └─ L2 role session (long-lived role, durable memory)
       └─ L3 DSH official Agent Teams plugin (built into DSH) team inside that role session (teammates, task-scoped, parallel, released after use)
~~~~

- L1 owns lines: create lines, dispatch, approve `subteamPolicy`, accept results.
- L2 owns the work: decompose, decide "do it myself or open L3", produce and self-check, report back.
- L3 owns parallelism: subtasks, cross-verification, one-off quality points.
- The official task board owner can only be a teammate (L1/L2 cannot own tasks; read-only mapping).
- **Task-tree parent/child relations are projected by the lines layer** (`parentTaskRef` → `parentTaskId`): the official board does not expose this field; the board only carries the reference.
- Memory and evidence live in files (single source of truth).

## Who does the work: L2 or L3

Default: L2 does it. Open L3 only when one of these holds and no prohibition applies: parallel verification (≥2 independent proposals/angles), chunked production (≥3 independent output units), an independent quality point (review/proofread/fact-check), a long critical path where parallelism clearly helps.

Always L2: long-lived role memory, same-file write conflicts, smaller than one turn, final acceptance to the user, cross-session handoff.

Full policy (seven dimensions, A/B rules, `subteamPolicy` semantics, standard steps, update loop): [DELEGATION-POLICY.en.md](../DELEGATION-POLICY.en.md).

> The plugin does not auto-detect, dispatch, or hard-block; the L2 agent decides by that policy and the plugin records, displays and audits (invariant I5).

## Precondition

- The manager line must also be the Agent Teams Lead or member.
- Otherwise line_team_board returns available=false; no user export fallback.

## User flow

Say:

~~~text
Write ch027 and hand it to the writer and proofreader.
~~~

The manager creates the Agent Teams task, creates/reuses line roles, calls ctx.agentTeams.listTasks/listMembers, maps teammate names to line labels, and returns line_team_board.

## Host snapshot

When the manager calls the board, the plugin writes DSH_HOME/agent-lines/team-board.json automatically (mode 0600, atomic replace); no export or config needed.

## Board data

Snapshot files (`team-board.json` / `team-metrics.json`) carry `schemaVersion` and `protocolVersion`; consumers **ignore unknown fields**, new fields are additive only (0.9.0 S2 / F7).

- tasks: id, subject, status, ownerName, ownerLine, blockedBy, staleOwner, **parentTaskId** (projected by the lines layer from `parentTaskRef`; the official board does not provide it);
- lines: label, role, session, online, unread, activity;
- inbox: pending_approval, blocked, stale_owner, line_offline, unavailable.

## Read-only

- no task writes;
- no lines.db writes;
- no manager turn;
- messages without taskRef stay in the communication stream;
- the board's line-tasks view aggregates lines messages read-only; it never writes the official board or fakes an official DAG;
- board teamRoot resolution: argument -> env -> plugin-written team-root sidecar; if none, print unresolved.

## Limits

- ctx.agentTeams is an experimental internal service, not a stable public API;
- unavailable is shown explicitly;
- L2 bidirectional bridge is not approved.

## Example

~~~json
{
  "available": true,
  "manager": { "line": "manager" },
  "tasks": [
    { "id": "task-1", "subject": "ch027 draft", "status": "pending", "ownerName": "writer", "ownerLine": "writer", "staleOwner": false, "blockedBy": [], "parentTaskId": null }
  ],
  "lines": [
    { "label": "writer", "role": "writer", "status": "online", "unread": 0 }
  ],
  "inbox": []
}
~~~
