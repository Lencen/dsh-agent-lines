# Changelog

English | [中文](CHANGELOG.md)

## 0.11.6 (2026-11-11)

### Manager handover + old manager retirement

- **Manager handover tool**: adds line_handover_manager (manager-only, confirm: "handover-manager") to hand the manager role to an existing live root Session; it does not create a root Session.
- **Automatic old-manager retirement**: line_claim_manager and line_handover_manager tag the old manager Session with 【退役YYMMDD】 when it is live; the handover is written to line_events (rebind).
- **Board tasks default to line-layer tasks**: the primary tab groups line_send(task)/taskRef messages into task cards with status filters and a message-timeline detail drawer; the org view shows L2 line tasks and L3 split tasks; official tasks remain a secondary tab.
- **Tool count 26 → 27**; no schema or protocol changes; schema v15 and protocolVersion 0.4 unchanged.
- **Boundary**: an already-offline Session cannot be renamed through the plugin (DSH public API limit); finish it during handover.

**0.11.6 is authoritative; 0.11.5 is the fallback.**

## 0.11.5 (2026-11-11)

### Articles and bilingual docs

- Added the short article "Reflections on AI Organizations" in Chinese and English: the Chinese file uses a Chinese name (docs/关于AI组织的思考与探索.md), and the English file uses an English name (docs/en/THOUGHTS-ON-AI-ORGANIZATION.md).
- Added the paper "From Workflow to Position: Organizational Design for Long-Lived AI Teams" in Chinese and English: Chinese docs/从流程到岗位.md; English docs/en/FROM-WORKFLOW-TO-POSITION.md.
- README now links the articles; the docs-consistency gate covers the two new zh/en article pairs; the site version is synced to 0.11.5.
- Compatible: no code, schema, or protocol changes; schema v15 and protocolVersion 0.4 unchanged.

**0.11.5 is authoritative; 0.11.4 is the fallback.**

## 0.11.4 (2026-11-11)

### CLI parity + schema v15 dedupe indexes + fake-green fix

- **CLI/tool parity**: send adds --kind/--task-ref/--parent-task-ref/--task-scope/--subteam-policy/--max-members/--cc-manager/--require-approval/--force-distinct/--dedupe-window; the digest uses the same 11 fields as the tool layer; DSH_AGENT_LINES_DEDUPE_WINDOW_MS is shared by plugin and CLI.
- **schema v15**: messages gains dedupe_digest + messages_dedupe index; dedupe lookup changes from a LIKE full scan to an equality index; new messages_kind_created / messages_task_ref_created indexes serve lineTasks; legacy window keys are backfilled.
- **fake-green fix**: npm test runs scripts/check-test-set.mjs first; an installed package without test/ fails explicitly instead of running 0 tests and exiting 0; unit tests run from the source repo; CI adds a package test that must fail closed.
- Docs: USAGE-BOUNDARY adds the history note that 0.11.2 and earlier had bucket-boundary duplicates, fixed in 0.11.3; README/AGENTS sync CLI options/schema v15.
- Compatible: protocolVersion 0.4 unchanged; schema v14 -> v15 is additive; back up lines.db before upgrading, downgrade is not recommended.

**0.11.4 is authoritative; 0.11.3 is the fallback.**
## 0.11.3 (2026-11-11)

### Usage boundaries + dedupe fix + board polish

- **Dedupe window fix**: replaced fixed time buckets with a sliding window (store-level BEGIN IMMEDIATE over recent windowMs/digest), so bucket boundaries no longer duplicate; CLI and tools share it; tests cover cross-bucket/outside-window/explicit key/forceDistinct/self-send/CLI.
- **README released-version cleanup**: removed internal build sections 0.11.0-13 ... 0.11.0-30 (itemized here); C6b only requires released versions.
- **Board line tasks view**: tasks view switches between official and line tasks; /api/live.lineTasks read-only aggregates kind=task/taskRef, no fake DAG.
- **teamRoot sidecar**: the plugin writes configured teamRoot to a team-root file next to the db; the board resolves argument -> env -> sidecar and logs the result.
- **Read-only explanation**: footer link to why read-only.
- **/api/live.tokens**: removed the stale unavailable placeholder; cost data remains from /api/team-metrics.
- **Usage-boundary doc**: new docs/USAGE-BOUNDARY.md and English version, linked from README with a one-line summary; no early-stage/rating/no-SLA copy.
- **CI**: installs Chromium and runs test:board-e2e --require-chrome; e2e no longer SKIP.
- **History note**: the 0.11.2 security rewrite changed the target/commit SHA of the four published tags v0.9.0/v0.10.0/v0.11.0/v0.11.1; use versions or npm instead of fixed SHAs. Published tags are no longer force-pushed.
- Compatible: no DB migration (schema v14), protocolVersion 0.4 unchanged; removing /api/live.tokens is a board API compatibility change.

**0.11.3 is authoritative; 0.11.2 is the fallback.**
## 0.11.2 (2026-11-11)

### Feedback fixes: board rendering, rebinds, handoff, compatibility

