# 更新记录

[English](CHANGELOG.en.md) | 中文

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