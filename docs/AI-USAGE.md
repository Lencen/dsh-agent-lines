# AI 使用手册（面向 agent，0.11.0+）

> 第一次使用本插件时，**先读这一页，不要扫代码/试错**。完整契约见 [AGENTS.md](../AGENTS.md)；本页只给最短路径、看板说明与常见错误。

## 0. 30 秒判断

1. **我是 manager 线吗**：`line_status` 的 `current.line` 是否等于 `createFrom`；未绑定先 `line_claim_manager({confirm:"bind-manager"})`。
2. **配了 teamRoot 吗**：没有就先配（工作区父目录，绝对路径）；否则看板只显示「未采集」。
3. **是接手/换人吗**：先 `line_handoff` 生成交接快照，再动线。

## 1. 五步建团队（一次成功的顺序）

1. 确认绑定：`line_status`（未绑定则 `line_claim_manager`）。
2. 配置 `teamRoot`（工作区父目录，绝对路径；配置见 [DEPLOY.md](DEPLOY.md)）。
3. 建线：`line_create({label, role})`，一条线一个 label（如 dev/test/uiux/release）；多条线用批量式 `line_create({lines:[{label,role},…], bootstrap:false})` 一次调用完成（0.11.0-24 起），返回 `{created,skipped,failed,counts}`。
4. 初始化团队工作区（**只调一次**）：
   `line_init_team({ teamName: "<团队名>" })`
   - 在 `<teamRoot>/<团队名>/` 生成 `TEAM.md`、`charters/*.md`、`decisions/README.md`、`registry.json`；
   - **必须给 teamName**（只配了 teamRoot 时也不要把工作区根当团队根，会报 `LINE_TEAM_NAME_REQUIRED`）；
   - 已存在默认跳过，`overwrite:true` 才覆盖；
   - **参数只给一种**：最终团队目录 `teamRoot`，或 `teamName`（配合配置 `teamRoot`）；两者同时给时 `teamRoot` 当父目录、`teamName` 当子目录（0.11.0-23 起）。不要"先生成到父目录再 mv"，那会触发覆盖写前的 read 校验错误链；
   - `decisions/` 只放**待决策**事项；初始化留痕写 `TEAM.md`/README，已处理的决策在 md 里加 `## 状态` + `已采纳`（看板不再当作待决策）。
5. 写目标并派单：
   - `<teamRoot>/<团队名>/TEAM.md` 四节：团队目标 / 简介 / 规划 / 计划节奏（manager 从对话提炼后更新）；
   - `charters/<label>.md` 四节：定位 / 职责 / 标准产出 / 边界（缺节看板显示「未采集」或「缺小节」）；
   - `line_send({to, text, kind:"task", taskRef:"<任务名>"})`；跟踪用 `line_team_board` / `line_department_board`。

## 1b. 低 token 建团队（实测）

- **建线时传 `bootstrap:false`**（或配置 `bootstrapOnCreate:false`）：默认会给每条新线发 onboarding 并**唤醒该线 agent 跑一个回合**；实测 8 条线约多花 6.5 万 tokens。关掉后新线保持安静，等第一条任务再唤醒。
- 建团队全程**只调一次** `line_status`；不要在建团队阶段调 `line_metrics` / `line_team_board` / `line_messages`（输出大、不参与建团队）。
- 机械建团队可用低 reasoning / 便宜模型（配置层 `agent-default-model`），完成后再切回；
- 批量建线：`line_create({lines:[…]})` 一次调用替代 N 次单建，少 N-1 个模型步（每步都要重发上下文，是总 token 的大头）；
- **token 口径**：看板/line_metrics 的 `decodeTokens` 只是**生成 token（output）** 的近似；DSH 统计的总 token 含输入与缓存读取，实测可达它的 30–80 倍（如 5.9M vs 71k）。真实花销以 DSH 统计为准，别拿 130k 当总成本。
- 顺序建议：先 `line_create`（`bootstrap:false`）→ `line_init_team` → 写 TEAM.md/charters → 只给要开工的线下第一条任务（唤醒本身就是 token 开销）。

## 2. 看板（只读，主要给用户看）

```bash
dsh-agent-lines board --db <lines.db> --dir <快照目录> --team-root <teamRoot>/<团队名> --host 127.0.0.1 --port 4090
# 浏览器打开 http://127.0.0.1:4090/
```

