# Architecture

English | [中文](ARCHITECTURE.md)

This is the public architecture overview. Version plans and release operations
live outside this repository.

## Layers

DSH Host
  -> dsh-agent-lines
       LineService      identity, line definitions, manager binding, claim/status
       DeliveryLoop     owner-process prompt delivery
       Tools            line_status, line_claim_manager, line_list, line_create,
                        line_move_workspace, line_send, line_inbox, line_ack
       Transport SPI
         SqliteTransport  current implementation; local SQLite/WAL

The DSH adapter owns who the current Session is and how a message enters a DSH
Session. The transport owns durable line and message storage.

SQLite is the only transport shipped in 0.3. The Transport SPI exists so a
future transport can implement the same contract without changing the adapter;
external transports are not part of this release.

## Delivery model

- A line is an ordinary DSH Session with a stable label.
- One Session has one writer. The process that owns the Session is the only one
  allowed to prompt it.
- Delivery uses the message id as the DSH requestId. A retry after a crash
  returns the original acceptance, so the Session log does not gain a duplicate.
- A lease elects the owner of a line; a stale claim is requeued after the claim
  timeout.
- delivered means the target Session accepted the prompt; acked means the agent
  called line_ack.

## Manager and claim

- The manager line is configured by createFrom and must be a live root Session.
- line_status is global and read-only. It reports current binding, manager
  Session live/persisted, known lines, and a repair command.
- line_claim_manager is a global tool gated by allowClaim; it requires an
  explicit confirm and accepts only a live root that is not bound to a worker.
  The CLI remains an operator fallback. The plugin validates the Session,
  releases the old manager lease, rebinds, and persists the choice in
  manager_bindings.
- Claim is not an automatic action for every new Session.

## Workspace

- DSH groups Sessions by workspace membership (workspace.attachSession), not by
  cwd.
- line_create resolves the manager workspace and passes workspaceId, so the new
  Session is attached to that workspace.
- line_move_workspace attaches an existing line only when its Session cwd exactly
  matches the target workspace path. It does not move a Session between
  different directories.

## Boundaries

- line_create creates a root DSH Session, not a subagent.
- No handover: no Session transfer, no route switch, no unread migration.
- No process isolation: multiple lines may share one DSH process.
- One manager/team per plugin instance; simultaneous teams are not supported.
- One Session, one writer: do not open a line Session from another DSH process.
- No line_delete: created lines are durable rows; testing creates real data.
- No network listener in the default SQLite transport.
