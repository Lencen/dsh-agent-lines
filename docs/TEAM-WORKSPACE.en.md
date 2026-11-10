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

## 6. Relationship to existing charters (no redefinition)

- Existing 104 line-center charter bodies (positioning / responsibilities / outputs / boundaries / quality / collaboration / dispatch) are **content-sufficient**;
- This convention adds only three small things: header `label` + `Updated`, fixed section titles, and the registry `charter` path;
- Old charters keep working without changes: the board maps via registry + title matching and marks `not collected` for gaps, with no migration.
