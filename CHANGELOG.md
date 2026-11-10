# 更新记录

[English](CHANGELOG.en.md) | 中文

## 0.8.0 (未发布)

> 下一车。用户 2026-11-10 决定：**不单独发 0.7.1**，文档修正并入本版。发布由商业线排期、github-maintenance-line 执行（见 RELEASE-HANDOFF-2026-11-10）。

### 文档修正（已落地，原 0.7.1 候选并入）

- 修正 0.6.6 门禁措辞：`check-bento-alignment` 脚本存在但在 **lions 仓库**，不在插件包内、不属 `npm test`（跨仓库误引）；0.7.0 的 GitHub Release 说明已同步更正。
- AGENT-TEAMS（中/英）：补"任务树父子关系由 lines 层投影（`parentTaskRef` → `parentTaskId`），官方任务板不提供该字段"；字段表补 `parentTaskId`。
- PHILOSOPHY（中/英）术语表：补 L1/L2/L3 与管理线/角色线/官方团队（部门/部门团队）的对应关系。
- README（中/英）：Bento 规范措辞改为"UIUX 线的 Bento 规范（DESIGN-SPEC §11）"。

### 可见性与处置（S1，开发中）

- `line_messages`（按状态查，含 failed/expired）、`line_trace` + `message_events`（消息级事件流）、`line_redeliver`、`line_purge`（before 必填、dryRun 默认 true）。
- `ackTimeout` 只标记 + 报数，不自动重投（守 I2）。
- `doctor` 输出 failed/expired/stale 三类计数；插件包内 bento 门禁脚本并接入 `npm test`。
- 崩溃注入测试矩阵（kill -9 ×100 收敛）。
- 详见 `dsh-agent-lines-internal/DESIGN-0.8.0-S1-2026-11-10.md` 与 `TRAIN-0.8.0-2026-11-10.md`。

## 0.7.0 (2026-11-10)

本版是**文档立宪版**：无代码行为变更。

### 破坏性

- 无。

### 非破坏性

- 新增 `docs/PHILOSOPHY.md` / `docs/PHILOSOPHY.en.md`：设计思想、支点（label + sessionId）、不变量 I1–I7、五条取舍、Non-goals、演进规则、术语表。
- 新增 `docs/KNOWN_ISSUES.md` / `.en`：设计边界（B1–B8）、已知缺口（G1–G9，带计划版本）、已知坑（K1–K8）、报告问题所需信息。
- 新增 `docs/DELEGATION-POLICY.md` / `.en`：**二级线自己做还是开线内团队**的委派策略 v1（7 维判定、A/B 规则、`subteamPolicy` 三档语义、标准动作、持续更新机制）。
- README/AGENT-TEAMS（中/英）补"融合后的三级组织"与"谁干活"说明。
- README（中/英）新增「设计思想」摘要节；文档站导航与页脚加入口。
- CHANGELOG 起分「破坏性 / 非破坏性」两栏。

### 更正（此前文档措辞）

- 看板只读裁剪**实际已在 0.6.6 发布**（见 0.6.6 条目），0.7.0 不再重复声明该 breaking。
- 文档站此前链接到尚不存在的 `v0.7.0` Release，改为 `releases/latest`。
- README「限制」段删除过期的「不做交接」（0.3.6 起已有 handoff / rebind / replace）；状态版本号 `0.3.x` → `0.7.x`。
- 0.6.6 条目原写「check-bento-alignment 门禁」：该脚本**确实存在**，但位于 **lions 仓库**（`lions/scripts/check-bento-alignment.cjs`），不在本插件包内、也不属于 `npm test`（`test/*.test.js`）的范畴 → 对插件发布属**跨仓库误引**、无法在插件侧复跑；已改为如实描述，补一个**插件包内**的门禁并接进 `npm test` 列入 0.8.0。

## 0.6.6 (2026-11-10)

- Web 看板按 UIUX 0.6 的 8 条 bento 规则重做。
- 组织树 + 总览/任务/部门/沟通/数据视图；固定四槽；同行等高；卡内滚动；data-level；面包屑。
- 看板只读：移除看板侧操作与消息视图；不提供 board 操作 API。
- 看板只读裁剪**在本版落地**（后续 0.7.0 不再重复声明该破坏性变更）。
- 新增浏览器 E2E 脚本 `test/uiux-board-e2e.mjs`（独立脚本，需 playwright，未接入 `npm test`）。

## 0.6.5 (2026-11-09)

- Web 看板增加负责人本地操作：发消息、批准/拒绝 pending、handoff。
- 操作需 x-board-token；默认仍只绑 127.0.0.1；无 token 时只读。
- 不做建队策略硬拦截；硬限制仍等官方 API。

## 0.6.4 (2026-11-09)