- **P1-04**: normalize team-board snapshots (array/object map/count) with `tasksShape/tasksDiagnostic`; frontend `asArray`, visible errors, four empty states; new headless `board-render-e2e`.
- **P1-01**: `/api/live` lines expose `oldSessionId` and `rebinds[]` (single SQL over line_events); the board shows generation handoffs.
- **P1-02**: replace/retire retitle the old Session to `【退役YYMMDD】original title`; best-effort, failures degrade without breaking the main flow.
- **P1-03**: `line_handoff` accepts optional `sections` (current/todos/conventions/pitfalls) and `extra`, truncating with `truncated`.
- **P2-02**: history includes generations; **P2-04**: replace inherits role/title; **P2-05**: restored compatible `/api/live` `counts`; **P2-06**: task stages read TEAM.md `## 协作流程`, missing shows "not collected".
- **P3-01**: TEAM.md template hints; **P3-02**: cost view splits cache read/output/uncached input.
- Compatible: no DB migration (schema v14), protocolVersion 0.4 unchanged; new script `scripts/board-render-e2e.mjs` (`npm run test:board-e2e`).
- Install/packaging/CI: `install.sh` defaults to `@latest` (local current-version tgz when present), removing the hard-coded 0.7.0; README drops the 0.6.0 tarball example and marks 0.6.5 as a pre-readonly historical record; removed dead `web/board.v11-port.html`; added GitHub Actions `ci.yml` (Node 22/24 runs npm test + pack dry-run).

**0.11.2 is authoritative; 0.11.1 is the fallback.**
## 0.11.1 (2026-11-10)

### Documentation completion (same functional code as 0.11.0)

- Adds README reading order and "what it is not" (DAG/workflow engine, chat-bot roster, IM; organizational base vs business intelligence).
- Site adds "why it is not an ordinary multi-agent plugin", reading order and the 0.11.1 version; philosophy adds the boundary note and T6/T7; KNOWN_ISSUES/DEPLOY/AGENTS synced.
- No code, protocol or DB change (schema v14 / protocolVersion 0.4 unchanged).
- Note: 0.11.0 was released from the initial candidate before docs were completed; npm is immutable, so 0.11.1 completes the docs.

**0.11.1 is authoritative; 0.11.0 is the fallback.**
## 0.11.0 (2026-11-10)

### Team workspace, real-data board, and "visible on creation"

- New team workspace (line_init_team): TEAM.md / charters / decisions / registry; the board has five real-data views, and the org view renders the goal and optional collaboration flow from TEAM.md.
- **Visibility behavior change**: line_create always bootstraps and waits until the Session is blank=false; per-call bootstrap:false is ignored (deployment-level bootstrapOnCreate:false still disables it). A UX change, not a protocol break.
- **Team dir follows the workspace**: teamRoot is optional; without it the team is created under the manager cwd; a parent dir resolves the newest child team and line_status discovers it too.
- **Token basis**: line_metrics/board default to totalTokens (uncached input + output + cache read/write), output buckets kept.
- Batch line creation, JSON-safe batch replace results, removal of all prototype demo data; missing data shows "no data / unavailable / not collected".
- No DB migration, no protocol change (schema v14 unchanged).

**0.11.0 is authoritative; 0.10.0 is the fallback.**
## 0.11.0-30 (internal build, included in 0.11.0)

### Unified teamRoot semantics: workspace parent / cwd fallback (S5n)

- `line_init_team({teamName})`: explicit `teamRoot` > config `teamRoot` > **manager current workspace (cwd)**; team dir = base/<teamName>. Teams can live in the current workspace without config.
- `teamRoot` may be a **workspace parent**: `line_status.teamWorkspace` and the board resolve the newest child team; it may also be the team dir itself.
- `line_status` without `teamRoot` now discovers the team under the current Session cwd instead of showing disabled.
- docs updated (AI-USAGE / AGENTS).
- No DB migration, no protocol change.

## 0.11.0-29 (internal build, included in 0.11.0)

### Board --team-root accepts a parent dir and follows the newest team (S5m)

- If `--team-root` points to a parent without TEAM.md/registry.json, the board resolves to the newest child team (mtime); refresh after creating a team, no restart/param change.
- Team goal/collaboration flow still come from that team's own TEAM.md (`## 协作流程`); teams never share a flow.
- No DB migration, no protocol change, read-only.

## 0.11.0-28 (internal build, included in 0.11.0)

### New lines are visible immediately (bootstrap:false no longer hides them) (S5l)

- User feedback: lines created with `bootstrap:false` were missing from the DSH sidebar; **visibility beats token cost**.
- New behavior: `line_create` always queues onboarding (unless deployment config `bootstrapOnCreate:false`) and **waits until the new Session flips `blank=false`** before returning (result carries `visibleInSidebar` / `bootstrapForced`); batch results carry them too.
- Per-call `bootstrap:false` is accepted for compatibility but ignored; docs now say do not hide lines to save tokens.
- No DB migration, no protocol change.

