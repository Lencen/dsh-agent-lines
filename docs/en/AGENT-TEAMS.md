# Agent Teams read-only integration (0.5.0)

One line: lines own people, Agent Teams owns tasks, files own memory.
The user only sends a task to the manager; no export, no config, no plugin buttons.

## Precondition

- The manager line must also be the Agent Teams Lead or member.
- Otherwise line_team_board returns available=false; no user export fallback.

## User flow

Say:

~~~text
Write ch027 and hand it to the writer and proofreader.
~~~

The manager creates the Agent Teams task, creates/reuses line roles, calls ctx.agentTeams.listTasks/listMembers, maps teammate names to line labels, and returns line_team_board.

## Board data

- tasks: id, subject, status, ownerName, ownerLine, blockedBy, staleOwner;
- lines: label, role, session, online, unread, activity;
- inbox: pending_approval, blocked, stale_owner, line_offline, unavailable.

## Read-only

- no task writes;
- no lines.db writes;
- no manager turn;
- messages without taskRef stay in the communication stream.

## Limits

- ctx.agentTeams is an experimental internal service, not a stable public API;
- unavailable is shown explicitly;
- L2 bidirectional bridge is not approved.