- 新增内置只读 Web 看板：dsh-agent-lines board。
- 默认 127.0.0.1:4090，读取 team-board.json / team-board.<line>.json。
- 组织树/任务/部门抽屉；无写接口；不自动公网。

## 0.6.3 (2026-11-09)

- 新增 line_metrics：负责人只读数据看板。
- 任务/线/子团队当前统计；消息 kind/state 与按日趋势；每线 token 当前值。
- 明确官方任务无时间字段、无每任务 token，不伪造趋势。

## 0.6.2 (2026-11-09)

- 新增 line_communications：负责人只读沟通看板；按线/任务/kind/state 筛选。
- 明确不暴露官方团队内部子 agent 私聊。
- 只读，不改消息状态。

## 0.6.1 (2026-11-09)

- subteamPolicy（auto/ask/never）与 maxMembers 消息字段；schema v12。
- line_team_board 任务显示 subteamPolicy/maxMembers。
- line_department_board 增加 subteamAudit（members/tasks/policies/maxMembers/overLimit）。
- 只记录/展示/审计，不拦截官方 spawn。

## 0.6.0 (2026-11-09)

- line_department_board：按角色线懒取该线官方团队（负责人/成员/任务/摘要/消息）。
- line_team_board lines[] 增加 officialTeamLead/officialTeamAvailable/deptSummary。
- line_send 增加 parentTaskRef；schema v10；任务树 parentTaskId 投影。
- 只读；不合并上级任务板；不写任务。

## 0.5.1 (2026-11-09)

- line_team_board 自动写主机快照 DSH_HOME/agent-lines/team-board.json（0600，原子替换）。
- 看板契约补齐：messages[]、quality[]、team、approval 详情、deliveries、schemaVersion、generatedAt epoch ms。
- 负责人调用看板即刷新；用户不需要导出/配置。

## 0.5.0 (2026-11-09)

- 新增 line_team_board：管理线只读看板，自动读 ctx.agentTeams.listTasks/listMembers + lines.db。
- 按 teammate name/role 自动映射 line；无映射 unlinked；不要求用户导出/配置。
- Agent Teams 服务不可用或 manager 非成员时 available=false。
- line_send 新增 taskRef，消息可自动挂到 Agent Teams 任务；schema v9 additive。
- 只读；不写任务/消息，不触发管理线 turn。
- 文档：docs/AGENT-TEAMS.md + 静态看板示例。

## 0.4.1 (2026-11-09)

- 修复 F1：line_create replace / line_rebind 在 rebind 后没有重新 acquire lease，导致线 offline、消息 queued 直到进程重启。
- 回归测试：replace 后新 Session 必须有 live lease。
- 无 schema 变化；0.4.0 的 kind/审批/文档/官网不变。

## 0.4.0 (2026-11-09)

- 消息治理：line_send 新增 kind（info/request/task/alert）、ccManager；非管理线发 task 进入 pending_approval，需 line_manager_ack 审批后才投递。
- schema v8：messages.kind/cc_manager/approval_state/approved_by/approved_at；additive 迁移。
- 新增 line_manager_ack（approve/reject）。
- line_observe 展示 kind/ccManager/approvalState；待审批任务不进目标线 inbox。
- README 团队类型通用化；GitHub Pages 面向小白改版（安装交给 DSH、小说/视频/开发场景、重启前交接卡）。

## 0.3.9 (2026-11-09)

- 新增只读 line_observe：管理线查看跨线消息 feed，不注入 prompt、不改消息状态。
- CLI 新增 observe --json。
- README 补“版本能力与业务场景”，修正 line_handoff 的版本标注（0.3.7）。
- 无 schema 变化，line_send 语义不变。

## 0.3.8 (2026-11-09)

- line_status / line_list 增加 activity：turns/steps/decodeTokens/level/lastActivityAt。
- 明确 activityLevel 只是活跃度代理，不是 contextUsage 百分比；DSH 未暴露上下文窗口。
- 生命周期/标题/在飞版本保持 0.3.6/0.3.7 兼容。
- 测试 35/35 通过。

## 0.3.7 (2026-11-09)

- 新增 line_handoff：结构化交接快照（JSON/Markdown），不调用模型。
- line_status / line_list 增加 lifecycle/title/generation/pending/lastActivityAt/oldSessionId。
- rebind 后给新线发 noReply 交接通知；replace 复用 onboarding 消息。
- list --json 可直接喂给外部看板；新增 examples/dashboard 说明。
- 测试 33/33 通过。

## 0.3.6 (2026-11-09)

- 新增线生命周期：line_retire、line_rebind、line_create replace:true、line_rename。
- schema v7：lines.title/lifecycle/generation/rebind_at/rebind_from + line_events 审计；旧 DB additive 迁移。
- 积压迁移：queued/claimed 迁移，delivered/acked 不重投；migrate:none 在 backlog 非空时 fail-closed。
- 标题持久化：line_create/line_rename 写 lines.title，重启保留。
- 测试 32/32 通过；旧 0.3.5 行为不变。