## 0.11.0-27 (internal build, included in 0.11.0)

### Board collaboration-flow card is data-driven (S5k)

- The org view's "collaboration flow" card was a **static prototype demo** (需求/架构/开发/评审/测试/验收/发布 + README.md·2026-11-04); it stayed visible for non-dev teams. It now reads the optional `TEAM.md` section `## 协作流程` (`→` / 、 / commas / one per line); missing shows "not collected".
- `parseTeamGoal` adds `workflow`; `/api/live` teamGoal carries it.
- docs: TEAM-WORKSPACE 2e; AI-USAGE optional fifth section.
- No DB migration, no protocol change, read-only.

## 0.11.0-26 (internal build, included in 0.11.0)

### Fix line_create batch replace returning non-lossless JSON (S5j)

- Symptom: `line_create({lines:[...], replace:true, ...})` failed in DSH with `tool "line_create" returned invalid output: value is not lossless JSON`.
- Cause: each batch item copied `lifecycle` from the create/replace result; the replace path has no `lifecycle` field → `undefined`, which DSH rejects as non-lossless JSON. **The operations themselves had already been applied** (rebind/title events persisted); only the return value failed validation.
- Fix: normalize each batch item to JSON-safe values (`sessionId/role/title/lifecycle` default null, add `replaced:true|false`), no undefined.
- New regression test: batch replace output round-trips through JSON with no undefined values.
- No DB migration, no protocol change.

## 0.11.0-25 (internal build, included in 0.11.0)

### Token metrics now use totalTokens (input + output + cache) (S5i)

- Sampling reads DSH's `tokenUsage` projection (uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens) and records **totalTokens = uncached input + output + cache read/write**; the token_sample detail keeps every bucket.
- `line_metrics.tokens` now defaults to totalTokens: top-level `total/today/window/perDay[]` are total tokens; new `outputTotal/todayOutput/windowOutput/perDayOutput`, `inputTokens/cacheReadTokens/cacheWriteTokens`; per-line entries expose both buckets and totalTokens.
- Board cost / per-line cost / per-day token charts read totalTokens; sampling dedupe compares all buckets.
- docs: AI-USAGE updated (totalTokens is the DSH-basis number; output alone is not total cost).
- No DB migration, no protocol change, read-only.

## 0.11.0-24 (internal build, included in 0.11.0)

### Batch line creation + sampling-short display + token basis (S5h)

- `line_create` accepts batch `lines:[{label,role?,title?}]`: create many lines in one call, returning `{created,skipped,failed,counts}`; existing labels are skipped and per-item failures do not abort the batch. Reduces manager model steps during setup (each step re-sends context, the dominant part of DSH total tokens).
- Board cost card: when token samples < 2, "today / last 7 days" show **sampling not ready**, plus cumulative decodeTokens (previously 0k looked like no spend).
- docs: AI-USAGE adds the batch example and the token basis note — decodeTokens counts output tokens only; DSH total (input + cache) measured 30–80× larger (clean env: manager session 64 steps, output 71,400, cacheRead 5,758,848, total 5,916,491).
- No DB migration, no protocol change, read-only.

## 0.11.0-23 (internal build, included in 0.11.0)

### line_init_team parameter fix + decision status (S5g)

- Fixed: when `line_init_team({teamRoot, teamName})` received both, teamRoot won and teamName was ignored, flattening files into the parent dir (agents had to "generate then mv", triggering the DSH read-before-overwrite error chain). Now teamRoot is the parent and teamName the subdir; passing only one behaves as before.
- `decisions/*.md` supports an optional `## 状态` section (e.g. 已采纳); the board's "needs decision" card lists pending items only, processed items are counted but not shown as pending; the pending KPI is corrected.
- docs: AI-USAGE adds the parameter rule and the decisions convention (do not put setup audit notes under decisions/); TEAM-WORKSPACE documents decision status.
- No DB migration, no protocol change, read-only.

## 0.11.0-22 (internal build, included in 0.11.0)

### Board per-line chart includes manager + low-token setup docs (S5f)

- The data/cost "per-line tasks / messages / cost" chart now includes the **manager** line (previously DATA.agg excluded it); "messages" is counted per line from team-board.messages (from/to) instead of always 0.
- `docs/AI-USAGE.md` adds "low-token team setup": pass `bootstrap:false` on line_create (measured ~65k tokens saved for 8 lines), one `line_status` only, no metrics/board calls during setup, use low reasoning/cheap model for mechanical setup.
- No DB migration, no protocol change, read-only.

## 0.11.0-21 (internal build, included in 0.11.0)

### Docs: agent usage manual v2 (S5e)

- Rewrote `docs/AI-USAGE.md`: five-step team setup (teamName required; TEAM.md and charter sections), board guide (start command, five views, version source, data sources and unavailable-state rules, `status --json`), tool table, key rules, **common error codes → next step**, acceptance checklist, and doc index.
- Aligned with the 0.11.0-20 board behavior (real data, plugin version badge, empty task state is real).
- Docs only; no code behavior change; no DB migration, no protocol change.

