# Usage boundaries (maturity statement)

> This document answers: within its own scope, what can you rely on and what can you not? It is not a disclaimer, and it does not judge how large the product could become.

## 1. Scope: responsible / not responsible

**Responsible**: a durable message channel between long-lived roles — stable role identity (label), cross-restart session memory, role handoffs, an auditable message queue, and a read-only board over this data.

**Not responsible**: task decomposition, DAG/dependency orchestration, quality gates, cross-machine sync, multiple teams in one process, or bidirectional write-back to the official task board. Those belong to the manager/role prompts or to the DSH official Agent Teams plugin (built into DSH).

## 2. Stable surface: what will not change casually

| Surface | Guarantee |
|---|---|
| Message envelope | protocolVersion 0.4 semantics fixed; different major rejected, newer minor ignores unknown fields |
| schema / conformance | executable spec another implementation can follow |
| Error codes | LINE_* only add, existing semantics do not change |
| Message state machine | queued → claimed → delivered → acked, with failed/expired branches |
| Delivery semantics | at-least-once; idempotency authority is DSH requestId / explicit idempotencyKey |
| Database | schema v15, additive migrations only, no manual step |

## 3. Will change: do not hard-depend

- Tool names and parameters (currently 26) may be added/removed; use AGENTS.md as the current contract;
- Board HTML and /api/live response shape evolve with the UI;
- Patch versions may include behavior changes; pin both the DSH version and the plugin version;
- lines.db internal tables only guarantee additive columns; read through the CLI, do not write SQL directly.

## 4. Known boundaries: triggered, with workarounds

| Case | Effect | Workaround |
|---|---|---|
| One Session has one writer | another DSH process opening the line Session gets session/writer-held | one process per line, or close other views |
| One plugin instance supports one team | cannot run multiple teams in one process | separate profile + separate DB |
| DB on NFS/CIFS/SMB/FUSE | startup rejects with LINE_NETWORK_FILESYSTEM | use local disk |
| Deleting a line Session | messages fail permanently with session/not-found | do not delete; use line_retire |
| Ack timeout | report-only, never auto-redeliver | inspect line_messages / line_metrics, then line_redeliver |

## 5. Failure recovery and data responsibility

- Failed messages: line_messages({states:["failed"]}) / line_trace / line_redeliver / line_purge;
- Health: CLI doctor;
- Data lives in local lines.db; the plugin collects no telemetry and has no automatic backup; back up yourself (quiesce then copy, or use the SQLite backup API);
- The board is read-only and offers no recovery actions.

## History

0.11.2 and earlier had a bucket-boundary duplicate issue, fixed in 0.11.3; 0.11.4 adds indexes without changing semantics.

## Version

Current release 0.12.0. If this document and the code disagree, AGENTS.md / CHANGELOG win; treat it as a docs bug.
