# 已知问题与边界

[English](KNOWN_ISSUES.en.md) | 中文

> 本文写"**已知会坏的地方**"和"**已知没做的东西**"。
> 写出来不是示弱：让使用者能预判、让 issue 能引用、让升级前能评估。
> 设计理由见 [PHILOSOPHY](PHILOSOPHY.md)，运维细节见 [DEPLOY](DEPLOY.md)。

## 一、设计边界（不是 bug，不会修）

| # | 边界 | 说明 |
|---|---|---|
| B1 | 一个插件实例只支持一个 manager/团队 | 同一 DSH 进程内同时跑多个团队不支持；独立 profile/DB 只是临时 workaround |
| B2 | 一个 DSH Session 同时只有一个 writer | 从另一个 DSH 进程（如主 Web UI）打开线 Session 会 `session/writer-held`，重试预算耗尽后消息 `failed` |
| B3 | 不跨机、不双活 | 本地 SQLite + 本地租约（见 PHILOSOPHY T3） |
| B4 | 不做进程隔离、不做插件内策略沙箱 | 权限属于 DSH 本体（`agentPreset` / 工具白名单） |
| B5 | 不做静态加密、不做发送方签名 | 静态数据靠全盘加密；对端消息是提示词层面的缓解，不是硬边界（[SECURITY](SECURITY.md)） |
| B6 | 不支持网络文件系统 | NFS/CIFS/SMB/FUSE 上的 DB 直接拒绝（`LINE_NETWORK_FILESYSTEM`） |
| B7 | `maxLines`（默认 16）是部署级上限 | 不是按线/按任务的硬限制；官方暂无 per-line 上限或 spawn 前拦截 API（见内部 0.6.6-CONDITION） |
| B8 | 官方任务板只读融合，不双向写回 | 见 PHILOSOPHY T5 |

## 二、已知缺口（待修，带计划版本）

| # | 缺口 | 现象 / 影响 | 计划 |
|---|---|---|---|
| G1 | ✅ 已在 **0.8.0** 关闭：`failed` / `expired` 在 agent 工具面不可见 | 现由 `line_messages` 按状态查、`line_trace` 看时间线 | 0.8.0 |
| G2 | ✅ 已在 **0.8.0** 关闭：没有 `line_redeliver` / `line_purge` | 已提供（purge 默认 dryRun、before 必填） | 0.8.0 |
| G3 | ✅ 已在 **0.8.0** 关闭：`delivered` 没有 ack 超时 | `ackTimeoutMs` 只标记 + 报数（`line_metrics`），不自动重投 | 0.8.0 |
| G4 | ✅ 已在 **0.8.0** 关闭：没有消息级事件流 | `message_events`（schema v13）+ `line_trace` | 0.8.0 |
| G5 | ✅ 已在 **0.9.0** 关闭：信封没有 `protocolVersion` | 信封携带 `protocolVersion`（0.4）；major/minor 协商规则见 PROTOCOL「版本协商」 | 0.9.0 |
| G6 | ✅ 已在 **0.9.0** 关闭：协议文档不可校验 | `schema/envelope.v0_4.json` + `schema/message.v0_4.json` + `conformance/`（7 组 25 条，任意语言可跑） | 0.9.0 |
| G7 | ✅ 已在 **0.9.0** 关闭：没有 DSH 能力探测 | `line_status.capabilities`（三态）+ `LINE_CAPABILITY_MISSING` + workspace 降级；版本区间不放松 | 0.9.0 |
| G8 | 部分关闭（0.10.0 S3a+S3b）：没有成本控制 | 按日增量/速率（`line_metrics.tokens`，估算）与**空闲休眠**（`line_hibernate`/`line_wake`，三态）已交付；**预算上限仍未交付** | 0.10.0（S3a 增量/速率 + S3b 休眠已交付；预算待评估） |
| G9 | 团队结构不是文件产物 | 团队靠对话现场生成，不可复现、不可 review、不可迁移 | 0.10.0 评估（`team.yaml`，须守 I5：只校验不拦截） |
| G10 | 真实上下文使用率不可得 | 只有活跃度代理（turns/steps/lastActivityAt），DSH 未暴露每 Session 的窗口占用；不伪造百分比 | **阻塞**：等 DSH 上游；0.9.0 能力探测命中即显示 |
| G11 | 部分关闭：快照已带 `schemaVersion` + `protocolVersion` 且字段只增不改（0.9.0 F7）；**只读状态 API 仍未提供** | 外部仍需读快照文件 | 0.10.0 评估只读状态接口 |
| G12 | 消息优先级（插队）不支持 | 队列按时间顺序；P0 指令不能插队 | **不排期**：与 at-least-once + ack 顺序语义冲突，需先设计再谈 |
| G13 | 线分组/子团队标签不支持 | 现有部门视图只表达"层级"，不表达"生产组/质检组"这类横切分组 | 0.10.0 评估 |
| G14 | ✅ 已在 **0.8.1** 关闭：发布包不自带回测/门禁脚本 | 0.8.0 的 `files` 未含 `scripts/`，包内无法自跑 business-smoke/两个门禁 | 0.8.1 已把 `scripts` 纳入 `files` |

