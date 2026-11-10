# Deploy

English | [中文](DEPLOY.md)

## One process, one or more lines

0.3 supports multiple lines in one DSH process, each bound to an ordinary DSH Session. A manager line with `allowCreate: true` and `createFrom` can create more lines with `line_create`; those lines live in the same DSH process and the manager's working directory.

It is still valid to run one line per DSH process (0.1 style) and share a `dbPath` across processes:

```text
DSH process A (profile lines-a, port 3081, line frontend) ─┐
DSH process B (profile lines-b, port 3082, line backend)  ─┼─ ~/.dsh/agent-lines/lines.db
DSH process C (profile lines-c, port 3083, line asset)    ─┘
```

`line_create` does **not** spawn a process/profile/port. If you need process isolation or different working directories per line, provision each line as its own DSH profile/process instead.

## Where to put the DB

- Local disk only. NFS/CIFS/SMB/FUSE are refused at startup.
- Default: `~/.dsh/agent-lines/lines.db`.
- The directory is created `0700`; the DB is chmod `0600`.

## Team workspace (teamRoot, optional)

Team files (TEAM.md / charters / decisions / registry) follow the manager workspace by default: without `teamRoot`, `line_init_team({teamName})` creates `<manager cwd>/<teamName>`.

You can also configure it explicitly:

- `teamRoot` as a workspace parent: team dir = `<teamRoot>/<teamName>`; `line_status` and the board resolve the newest child team;
- `teamRoot` as the team dir itself: used directly;
- the board `--team-root` may also be a parent; refresh after creating a team to follow it.

Production advice: one team per workspace; set `teamRoot` explicitly only when you need a fixed archive location.

## Session ownership

A DSH Session has one active writer. Never open a line's Session in another DSH process (for example, the main Web UI at 3080) while the line process is serving it. DSH will reject the plugin's prompt with `session/writer-held`, and the queued message will eventually fail after the retry budget.

If you need to inspect a line's Session, use the line process's own Web UI (it is the writer), or stop the line process first. For production, give each line its own Session and do not browse that Session from another DSH instance.

## Always-on lines

A line only consumes messages while its DSH process is alive. For an always-on line, run the DSH web profile as a user service:

```ini
[Unit]
Description=DSH web (agent line frontend)
After=network.target

[Service]
Type=simple
# Replace the path with the dsh binary of your installation.
ExecStart=%h/.npm-global/bin/dsh --profile lines-a web --no-open --host 127.0.0.1 --port 3081
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

If the process is down, messages stay `queued` and are delivered after restart. 0.3 does not start processes on demand.

## Manager binding and claim

If the configured manager Session is stale, a root Session can call:

```json
line_claim_manager({ "confirm": "bind-manager" })
```

The global tool checks that the Session is a live root, releases the old manager lease, rebinds the line, starts a new delivery loop, and persists the choice in `manager_bindings`. `allowClaim: true` must be set; no restart is required. The CLI fallback is:

```bash
dsh-agent-lines claim --agent agent-demo --line manager --session "$DSH_SESSION_ID"
```

If the configured manager Session is missing at startup, the plugin does not acquire it and does not report it online; `line_status` shows the missing state and the repair command.

## Session id

Configured lines need an existing `sessionId`; find it in the DSH session list/log, or use `dsh-agent-lines doctor` to inspect the queue. A wrong id fails permanently with `session/not-found` and the message moves to `failed`.

`line_create` generates a new `session-<uuid>` in the manager workspace (or cwd fallback) and returns it. The new line is an ordinary DSH Session, not a subagent; it does not get its own OS process.

Dynamic lines store `created_by`; a manager with `allowCreate` restores its created lines on startup and re-acquires their leases. If another process still owns a line, restore skips it. A blank Session that was never materialized may fail its first delivery; send a task or recreate it.

## Upgrades

1. Stop the DSH process (or let systemd restart it).
2. `dsh plugin --profile <p> add dsh-agent-lines@<version>`.
3. Restart.
4. Run `dsh-agent-lines doctor` and check leases/lines.

The SQLite schema is versioned with `PRAGMA user_version`; 0.3 is version 6 (adds `lines.role`, `lines.created_by`, `claim_requests`, `manager_bindings`, and message `hop`/`no_reply`/`root_message_id`). Existing version-1 databases are migrated in place on open. Back up `lines.db` before upgrading across minor versions.

## Uninstall / rollback

1. Remove the plugin entry from the profile patch and run `dsh plugin --profile <p> remove dsh-agent-lines`.
2. Restart DSH.
3. The DB is not deleted automatically. Move or delete `lines.db` only after you no longer need the queued messages.
4. The plugin never modifies `~/.dsh/sessions`.
