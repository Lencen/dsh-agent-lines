# Protocol (v0.3)

English | [中文](PROTOCOL.md)

## Address

- Agent: `^[a-z0-9][a-z0-9._-]{0,95}$`
- Line: `^[a-z0-9][a-z0-9._-]{0,63}$`
- Canonical line id: `<agentId>#<line>`
- A bare target uses the sender's `agentId`.

## Envelope

```json
{
  "id": "msg_...",
  "idempotencyKey": "caller:retry-1",
  "from": { "agentId": "agent-demo", "line": "frontend", "sessionId": "session-..." },
  "to":   { "agentId": "agent-demo", "line": "backend" },
  "body": { "text": "..." },
  "createdAt": 1793757000000,
  "expiresAt": null,
  "replyTo": null,
  "rootMessageId": "msg_...",
  "hop": 1,
  "noReply": false
}
```

## State machine

```text
queued ──claim──> claimed ──prompt accepted──> delivered ──line_ack──> acked
  │                 │                              │
  │                 └──claim timeout──> queued     └──TTL──> expired
  └──retry exhausted──> failed
```

- `queued`: durable, not yet claimed.
- `claimed`: one owner process has taken it; a claim older than `claimTimeoutMs` is requeued.
- `delivered`: `ctx.sessionController.prompt` accepted the message into the target Session inbox.
- `acked`: the target called `line_ack`.
- `failed`: retry budget exhausted or a permanent error (`session/not-found`).
- `expired`: TTL passed before delivery.

## Delivery semantics

**At-least-once, effectively-once in the DSH Session log via `requestId`.**

The message id is passed as `SessionPromptRequest.requestId`. DSH returns the original acceptance when the same requestId is retried, so a crash between "prompt accepted" and "mark delivered" does not duplicate the Session message. The queue may still show `queued` and retry; that is expected.

This is not a distributed exactly-once guarantee: the DSH Session log is the idempotency authority, not the SQLite queue.

## Leases

- One line has at most one live owner instance.
- `acquire` sets `expires_at = now + leaseTtlMs`; a second instance gets `LINE_LEASE_HELD`.
- The owner heartbeats every poll; a stale lease expires after the TTL.
- On graceful shutdown the owner releases the lease.
- A crashed owner's lease expires; a new process can acquire it.

## Status and claim

`line_status` is a global read-only tool. It uses `sessionPersistence.stat` for the manager Session and does not resume it. It returns current binding, manager live/persisted, lines, and a repair command.

A claim can be made by a root Session through `line_claim_manager` (global tool, `allowClaim: true`, `confirm: "bind-manager"`) or by the CLI. Both write a row in `claim_requests`:

```text
line_claim_manager / CLI -> claim_requests(pending)
plugin poll -> validate root/live/not-bound
  -> stop old manager loop, release lease
  -> update lines.session_id, acquire new lease
  -> manager_bindings upsert
  -> start loop, bind tools/prompt
  -> claim_requests(claimed|rejected)
```

`line_claim_manager` is not automatic: it requires an explicit user request and is rejected for worker-bound or non-root Sessions.

`manager_bindings` is the durable source for the manager Session across restarts; the profile config is the fallback.

## Provisioning

Only the configured manager line (`createFrom`) with `allowCreate: true` may call `line_create`.

```text
line_create(label, role?, workspace?, cwd?, agentPreset?)
  -> existing label? return { line, sessionId, role, created: false }
  -> countLines(agent) >= maxLines? LINE_LIMIT
  -> sessionController.create({ sessionId: session-<uuid>, workspaceId? | cwd, agentPreset })
  -> store.acquire + start DeliveryLoop + bind prompt
  -> return { line, sessionId, role, cwd, created: true }
```

The new line is an ordinary DSH Session in the same DSH process; no OS process, profile, port, or handover is created. It records `created_by` so the manager can restore it on startup.

`line_create` resolves the manager's workspace with `workspaceRegistry.resolveByPath(managerCwd)`. When found, it passes `workspaceId` (and not `cwd`) so `sessionController.create` calls `workspace.attachSession`. Optional `workspace` names an existing workspace path/id; `workspace` and `cwd` are mutually exclusive. If no workspace exists, the plugin falls back to `cwd` and the line stays ungrouped.

