# 使用边界（成熟度说明）

> 这份文档回答：在它自己划定的范围内，你可以依赖什么、不能依赖什么。不是免责声明，也不评价产品未来能长多大。

## 1. 范围：负责什么 / 不负责什么

**负责**：长期角色之间的持久消息通道——稳定角色身份（label）、跨重启会话记忆、角色交接、可审计消息队列，以及这些数据的只读看板。

**不负责**：任务拆解、DAG/依赖编排、质量门禁、跨机同步、多团队并存、官方任务板双向写回。这些要么归负责人/角色提示词，要么用 DSH 官方智能体团队插件（DSH内置）。

## 2. 稳定面：这些不会无故变

| 面 | 保证 |
|---|---|
| 消息信封 | protocolVersion 0.4 语义固定；major 不同拒收，minor 更高忽略未知字段 |
| schema / conformance | 作为可执行规范；协议实现可据此对齐 |
| 错误码 | LINE_* 只增不改，现有语义不变 |
| 消息状态机 | queued → claimed → delivered → acked，failed/expired 为旁支 |
| 投递语义 | 至少一次；幂等权威是 DSH requestId / 显式 idempotencyKey |
| 数据库 | schema v15，只做增量迁移，无需手工操作 |

## 3. 会变：这些不要硬依赖

- 工具名与参数（当前 26 个）会增删；以 AGENTS.md 当期契约为准；
- 看板 HTML 与 /api/live 响应结构会随 UI 迭代；
- 插件 patch 版本可能包含行为变更；请同时锁定 DSH 与插件版本；
- lines.db 内部表结构只保证“只增列”，程序化读取请走 CLI，不要直接写 SQL。

## 4. 已知边界：会触发，但有绕行

| 情况 | 影响 | 怎么办 |
|---|---|---|
| 一个 Session 只能有一个 writer | 另一个 DSH 进程打开线会话会 session/writer-held | 每条线独立进程，或关掉其他视图 |
| 一个插件实例只支持一个团队 | 无法同进程跑多团队 | 独立 profile + 独立 DB |
| DB 在 NFS/CIFS/SMB/FUSE | 启动即拒绝 LINE_NETWORK_FILESYSTEM | 使用本地磁盘 |
| 删除线 Session | 消息永久投递失败 session/not-found | 不删线会话；下线用 line_retire |
| ack 超时 | 只标记上报，不自动重投 | 用 line_messages / line_metrics 查看，自行决定 line_redeliver |

## 5. 失效与恢复、数据责任

- 失败消息：line_messages({states:["failed"]}) / line_trace / line_redeliver / line_purge；
- 健康检查：CLI doctor；
- 数据在本地 lines.db；插件不采集遥测、无自动备份；请自行备份（停写后复制或用 SQLite 备份 API）；
- 看板只读，不提供恢复操作。
- 负责人交接：新 root 调 line_claim_manager，或当前 manager 调 line_handover_manager；旧 manager 在线时自动加退役标题。已下线 Session 不能通过工具补 rename（DSH 公开 API 限制），请在交接时完成。

## 历史

0.11.2 及之前存在跨桶边界重复问题，0.11.3 已修复；0.11.4 为去重查询加索引，不改变语义。

## 版本

当前发布 0.11.5。本文与代码不一致时，以 AGENTS.md / CHANGELOG 为准，并视为文档 bug。