- 五个视图：总览 / 组织（线框、树视图、搜索、历史线）/ 任务 / 数据（ECharts）/ 消耗；右侧停靠详情，支持深浅色与窄屏。
- **顶栏与页脚显示插件版本**（来自 `/api/health.version`）；升级后硬刷新（Ctrl+F5）应与安装包版本一致。
- 数据来源：`lines.db`（线/消息）、官方任务与成员投影（只读）、teamRoot（TEAM.md/charters/decisions）、`team-metrics.json`（token 估算，非账单）。
- 缺失一律显示「暂无 / 不可得 / 未采集」，**不编造**；任务视图为空 = 官方任务投影为空，不是故障。
- 自动刷新只在页面可见时轮询（默认 10s，可调）；`/api/live` 支持 ETag。
- agent 不通过看板操作；机器可读状态用 `dsh-agent-lines --db <db> --json status`（0.11.0+，含 `teamWorkspace`/`teamGoal`/`decisions` 摘要）。

## 3. 常用工具

| 目的 | 工具 |
|---|---|
| 建线 / 发任务 / 收消息 / 确认 | line_create / line_send / line_inbox / line_ack |
| 管理 | line_list / line_status / line_messages / line_trace |
| 交接 / 退线 / 休眠 / 唤醒 | line_handoff / line_retire / line_hibernate / line_wake |
| 角色 / 团队初始化 | line_set_role / line_init_team |
| 数据 / 看板 | line_metrics / line_team_board / line_department_board |

## 4. 关键规则（避免返工）

- 只有 `createFrom`（通常 manager）能建线/初始化团队/改角色/重投；
- 团队工作区由插件只读读取，**不要手写 JSON 或散文件骗看板**；缺字段会显示「暂无/不可得」；
- 团队名 = 团队根目录名；业务目标写 `TEAM.md`，两者可不同；
- 官方 Agent Teams 投影只读，不可写回；
- 失败消息用 `line_messages({states:["failed"]})` + `line_redeliver`；**不要**自动重投已投递消息（破坏 I2）；
- 休眠线（`hibernating`）收发都返回 `LINE_HIBERNATING`，需 `line_wake`；`retired` 不可唤醒；
- 一个 DSH 进程内不要同时打开线的 Session（`session/writer-held`）；不支持跨机/多活（`LINE_NETWORK_FILESYSTEM`）。

## 5. 常见错误 → 下一步

| 现象 / 错误码 | 下一步 |
|---|---|
| `LINE_TEAM_ROOT_REQUIRED` | 先配置 `teamRoot` |
| `LINE_TEAM_NAME_REQUIRED` | `line_init_team` 传 `teamName`（不要平铺到工作区根） |
| `LINE_HIBERNATING` | `line_wake` 后再收发 |
| `LINE_NETWORK_FILESYSTEM` | 换本地盘（不支持 NFS/CIFS/SMB/FUSE） |
| `session/writer-held` | 关掉另一个 DSH 里该线的 Session 视图 |
| 看板组织详情「未采集」 | 检查 `teamRoot` 与 `charters/<label>.md` 四节是否齐全 |
| 看板版本与安装包不一致 | 重装后重启 board，再硬刷新 |
| 看板任务为空 | 官方任务投影为空；先 `line_send(kind:"task")` |

## 6. 一次验收清单

- [ ] `line_status`：`current.bound=true`，manager 正确；
- [ ] `teamRoot` 已配置且为绝对路径；
- [ ] `line_init_team` 生成 `TEAM.md/charters/decisions/registry.json`；
- [ ] 每条线 `charters/<label>.md` 四节齐全；
- [ ] 看板能打开：团队名/目标真实、组织 9 条线（含 manager）、版本号正确；
- [ ] 无任务时显示「暂无任务（官方任务投影为空）」，不显示假任务；
- [ ] 交接用 `line_handoff`，退线用 `line_retire`（不要删 Session）。

## 7. 第一次不要做

- 不要遍历仓库源码找用法（本页已给）；
- 不要试探性调用所有工具；
- 不要自己创建 teamRoot 下的散文件，用 `line_init_team`；
- 不要删除线的 Session（消息会永久投递失败），用 `line_retire`。

## 8. 更多文档

| 文档 | 用途 |
|---|---|
| [AGENTS.md](../AGENTS.md) | 机器可读契约（工具/配置/硬约束） |
| [PROTOCOL.md](PROTOCOL.md) | 消息状态机与错误码 |
| [TEAM-WORKSPACE.md](TEAM-WORKSPACE.md) | 团队工作区目录与章程模板 |
| [AGENT-TEAMS.md](AGENT-TEAMS.md) | 官方 Agent Teams 只读融合 |
| [DEPLOY.md](DEPLOY.md) | 部署、配置、writer 冲突 |
| [PHILOSOPHY.md](PHILOSOPHY.md) | 设计思想与不变量 I1–I7 |