## 三、已知坑（使用与运维）

| # | 坑 | 处置 |
|---|---|---|
| K1 | 没有 `line_delete` | 建线产生持久行，测试也会留真实记录；测试请用独立 `--db` 路径 |
| K2 | 空会话在跑首个回合前不会出现在侧栏 | 0.11.0 起 `line_create` 默认 onboarding 并等待 `blank=false`；逐次 `bootstrap:false` 已被忽略；只有部署级 `bootstrapOnCreate:false` 才会让线保持隐藏 |
| K3 | `line_create` 建好 Session 但 `attachSession` 失败会留孤儿 Session | 错误里带 `detail.sessionId`，不自动删除；按需手动清理 |
| K4 | 同名 label 不能重建 | `line_create` 返回 `created:false`；换人用 `line_create({ replace: true })` / `line_rebind` |
| K5 | `inactive` 不是下线 | 只是当前没有 turn 在跑；消息一到会唤醒 |
| K6 | 删 Session = 杀线 | 消息会永久投递失败（`session/not-found`） |
| K7 | 在别的 DSH 进程打开线 Session | 会 `session/writer-held`；关掉那个视图，或给线独立 Session |
| K8 | 旧版本打过本地补丁的用户 | 0.3.5 时代有用户改 `lib/index.js`/`lib/tools.js` 加标题改名；0.6.x 已内置 `line_rename`，补丁可回退 |

## 四、如何报告问题

请带上四项，缺一项很难定位：

1. 版本：插件版本 + DSH 版本 + Node 版本；
2. 现场：`dsh-agent-lines --json doctor` 与 `dsh-agent-lines --json list` 输出；
3. 消息：涉及的消息 id（`msg_...`）与它当前的 state；
4. 期望与实际：一句话说明"应该发生什么 / 实际发生了什么"。

失败态的消息（G1 修好之前）：`dsh-agent-lines --json tail --line <line>` 可列出该线全部状态的消息。

## 五、与其它文档

| 文档 | 内容 |
|---|---|
| [PHILOSOPHY](PHILOSOPHY.md) | 为什么这样设计、不变量、Non-goals |
| [DEPLOY](DEPLOY.md) | 部署、writer 冲突、运维 |
| [PROTOCOL](PROTOCOL.md) | 消息状态机与错误码 |
| [SECURITY](SECURITY.md) | 信任模型与"没做什么" |

## 六、命名漂移（0.12.0 起的已知边界）

- DSH 侧栏标题可被用户手动修改，与 DB title / 章程头部可能不一致；插件当前无法读侧栏标题，因此**只做文档约定**，只读检测接口（titleCheck）在 0.13 提供。
- 看板只读 DB 与章程，能看到 registry vs title 的不一致，但看不到侧栏漂移。