`line_move_workspace({ line, workspace })` attaches an existing line Session to an existing workspace. DSH's `attachSession` validates that the Session's stored cwd resolves exactly to the workspace path; a different directory fails with `WORKSPACE_ATTACH_FAILED`. It does not move a Session between different directories. If Session creation succeeds but registration fails, the error carries `detail.sessionId` and the Session is not deleted automatically.

## Line lifecycle (0.3.6)

    line_retire({ line, reason? })
    line_rebind({ line, sessionId, migrate?: "queued" | "none", reason? })
    line_create({ label, replace: true, force?, migrate?, title?, reason? })
    line_rename({ line, title })

- retired: line_send returns LINE_RETIRED; the Session and history are kept.
- rebind: atomically switches lines.session_id and increments generation; the old Session is never deleted.
- migrate=queued: queued/claimed messages move to the new Session; delivered/acked are never re-delivered.
- migrate=none: returns LINE_BACKLOG_NOT_EMPTY if the backlog is non-empty.
- replace: creates a fresh Session for the same label and rebinds; an active line requires force + reason.
- line_events records title/retire/rebind audit; titles survive restarts.

## Echo and reply depth

- `rootMessageId` groups a reply chain; a root message has null.
- `hop` is 0 for a root and parent.hop + 1 for a reply.
- `maxReplyDepth` (default 8) rejects a deeper reply with `LINE_REPLY_DEPTH_EXCEEDED`.
- `noReply: true` marks a notification; replying is rejected with `LINE_NO_REPLY`.
- Self-send is rejected by default with `LINE_SELF_SEND_FORBIDDEN`.
- Without an explicit key, identical sends inside `dedupeWindowMs` (default 5s) collapse; `forceDistinct: true` opts out.

## Idempotency keys

- `caller:<key>`: caller-controlled; the same key returns the existing message.
- `auto:<sha256>`: generated per send; two intentional identical messages are distinct.
- The database has a UNIQUE constraint on `idempotency_key`.

## Errors

| Code | Meaning |
|---|---|
| `LINE_INVALID_CONFIG` | Missing/invalid config |
| `LINE_INVALID_AGENT` / `LINE_INVALID_LINE` | Bad address part |
| `LINE_INVALID_TARGET` | Malformed target |
| `LINE_NOT_FOUND` | Target/sender line not registered |
| `LINE_LEASE_HELD` | Another live process owns the line |
| `LINE_LEASE_LOST` | This process no longer owns the line |
| `LINE_MESSAGE_NOT_FOUND` | Ack for an unknown message |
| `LINE_NOT_DELIVERED` | Ack before delivery |
| `LINE_MESSAGE_TOO_LARGE` | Body exceeds `maxMessageBytes` |
| `LINE_NETWORK_FILESYSTEM` | DB is on NFS/CIFS/SMB/FUSE |
| `LINE_WRONG_SESSION` / `LINE_NOT_BOUND` | Tool called from a Session this process does not serve |
| `LINE_LIMIT` | `line_create` would exceed `maxLines` |
| `LINE_CREATE_DISABLED` | This profile did not enable `allowCreate` |
| `LINE_CREATE_FORBIDDEN` | Caller is not the configured `createFrom` manager |
| `LINE_SESSION_BOUND` | Claim target is already bound to a different line |
| `SESSION_NOT_LIVE` / `NOT_ROOT` | Claim target is not a live root Session |
| `LINE_INVALID_ARGUMENT` | Invalid tool argument, e.g. limit |
| `LINE_CLAIM_DISABLED` | allowClaim is false |
| `LINE_CLAIM_CONFIRM_REQUIRED` | confirm is not "bind-manager" |
| `LINE_NOT_ROOT` | A non-root Session tried to claim manager |
| `LINE_SELF_SEND_FORBIDDEN` | Self-send is disabled |
| `LINE_NO_REPLY` | Reply to a noReply message |
| `LINE_REPLY_DEPTH_EXCEEDED` | Reply chain exceeds maxReplyDepth |
| `LINE_REPLY_TARGET_NOT_FOUND` | replyTo names an unknown message |
| `session/writer-held` (DSH) | Another DSH process holds the target Session's writer lock; close the other view or use a dedicated Session |