## 0.11.0-20 (internal build, included in 0.11.0)

### Board detail fixes (S5d-3)

- Overview goal card restores the "from TEAM.md" badge (title and badge are separate nodes now); progress bar reflects real task completion (0 when no tasks).
- Cost view "per-line cost" includes the manager line (previously only 8 role lines; manager's 21k tokens were not shown).
- The rest is the same as 0.11.0-19 (high-fidelity UIUX unchanged, real data).

## 0.11.0-19 (internal build, included in 0.11.0)

### Board static slots and asset fix (S5d-2)

- Fixed the missing static data slots in 0.11.0-18: brand/plugin-version badge, overview goal card, KPI numbers, org plan/cadence, data time, cost KPIs, footer version now bind to real data.
- Fixed the ECharts asset path: the prototype referenced `echarts.min.js` but the board server only serves `/vendor/echarts.min.js`, so data/cost charts were blank; now uses `/vendor/echarts.min.js`.
- High-fidelity layout/components/interactions unchanged; no DB migration, no protocol change, read-only.

## 0.11.0-18 (internal build, included in 0.11.0)

### Restore high-fidelity UIUX + real-data adapter (S5d)

- **Restored** `web/board.html` to the approved high-fidelity prototype (layout, components, interactions, themes unchanged): overview, org (chart/tree/search/retired), tasks, data (ECharts), cost, docked detail drawer, mobile sheet, light/dark.
- Rewrote the data adapter: keeps the prototype's `DATA` render model, synchronously clears demo data, then fills real data from `/api/live` + `/api/team-board` + `/api/team-metrics` + `/api/health` and re-renders (team goal/org/tasks/data/cost/decisions/handoffs/charters).
- Demo static copy replaced with real data slots (topbar/overview/org/data/cost/footer); the "UIUX demo" footer wording is removed; footer shows the plugin version.
- Missing data renders as "no data / unavailable / not collected"; if an API fails the page stays in the empty state (fail-closed).
- Removed the substitute hacks (`showOrg` view replacement, TreeWalker text patches).
- No DB migration (schema v14), no protocol change (0.4), read-only.

## 0.11.0-17 (internal build, included in 0.11.0)

### Footer version fix (S5c-4)

- The footer now prints the raw `/api/health.version` value instead of concatenating `0.11.0-<suffix>` (that only worked for 0.11.0-x and would be wrong for the next version).
- The rest is the same as 0.11.0-16 (topbar/footer show the plugin version explicitly).

## 0.11.0-16 (internal build, included in 0.11.0)

### Board shows plugin version (S5c-3)

- Topbar badge now reads "插件版本 v0.11.0-16" (sourced from `/api/health.version`); footer shows the plugin version too.
- Note: 0.11.0-15 already had a version badge (v0.11.0-15); this release only makes the label explicit and shows it in two places.

## 0.11.0-15 (internal build, included in 0.11.0)

### Board metric alignment (S5c-2)

- Overview "members" now uses the official task-board projection (`team-board.members`) instead of showing "9 lines / 0 members" side by side.
- Data view shows both "official members (snapshot)" and "team-board members" so source differences are visible, never merged.
- The rest is the same as 0.11.0-14 (pure data-driven board, real charters, official task projection, gates).

## 0.11.0-14 (internal build, included in 0.11.0)

### Board real-data fix (S5c)

- Fixed the inline adapter syntax error in `web/board.html` (`mapLive` brace mismatch) that prevented the data mapping from running and left prototype demo content on the page.
- Removed all prototype demo data (`DATA.missions`, etc.); the five views are now pure data-driven from `/api/live` + `/api/team-board` + `/api/team-metrics`; missing data renders as unavailable / not collected.
- Line detail reads real `charters/<label>.md` sections (positioning/responsibilities/outputs/quality/boundaries/collaboration/dispatch) and header fields; no demo-charter fallback.
- Tasks view shows the official task projection (shows "no tasks" when empty); no prototype tasks.
- Data/cost views consume `team-metrics.json` task/message/token estimate trends (session-level estimate, not billing).
- New gate `scripts/check-board-scripts.mjs` (inline script syntax + demo-data residue + write-API check) wired into `npm test`.
- `/api/health` now exposes `version`; the board version badge is no longer hardcoded; `/api/live` teamWorkspace line entries add `header`/`missingSections` (additive).
- No DB migration (schema v14), no protocol change (0.4), read-only.

## 0.11.0-13 (internal build, included in 0.11.0)

### Team workspace and board (S5)

- New optional teamRoot: read-only registry.json, charters, TEAM.md (goal/summary/plan/cadence), decisions/*.md; missing fields show not collected/unavailable, never invented.
- New manager-only tool line_init_team (tool count 25->26): idempotent init/merge of TEAM.md, manager/line charters, decisions README, registry; no overwrite by default.
- Zero-config manager defaults to role 负责人; manager charter states manage-only (no execution), resource coordination, goal extraction and TEAM.md updates.
- Board rewrite: overview/org/tasks/data/cost, docked detail drawer, default team goal, decision detail, L1/L2/L3 org, handoff chain, history, ECharts, visible-only polling (10s default, adjustable, ETag).
- status --json adds teamWorkspace/teamGoal/decisions.
- No DB migration (schema 14), no protocol change (0.4).

## 0.10.0 (2026-11-10)

### Evaluation (S3c, report only)

- `team.yaml` (G9), line grouping (G13), read-only status API (G11): **not implemented in 0.10.0**; rationale and triggers live in the internal evaluation (EVALUATION-0.10.0-S3c). 0.10.0 is scoped to S3a + S3b.

### Idle hibernation: hibernate / line_wake (S3b)

- New lifecycle value `hibernating` (distinct from `retire`): stops the delivery loop, releases the lease, keeps Session/history; **both inbound delivery and outbound sends return `LINE_HIBERNATING`** (no queuing, no auto-wake).
- New manager-only tools `line_hibernate` / `line_wake`; `line_wake` re-acquires the lease and resumes delivery on the same Session.
- `retired` lines cannot be woken; `rebind`/`replace` require a wake first.
- Rollback to 0.9.0: hibernating lines are treated as non-active (loop skipped); a human must set lifecycle back to `active` (runbook noted).

### Daily token trend (S3a)

- Token sampling: every `tokenSampleMs` (default 60s) each line's cumulative `decodeTokens` is written to `line_events` (action=`token_sample`, detail=JSON); **no DB migration** (reuses the existing table/index).
- `line_metrics.tokens` gains top-level `total` / `today` / `window` / `perDay[]` / `perMessage` / `samples` / `sampleIntervalMs` / `windowDays` / `timezoneOffsetMinutes` / `basis`, and per line `byLine[].decodeTokens` / `today` / `window` / `ratePerMinute` / `samples` (estimate, not billing; session-counter resets count as 0).
- Sampling optimizations: unchanged values write no new sample; `tokenRetentionDays` (default 30) prunes old `token_sample` events hourly.
- Fix: `line_handoff` is no longer crowded out by `token_sample` events (events filter samples; `oldSessionId` uses the latest rebind).
- Docs: AGENTS config/tool tables note `tokenSampleMs`/`tokenRetentionDays` and the token trend fields; basis documented as "session-level sampling, estimated".

## 0.9.0 (2026-11-10)

### Protocol (S2a)

- Envelope gains `protocolVersion` (`0.4`); legacy messages are treated as `0.3` (compatible).
- Version negotiation: different `major` rejected (`LINE_PROTOCOL_MISMATCH`); a newer `minor` ignores unknown fields.
- Messages gain a `protocol_version` column; schema **13 -> 14** (additive, old rows default `0.3`).
- `claim()` does not deliver major-incompatible messages: marks them `failed` with `last_error=LINE_PROTOCOL_MISMATCH` plus an event (queryable, redeliver/purge available).
- Tool outputs expose `protocolVersion` (`line_send` / `line_inbox` / `line_messages`).

### JSON Schema and conformance (S2b)

- `schema/envelope.v0_4.json`: wire envelope JSON Schema (`additionalProperties: true`; `kind`/`ccManager` optional; legacy envelopes without a version field accepted).
- `schema/message.v0_4.json`: **messages table row model** (snake_case, required matches real columns); row ↔ envelope mapping via `lib/protocol.js` `toEnvelope(row)`.
- `conformance/`: language-agnostic cases (**7 groups / 25 cases**: valid, missing fields, invalid address, major mismatch, newer minor with unknown fields, legacy without version, invalid types) plus README.
- `test/conformance.test.js`: in-repo validator running 25 cases; `test/schema-live.test.js`: **real DB rows and toEnvelope output** validated against the schemas (F3 implementation path); `test/snapshot-version.test.js`: team-board / team-board.<line> / team-metrics snapshots carry `protocolVersion`.
- The published package `files` includes `schema/` and `conformance/` so external implementations can self-test.
- Verification-driven fixes: `ccParent`→`ccManager`; malformed `protocol_version` no longer stalls a claim batch; real v13→v14 migration test; conformance gains `g-invalid-types`.

### Capabilities and transport (S2c)

- `lib/capabilities.js`: `probeCapabilities(ctx)` three-state table (true/false/null) plus `requireCapability` (missing `session.create` -> `LINE_CAPABILITY_MISSING` with a hint).
- `line_status` returns `capabilities`; when an **explicit** `workspace` is requested but the registry is missing, `line_create` falls back to cwd and returns `workspaceFallback: registry-unavailable` instead of failing wholesale (without an explicit workspace request, cwd is used silently).
- New `memory` transport (in-memory SQLite): proves the transport seam is swappable and makes tests instant (no pretend second engine).
- Snapshots (team-board/team-metrics) carry `protocolVersion`; consumers ignore unknown fields (F7).

> Next train (protocol hardening) plus the **documentation optimization** folded into it: readable for humans, precise for AI (no behavior change). Docs-only changes are not released on their own (same rule that cancelled 0.7.1).

- README (both languages): add a **Quick Context** block for AI assistants (runtime/storage/entities/hard constraints/zero-config/delivery semantics/entry points); turn "when to use it" into a **decision table** (choose lines / don't, pointing to the official Agent Teams plugin); add an **ASCII directory tree** to the architecture section (parseable by AI, not only Mermaid/screenshots).
- Add root `AGENTS.md`: the machine-facing operation contract (config semantics and defaults, 22 tool contracts and permissions, `line_status` field table, MUST/MUST NOT, hallucination checklist); linked from both READMEs.
- Docs gate gains **C13**: checks `AGENTS.md` against code (tool count/unknown/missing tools, schema version, Node/DSH ranges, config keys, relative links) — changing code without updating AGENTS.md fails the gate.

## 0.8.1 (2026-11-10)

> Packaging self-containment patch: **no behavior change**; it only lets the published package run its own verification gates (DEC-18/19: no new features).

### Non-breaking

- `package.json files` now includes `scripts`: the published package ships `business-smoke.mjs`, `check-docs-consistency.mjs` and `check-bento-alignment.mjs`, so post-release verification needs no copy from the repo.
- Version 0.8.0 → 0.8.1; no code behavior change, no schema change.

### Breaking

- None.

## 0.8.0 (2026-11-10)

> User decision 2026-11-10: no separate 0.7.1; docs fixes are folded into this release; **ship as soon as dev+tests (including business tests) are done, no fixed window**. Release execution is scheduled by the commercialization line and performed by github-maintenance-line.

### Documentation fixes (landed; folded from the former 0.7.1 candidate)

- Fix the 0.6.6 gate wording: the `check-bento-alignment` script exists but in the **lions repository**, not in this package and not part of `npm test` (cross-repository reference); the 0.7.0 GitHub Release notes were corrected too.
- AGENT-TEAMS (both languages): task-tree parent/child relations are projected by the lines layer (`parentTaskRef` → `parentTaskId`); the board field table now lists `parentTaskId`.
- PHILOSOPHY (both languages) glossary: map L1/L2/L3 to manager line / role line / official team (department / department team).
- README (both languages): "UIUX 0.6 bento rules" → "the UIUX line's Bento spec (DESIGN-SPEC §11)".

### Visibility and remediation (S1)

- `message_events` (append-only message-level event stream) + schema **v13** (additive; older DBs get the table automatically).
- `line_messages({ line?, states?, since?, limit? })`: query by state (including `failed`/`expired`) with `counts.byState`; the manager may query any line.
- `line_trace({ messageId })`: full lifecycle timeline (state/time/attempt/actor/error).
- `line_redeliver({ messageId, to?, resetAttempts? })`: manager only, `failed`/`expired` only, may retarget another line of the same agent, writes an audit event.
- `line_purge({ before, states?, dryRun? })`: manager only, `before` required, `dryRun` defaults to true, terminal states only, writes a `purged` event before deleting.
- `ackTimeoutMs` (default 600000): overdue `delivered` messages are flagged and counted (`line_metrics.messages.ackOverdue`), **never auto-redelivered** (preserves I2).
- CLI `doctor`: reports `health { failed, expired, ackOverdue }` plus next-step hints; `tail --line` shows every state.
- New in-package gates: `scripts/check-bento-alignment.mjs` (9 checks) and `scripts/check-docs-consistency.mjs` (11 checks), both wired into `npm test`.
- Crash-injection test `test/crash-injection.test.js`: kill -9 ×100 converges with zero unexplained messages.
- Details: `dsh-agent-lines-internal/DESIGN-0.8.0-S1-2026-11-10.md` and `TRAIN-0.8.0-2026-11-10.md`.

## 0.7.0 (2026-11-10)

This release is a **design-constitution release**: no behavior change.

### Breaking

- None.

### Non-breaking

- Add `docs/PHILOSOPHY.md` / `docs/PHILOSOPHY.en.md`: design philosophy, the pivot (label + sessionId), invariants I1–I7, five tradeoffs, non-goals, evolution rules, glossary.
- Add `docs/KNOWN_ISSUES.md` / `.en`: design boundaries (B1–B8), known gaps (G1–G9, with target versions), known traps (K1–K8), and what to include in a report.
- Add `docs/DELEGATION-POLICY.md` / `.en`: delegation policy v1 for **should the role line do it or open an internal team** (7 dimensions, A/B rules, `subteamPolicy` semantics, standard steps, update loop).
- README/AGENT-TEAMS (both languages) explain the three levels after integration and "who does the work".
- README (both languages) gains a "Design philosophy" section; the docs site nav and footer link to it.
- CHANGELOG now separates breaking and non-breaking changes.

### Corrections to earlier wording

- The read-only board cut **already shipped in 0.6.6** (see the 0.6.6 entry); 0.7.0 no longer declares it again.
- The docs site linked to a `v0.7.0` Release that did not exist; it now points to `releases/latest`.
- README "Limitations" no longer claims "no handover" (handoff / rebind / replace exist since 0.3.6); status version `0.3.x` → `0.7.x`.
- The 0.6.6 entry claimed a "check-bento-alignment gate": the script **does exist**, but in the **lions repository** (`lions/scripts/check-bento-alignment.cjs`), not inside this plugin package and not part of `npm test` (`test/*.test.js`) → for the plugin release it was a **cross-repository reference**, not reproducible. Reworded; shipping an in-package gate wired into `npm test` is now a 0.8.0 item.

## 0.6.6 (2026-11-10)

- Rebuild the web board to the UIUX 0.6 eight-rule bento layout.
- Org tree + overview/tasks/department/communications/metrics views; fixed slots; equal-height rows; inner scrolling; data-level; breadcrumbs.
- The read-only board cut **ships in this version** (0.7.0 does not declare it again).
- Add the browser E2E script `test/uiux-board-e2e.mjs` (standalone, requires playwright, not wired into `npm test`).

## 0.6.5 (2026-11-09)

- Web board adds local manager actions: send message, approve/reject pending, handoff.
- Actions require x-board-token; still localhost-only; read-only without token.
- No hard subteam enforcement; hard limits wait for official API.

## 0.6.4 (2026-11-09)

- Add built-in read-only web board: dsh-agent-lines board.
- Defaults to 127.0.0.1:4090; reads team-board.json / team-board.<line>.json.
- Org/task view and department drawer; no write API; not public by default.

## 0.6.3 (2026-11-09)

- Add line_metrics: manager-only read-only data board.
- Current task/line/team counts; message kind/state and daily trend; per-line current tokens.
- Explicitly no official task timestamps or per-task tokens; no invented trends.

## 0.6.2 (2026-11-09)

- Add line_communications: manager-only read-only communication board; filter by line/task/kind/state.
- Explicitly does not expose official internal sub-agent private messages.
- Read-only; no message state change.

## 0.6.1 (2026-11-09)

- subteamPolicy (auto/ask/never) and maxMembers message fields; schema v12.
- line_team_board tasks expose subteamPolicy/maxMembers.
- line_department_board adds subteamAudit (members/tasks/policies/maxMembers/overLimit).
- Records/shows/audits only; does not block official spawn.

## 0.6.0 (2026-11-09)

- line_department_board: lazily read a line's official team (lead/members/tasks/summary/messages).
- line_team_board lines[] adds officialTeamLead/officialTeamAvailable/deptSummary.
- line_send adds parentTaskRef; schema v10; parentTaskId projection for the task tree.
- Read-only; no merging into the parent task board; no task writes.

## 0.5.1 (2026-11-09)

- line_team_board writes a host snapshot at DSH_HOME/agent-lines/team-board.json (0600, atomic replace).
- Board contract adds messages[], quality[], team, approval detail, deliveries, schemaVersion, epoch-ms generatedAt.
- The manager refreshes it by calling the board; no user export/config.

## 0.5.0 (2026-11-09)

- Add line_team_board: manager-only read-only board that auto-reads ctx.agentTeams.listTasks/listMembers + lines.db.
- Auto maps teammate name/role to lines; unlinked when missing; no user export/config.
- available=false when Agent Teams is unavailable or the manager is not a member.
- line_send adds taskRef, linking messages to Agent Teams tasks; schema v9 additive.
- Read-only; no task/message writes; no manager turn.
- Docs: docs/en/AGENT-TEAMS.md + static board example.

## 0.4.1 (2026-11-09)

- Fix F1: after line_create replace / line_rebind, the new line did not re-acquire a lease, leaving it offline and messages queued until restart.
- Regression test: the replaced line must have a live lease.
- No schema change; 0.4.0 kinds/approval/docs/landing unchanged.

## 0.4.0 (2026-11-09)

- Message governance: line_send adds kind (info/request/task/alert) and ccManager; a non-manager task becomes pending_approval and is delivered only after line_manager_ack.
- Schema v8: messages.kind/cc_manager/approval_state/approved_by/approved_at; additive migration.
- Added line_manager_ack (approve/reject).
- line_observe shows kind/ccManager/approvalState; pending tasks do not enter the target inbox.
- README is team-agnostic; GitHub Pages is rewritten for beginners (DSH-assisted install, novel/video/dev scenarios, restart handoff card).

## 0.3.9 (2026-11-09)

- Added read-only line_observe: a manager feed of cross-line messages without prompts or state changes.
- Added CLI observe --json.
- README now documents version-by-version business scenarios; fixed line_handoff version (0.3.7).
- No schema change; line_send semantics unchanged.

## 0.3.8 (2026-11-09)

- line_status / line_list expose activity: turns/steps/decodeTokens/level/lastActivityAt.
- activityLevel is an activity proxy, not a context-window percentage; DSH does not expose context usage.
- Remains compatible with the 0.3.6/0.3.7 lifecycle/title work.
- Tests 35/35 pass.

## 0.3.7 (2026-11-09)

- Added line_handoff: structured handoff snapshots (JSON/Markdown), no model call.
- line_status / line_list now expose lifecycle/title/generation/pending/lastActivityAt/oldSessionId.
- rebind sends a noReply handoff notice to the new line; replace reuses the onboarding message.
- list --json can feed an external dashboard; added examples/dashboard notes.
- Tests 33/33 pass.

## 0.3.6 (2026-11-09)

- Added line lifecycle: line_retire, line_rebind, line_create replace:true, line_rename.
- Schema v7: lines.title/lifecycle/generation/rebind_at/rebind_from + line_events audit; additive migration from v6.
- Backlog migration: queued/claimed migrate; delivered/acked are never re-delivered; migrate:none fails closed when backlog is non-empty.
- Persistent titles: line_create/line_rename write lines.title and survive restarts.
- Tests 32/32 pass; existing 0.3.5 behavior unchanged.

## 0.3.5 (2026-11-05)

- Integrated P0/P1 bootstrap: line_create queues an onboarding message by default, adds bootstrapOnCreate, and line_status/line_list expose materialized / visibleInSidebar / bootstrapQueued.
- Kept the 0.3.4 docs and wording; README bootstrap notes were added manually on top of 0.3.4, not overwritten from the older local tree.
- No schema change; remains v6.

## 0.3.4 (2026-11-05)

- Removed the conflicting suggestion that one-off subtasks should use subagent / Agent Teams.
- The plugin is positioned for long-running, multi-role teams that need durable messages; one-off subtasks are left to the user's DSH-native choice.
- Synced the npm package and Release artifact; no runtime behavior change; schema remains v6.

## 0.3.3 (2026-11-04)

- Scenario-first landing page: hero, three cards, four-step real usage, first-use claim prompt, restart note.
- Landing page and social-preview are now included in the npm package and GitHub Release artifact.
- No runtime behavior change; schema remains v6.

## 0.3.2 (2026-11-04)

- Zero-config bootstrap: with no plugin config, start one unbound manager line; a root Session can call line_claim_manager to bind itself.
- Default DB path follows DSH_HOME; without it, still ~/.dsh/agent-lines/lines.db.
- README now requires a DSH Web restart after install/update; explicit manager/worker config is optional.
- No schema change; remains v6.

## 0.3.1 (2026-11-04)

- README is now user-first: scenarios and install come first; technical details are later.
- Added install.sh, which picks the DSH Web profile automatically and verifies agent-lines.
- The npm 0.3.1 package now carries the same bilingual README and install docs as the public repo.
- No runtime behavior change; schema remains v6.

## 0.3.0 (2026-11-04)

- Transport seam (`transport: sqlite` default).
- `line_create` resolves the manager workspace and passes `workspaceId`, so created lines are attached to the workspace instead of "Ungrouped"; optional `workspace` argument for an existing workspace.
- `line_move_workspace` attaches an existing line Session to a workspace whose path matches its cwd.
- Echo guards: self-send disabled by default, 5s default dedupe window, `maxReplyDepth` (default 8), `noReply` messages, and hop/root metadata.

- Read-only `line_status` visible to every Session, including unbound ones.
- `dsh-agent-lines claim --line manager --session <id>`: writes a durable claim request; the running plugin rebinds the manager line without a restart.
- `manager_bindings` persistence: the claimed manager Session survives a restart even when the profile config still names an older Session.
- Startup validates configured Sessions via `sessionPersistence.stat`; missing Sessions stay unbound instead of appearing online.
- `line_claim_manager` global tool: a live root Session can bind itself with `confirm: "bind-manager"`; CLI claim remains the fallback.
- `allowClaim` config gates claim polling (default false).
- Schema v6: `claim_requests`, `manager_bindings`, and message `hop`/`no_reply`/`root_message_id`.

## 0.2.0 (2026-11-04)

- Multi-line support in one DSH process: `lines[]` config, Session→line mapping, per-line delivery loops and per-agent prompt sections.
- `line_create` for the configured manager line (`allowCreate`, `createFrom`): creates an ordinary DSH Session in the manager's cwd and registers it as a line.
- Idempotent creation by label (`created:false`) and `maxLines` bound (default 16).
- `role` and `created_by` columns with automatic migration; managers restore their created lines on startup.
- Legacy single-line config (`line`/`sessionId`) remains supported.
- Line tools are scoped to bound Sessions; unbound chats no longer see them.
- Process-exit lease release reduces `LINE_LEASE_HELD` after a fast restart.

## 0.1.0 (2026-11-04)

- First MVP: local SQLite line registry and durable message queue.
- Owner-process delivery through `ctx.sessionController.prompt` with `requestId` idempotency.
- Leases, heartbeats, stale-claim recovery, exponential retry, TTL.
- Tools: `line_list`, `line_send`, `line_inbox`, `line_ack`.
- CLI: `list`, `send`, `inbox`, `ack`, `doctor`, `tail`.
- Explicit `delivered` vs `acked`; at-least-once with effectively-once Session log semantics.
- Local filesystem check (NFS/CIFS/SMB/FUSE refused).

Not included: HTTP transport, Web UI, Postgres adapter, automatic process wake.