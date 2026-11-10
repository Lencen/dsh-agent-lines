# Team workspace convention (v0)

> Purpose: let the board (and future tools) read team structure and role cards from the workspace, **read-only**.
> Boundary: this convention does **not** redefine charter content; existing charters (e.g. 104 line-center `charters/*.md`) are sufficient. It only adds the minimum machine-readable fields.

## 1. Directory layout

```text
<teamRoot>/
├── README.md                 # org description / line table (optional, human)
├── registry.json             # registry: label -> charter/receipt (board uses it for discovery only)
├── charters/<label>.md       # role card / charter (human-written body)
├── workspaces/<label>/registration-receipt.md   # optional
└── protocols/ retros/ announcements/ reports/ summaries/   # optional
```

## 2. Charter (role card) template (v0)

```markdown
# <Role name> (<label>) charter

> Owner: <team> · label: <label> · Manager: <manager label> · Version: v1.0 · Updated: YYYY-MM-DD

## 1. Positioning
## 2. Responsibilities
### 2b. Manager charter

The manager is also a line (label from createFrom, default manager) and needs a role card too:

```markdown
# Team manager (manager) charter

> Team: <team> · label: manager · reports to: user · version: v1.0 · updated: YYYY-MM-DD

## 1. Positioning
Only demand intake, task breakdown, dispatch, and coordination; does not execute tasks directly.
## 2. Responsibilities
1) Receive demand and confirm goals/priority; 2) break down and assign tasks; 3) schedule cross-line dependencies; 4) track progress, escalations, acceptance.
### 2d. decisions status (optional, 0.11.0-23+)

A `decisions/<id>.md` file may include an optional section:

```markdown
## 状态
已采纳
```

- Missing = pending; the board's "needs decision" card lists pending items only;
- If status or title says 已采纳 / 已执行 / 已处理 / 已完成, the board does not count it as pending (shows "processed N" instead);
- Do not put initialization audit notes under `decisions/` (that folder is user-facing decision cards); use `TEAM.md`/README.

### 2e. Collaboration flow (optional, 0.11.0-27+)

`TEAM.md` may include a section rendered as chips on the board's org view:

```markdown
## 协作流程
设定 → 大纲 → 初稿 → 编辑 → 校对 → 审读 → 发布
```

- Use `→`, `、`, commas, or one item per line; the board splits them into chips.
- Missing → "not collected" (no fixed demo workflow anymore).

### 2c. TEAM.md (team goal) is maintained by the manager

Team goal / summary / plan / cadence come from teamRoot/TEAM.md. They are not hand-written by the user: the manager extracts them from conversations and writes/updates the file.

The file is Markdown with four H2 sections: team goal, summary, plan, cadence; optionally one line “updated: YYYY-MM-DD · source: user session”.

- Manager responsibilities: extract the four items, update TEAM.md, record changes when goals change;
- The board/plugin is read-only for TEAM.md; missing fields show “no overall goal / no summary / no plan / no cadence”, never invented;
- The plugin does not auto-create/write this file (workspace is read-only by convention); “generate template on team creation” would need a new tool, out of 0.11 scope.

## 3. Standard outputs
Task tickets, assignment records, acceptance notes, escalation/decision records.
## 4. Boundaries
Does not execute tasks or replace member output.
## 5. Quality requirements
Acceptance and risk escalation; traceable task origin and decisions.
## 6. Interfaces
Upstream: user; downstream: role lines.
## 7. Dispatch and reporting
Priority-based assignment; escalate blockers to the user.
```

- Location: <teamRoot>/charters/manager.md (or the registry path);
- Missing: board shows not collected · manager charter missing; never invents content;
- The manager line still cannot be retired/hibernated/rebound; identity fixed by createFrom.

## 3. Standard outputs
## 4. Boundaries (what not to do)
## 5. Quality requirements
## 6. Collaboration interfaces
## 7. Dispatch and reporting rules
```

Minimum additions (relative to existing charters; add only, no rewrite):

1. Header line adds **`label`** and **`Updated`** (the board uses them for binding and the source line); if missing, fall back to registry mapping and file mtime.
2. **Keep the seven section titles above exactly** (the board maps by title; unchanged titles need no body rewrite).
3. Each `registry.json` entry needs at least `id/label`, `name`, `charter` path; other fields are not displayed as role definitions.

## 3. How the board reads it (mapping and source)

| Board block | Source | When missing |
|---|---|---|
| Identity: name / label / status / manager | charter header + lines table | fall back to lines.role/title and mark `not collected` |
| Profile: role definition / work definition / requirements / constraints | charter §1 / §2 / §3+§5 / §4 | section missing -> `not collected + reason` |
| Current: task count / last active | official task projection + line_events | show `unavailable` badge |
| History: timeline | line_events + registration receipt | empty-state explanation |

Source line always shows: `Source: charters/<label>.md · Updated <date>` (header `Updated`, else file mtime).

## 4. registry.json (discovery only)

- The board uses it only for **label -> charter file** discovery; **registry fields are not shown as the role definition**, so there is one source of truth (the charter body);
- Recommended fields: `version`, `lines[{ id/label, name, role, charter, receipt? }]`; other fields (sessionId/agentId, etc.) are not displayed.

## 5. Missing and read-only rules

- Three missing cases are never faked: **file missing / section missing / read failure** -> one `not collected + reason` grey badge;
- The board is **read-only**: no edit or edit-jump entry, at most a file-path text; it never writes `charters/` or `registry.json`;
- Charters are created and maintained by the manager agent; neither the plugin nor the board rewrites them.

## 5b. Team-level info (optional)

Optional: team-level info (goals / collaboration flow) comes from two optional sections in `<teamRoot>/README.md`: `## Goals` and `## Collaboration flow`; when missing, the board marks it "not collected" instead of inventing it.

## 6. Relationship to existing charters (no redefinition)

- Existing 104 line-center charter bodies (positioning / responsibilities / outputs / boundaries / quality / collaboration / dispatch) are **content-sufficient**;
- This convention adds only three small things: header `label` + `Updated`, fixed section titles, and the registry `charter` path;
- Old charters keep working without changes: the board maps via registry + title matching and marks `not collected` for gaps, with no migration.
