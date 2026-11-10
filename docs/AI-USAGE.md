# AI 使用手册（面向 agent，0.11.0+）

> 第一次使用本插件时，**先读这一页，不要扫代码/试错**。完整契约见 AGENTS.md；本页只给最短路径。

## 1. 最短建团队流程（推荐顺序）

1. 确认自己是 manager 线（`line_status` 的 current.line === createFrom；若未绑定，`line_claim_manager({confirm:"bind-manager"})`）。
2. 配置 `teamRoot`（工作区父目录，绝对路径）。
3. 建线：`line_create({label, role})`，每条线一个 label（如 dev/test/uiux/release）。
4. 初始化团队工作区（**只调用一次**）：
   `line_init_team({ teamName: "<团队名>" })`
   - 会在 `<teamRoot>/<团队名>/` 生成 `TEAM.md`、`charters/*.md`、`decisions/README.md`、`registry.json`；
   - 团队名 = 该根目录名；`TEAM.md` 的业务目标由 manager 从对话提炼后更新；
   - 已存在默认跳过，`overwrite:true` 才覆盖。
5. 派单：`line_send({to, text, kind:"task", taskRef:"<任务名>"})`；跟踪用 `line_team_board` / `line_department_board` 读官方投影。
6. 看板：`dsh-agent-lines board --db <lines.db> --dir <快照目录> --team-root <teamRoot>/<团队名> --port 4090`，浏览器打开。

## 2. 常用工具一览

| 目的 | 工具 |
|---|---|
| 建线/发任务/收消息 | line_create / line_send / line_inbox / line_ack |
| 管理 | line_list / line_status / line_messages / line_trace |
| 交接/退线/休眠 | line_handoff / line_retire / line_hibernate / line_wake |
| 角色/团队初始化 | line_set_role / line_init_team |
| 数据/看板 | line_metrics / line_team_board / line_department_board |

## 3. 关键规则（避免返工）

- 只有 `createFrom`（通常 manager）能建线/初始化团队/改角色；
- 团队工作区只读由插件读取，**不要手写 JSON 骗看板**；缺字段会显示"暂无/不可得"；
- 团队名 = 团队根目录名；业务目标写 `TEAM.md`，两者可不同；
- 官方 Agent Teams 投影只读，不可写；
- 失败消息用 `line_messages({states:["failed"]})` + `line_redeliver`，不要自动重投已投递消息。

## 4. 第一次用不要做

- 不要遍历仓库源码找用法（本页已给）；
- 不要试探性调用所有工具；
- 不要自己创建 teamRoot 下的散文件，用 `line_init_team`。
