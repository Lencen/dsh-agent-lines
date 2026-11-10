# AI 使用手册（面向 agent，0.11.0+）

> 第一次使用本插件时，**先读这一页，不要扫代码/试错**。完整契约见 [AGENTS.md](../AGENTS.md)；本页只给最短路径、看板说明与常见错误。

## 0. 30 秒判断

1. **我是 manager 线吗**：`line_status` 的 `current.line` 是否等于 `createFrom`；未绑定先 `line_claim_manager({confirm:"bind-manager"})`。
2. **配了 teamRoot 吗**：没有就先配（工作区父目录，绝对路径）；否则看板只显示「未采集」。
3. **是接手/换人吗**：先 `line_handoff` 生成交接快照，再动线。

## 1. 五步建团队（一次成功的顺序）

1. 确认绑定：`line_status`（未绑定则 `line_claim_manager`）。
2. 配置 `teamRoot`（工作区父目录，绝对路径；配置见 [DEPLOY.md](DEPLOY.md)）。
3. 建线：`line_create({label, role})`，一条线一个 label（如 dev/test/uiux/release）；多条线用批量式 `line_create({lines:[{label,role},…]})` 一次调用完成（0.11.0-24 起），返回 `{created,skipped,failed,counts}`。建线后插件会发 onboarding 并等待会话可见（`visibleInSidebar:true`），团队立刻出现在 DSH 侧栏。
4. 初始化团队工作区（**只调一次**）：
   `line_init_team({ teamName: "<团队名>" })`
   - 在 `<teamRoot>/<团队名>/` 生成 `TEAM.md`、`charters/*.md`、`decisions/README.md`、`registry.json`；
   - **必须给 teamName**（只配了 teamRoot 时也不要把工作区根当团队根，会报 `LINE_TEAM_NAME_REQUIRED`）；
   - 已存在默认跳过，`overwrite:true` 才覆盖；
   - **参数只给一种**：最终团队目录 `teamRoot`，或 `teamName`（配合配置 `teamRoot`）；两者同时给时 `teamRoot` 当父目录、`teamName` 当子目录（0.11.0-23 起）。不要"先生成到父目录再 mv"，那会触发覆盖写前的 read 校验错误链；
   - `decisions/` 只放**待决策**事项；初始化留痕写 `TEAM.md`/README，已处理的决策在 md 里加 `## 状态` + `已采纳`（看板不再当作待决策）。
5. 写目标并派单：
   - `<teamRoot>/<团队名>/TEAM.md` 四节：团队目标 / 简介 / 规划 / 计划节奏（manager 从对话提炼后更新）；可选第五节「协作流程」（如「设定 → 大纲 → 初稿 → 编辑 → 校对 → 发布」）供看板组织页渲染；
   - `charters/<label>.md` 四节：定位 / 职责 / 标准产出 / 边界（缺节看板显示「未采集」或「缺小节」）；
   - `line_send({to, text, kind:"task", taskRef:"<任务名>"})`；跟踪用 `line_team_board` / `line_department_board`。

## 1b. 建团队可见性与 token（0.11.0-28+）

- **新线必须能在 DSH Web 侧栏看到**：插件默认发 onboarding 并唤醒该线跑首轮，`line_create` 会等到会话 `blank=false` 后再返回（结果含 `visibleInSidebar`）。
- **逐次传 `bootstrap:false` 已被忽略**；只有部署级配置 `bootstrapOnCreate:false` 才会让新线保持 blank（侧栏不可见，仅用于明确不要可见的部署）。
- 可见性优先于 token：每条线首轮会多花一些 token，这是换"建完立刻可见"的代价。**不要再靠隐藏线省 token**。
- 要省 token 请用：批量建线 `line_create({lines:[…]})`、建团队只调一次 `line_status`、阶段内不调 `line_metrics`/`line_team_board`、不读源码、机械流程用低 reasoning/便宜模型。
- **token 口径（0.11.0-25+）**：`line_metrics` 同时给 `decodeTokens/outputTokens`（仅生成）与 **`totalTokens`（未缓存输入 + 输出 + 缓存读写）**，看板成本默认按 `totalTokens` 统计；DSH 会话统计就是 totalTokens 口径。
- 顺序建议：`line_create`（批量）→ `line_init_team` → 写 TEAM.md/charters → 按需给线发任务。

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
