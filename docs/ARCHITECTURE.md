# 架构

[English](ARCHITECTURE.en.md) | 中文

这是公开架构说明。版本计划与发布操作放在本仓库之外。

## 分层

DSH Host
  -> dsh-agent-lines
       LineService      线身份、线定义、manager 绑定、claim/status
       DeliveryLoop     owner-process prompt 投递
       Tools            line_status、line_claim_manager、line_list、line_create、
                        line_move_workspace、line_send、line_inbox、line_ack
       Transport SPI
         SqliteTransport  当前实现；本地 SQLite/WAL

DSH 适配层负责“当前 Session 是谁”以及“消息如何进入 DSH Session”；transport
负责线/消息的持久存储。

0.3 只发布 SQLite transport。Transport SPI 只是为未来 transport 留接口；外部
transport 不属于本版本。

## 投递模型

- 一条线是一个普通 DSH Session 加一个稳定 label。
- 一个 Session 只能有一个 writer；只有持有该 Session 的进程可以 prompt 它。
- 投递把消息 ID 作为 DSH requestId；崩溃后重试会返回原 acceptance，不会在
  Session 日志里多插一条。
- lease 选出线的 owner；超过 claim timeout 的 stale claim 会被重新排队。
- delivered 表示目标 Session 接受了 prompt；acked 表示 agent 调用了 line_ack。

## manager 与 claim

- manager 线由 createFrom 指定，必须是 live 根 Session。
- line_status 是全局只读工具，返回当前绑定、manager Session 是否 live/persisted、
  已知线列表和修复命令。
- line_claim_manager 是受 allowClaim 控制的全局工具，要求显式 confirm，且只接受
  未绑定 worker 的 live 根 Session；CLI 仍是运维兜底。插件会校验 Session、释放旧
  manager lease、重绑，并把选择持久化到 manager_bindings。
- claim 不是每个新 Session 自动执行的动作。

## 工作区

- DSH 按 workspace 成员表（workspace.attachSession）分组，不是按 cwd。
- line_create 解析 manager 所属 workspace 并传 workspaceId，新 Session 会挂到
  该工作区。
- line_move_workspace 只在已有 Session 的 cwd 与目标 workspace path 完全一致时
  允许 attach；不能把 Session 迁移到不同目录。

## 边界

- line_create 创建的是根 DSH Session，不是 subagent。
- 不做交接：不迁移 Session、不切换路由、不迁移未读。
- 没有进程隔离：多条线可以共享一个 DSH 进程。
- 一个插件实例只支持一个 manager/团队；不支持同时多个团队。
- 一个 Session 只能有一个 writer；不要从另一个 DSH 进程打开线 Session。
- 没有 line_delete：建线会留下持久行，测试也会留下真实数据。
- 默认 SQLite transport 不开网络监听。