## 0.3.5 (2026-11-05)

- 集成 P0/P1 bootstrap：line_create 默认排队 onboarding 消息，新增 bootstrapOnCreate，line_status/line_list 暴露 materialized / visibleInSidebar / bootstrapQueued。
- 保留 0.3.4 的文档与删句；README 以 0.3.4 为基础手工补 bootstrap 说明，没有用本地旧版覆盖。
- 无 schema 变化，仍为 v6。

## 0.3.4 (2026-11-05)

- 删除与插件定位冲突的提示句：不再在 README / 落地页建议“临时子任务直接用 subagent / Agent Teams”。
- 明确插件用于长期、多角色、需要持久消息的团队；一次性临时子任务由用户按 DSH 原生能力自行选择。
- 同步 npm 包与 Release 制品；无运行时行为变化，schema 仍为 v6。

## 0.3.3 (2026-11-04)

- 落地页改为场景化：hero、三张卡、一个真实用法四步、首次使用含 line_claim_manager、重启提示。
- 落地页与 social-preview 同步进入 npm 包和 GitHub Release 制品。
- 无运行时行为变化；schema 仍为 v6。

## 0.3.2 (2026-11-04)

- 零配置启动：没有 plugin config 时自动启动一条未绑定 manager，根会话可调用 line_claim_manager 自己绑定。
- 默认 DB 路径跟随 DSH_HOME；未设置时仍为 ~/.dsh/agent-lines/lines.db。
- README 明确：安装或更新后必须重启 DSH Web；显式 manager/worker 配置变为可选。
- 无 schema 变化，仍为 v6。

## 0.3.1 (2026-11-04)

- README 改为用户优先：先场景、安装和首次使用，技术细节后置；安装/快速开始不再要求手填 profile。
- 新增 install.sh，自动选择 DSH Web profile，并检查 agent-lines 是否可用。
- 同步最新双语 README、Pages、安装说明；0.3.1 的 npm 包内文档与公开仓库一致。
- 无运行时行为变更；schema 仍为 v6。

## 0.3.0 (2026-11-04)

- Transport 接缝（transport: sqlite 默认）。
- line_create 解析管理线工作区并传 workspaceId，新建线挂到工作区而不是“未分组”；可用 workspace 参数指定已有工作区。
- line_move_workspace 把已有线 Session 挂到 cwd 匹配的工作区。
- 回声保护：默认禁止 self-send、默认 5 秒去重窗口、maxReplyDepth（默认 8）、noReply 消息，以及 hop/root 元数据。
- 只读 line_status 对所有 Session 可见，包括未绑定 Session。
- line_claim_manager 全局工具：live 根 Session 可用 confirm: "bind-manager" 绑定为管理线；CLI claim 仍是兜底。
- dsh-agent-lines claim --agent ... --line manager --session ...：写入持久 claim 请求；运行中的插件无需重启即可重绑管理线。
- manager_bindings 持久化：已 claim 的管理 Session 跨重启保留，即使 profile 仍指向旧 Session。
- 启动时用 sessionPersistence.stat 校验配置的 Session；缺失的 Session 保持未绑定，不显示 online。
- allowClaim 控制 claim 轮询（默认 false）。
- Schema v6：claim_requests、manager_bindings，以及消息 hop/no_reply/root_message_id。

## 0.2.0 (2026-11-04)

- 单 DSH 进程多线：lines[] 配置、Session→line 映射、每线投递循环和每 agent prompt section。
- line_create 面向配置的管理线（allowCreate、createFrom）：在管理线 cwd 创建普通 DSH Session 并注册为线。
- 按 label 幂等创建（created:false）和 maxLines 限制（默认 16）。
- role 和 created_by 列及自动迁移；管理线启动时恢复自己创建的线。
- 兼容旧的单线配置（line/sessionId）。
- line 工具只对已绑定 Session 生效；未绑定聊天不再看到它们。
- 进程退出释放租约，减少快速重启后的 LINE_LEASE_HELD。

## 0.1.0 (2026-11-04)

- 首个 MVP：本地 SQLite 线注册表和持久消息队列。
- owner 进程通过 ctx.sessionController.prompt + requestId 幂等投递。
- 租约、心跳、过期 claim 回收、指数重试、TTL。
- 工具：line_list、line_send、line_inbox、line_ack。
- CLI：list、send、inbox、ack、doctor、tail。
- 显式区分 delivered 和 acked；至少一次投递，Session 日志有效一次。
- 本地文件系统检查（拒绝 NFS/CIFS/SMB/FUSE）。

未包含：HTTP transport、Web UI、Postgres adapter、自动拉起进程。