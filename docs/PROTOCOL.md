# 协议（v0.3）

[English](PROTOCOL.en.md) | 中文

## 地址

- Agent：^[a-z0-9][a-z0-9._-]{0,95}$
- Line：^[a-z0-9][a-z0-9._-]{0,63}$
- 规范线 ID：<agentId>#<line>
- 裸目标（只写 line）使用发送方的 agentId。

## 信封

    {
      "id": "msg_...",
      "idempotencyKey": "caller:retry-1",
      "from": { "agentId": "agent-demo", "line": "frontend", "sessionId": "session-..." },
      "to":   { "agentId": "agent-demo", "line": "backend" },
      "body": { "text": "..." },
      "createdAt": 1793757000000,
      "expiresAt": null,
      "replyTo": null,
      "rootMessageId": "msg_...",
      "hop": 1,
      "noReply": false
    }

## 状态机

    queued ──claim──> claimed ──prompt accepted──> delivered ──line_ack──> acked
      │                 │                              │
      │                 └──claim timeout──> queued     └──TTL──> expired
      └──retry exhausted──> failed

- queued：已持久化，尚未被领取。
- claimed：被某个 owner 进程领取；超过 claimTimeoutMs 未完成会重新入队。
- delivered：ctx.sessionController.prompt 已把消息接进目标 Session 收件箱。
- acked：目标显式调用 line_ack。
- failed：重试预算耗尽，或遇到永久错误（session/not-found）。
- expired：投递前 TTL 已过。

## 投递语义

**至少一次；在 DSH Session 日志里通过 requestId 实现有效一次。**

消息 id 作为 SessionPromptRequest.requestId 传入。相同 requestId 重试时，DSH 返回原来的接受结果，所以“prompt accepted”和“mark delivered”之间崩溃不会在 Session 日志里产生重复消息。队列仍可能显示 queued 并重试，这是预期行为。

这不是分布式 exactly-once：幂等权威是 DSH Session 日志，不是 SQLite 队列。

## 租约

- 一条线同时最多一个 live owner 实例。
- acquire 设置 expires_at = now + leaseTtlMs；第二个实例会得到 LINE_LEASE_HELD。
- owner 每次 poll 都心跳；租约超过 TTL 过期。
- 优雅退出时释放租约。
- 崩溃的 owner 租约过期后，新进程可以 acquire。

## 状态与 claim

line_status 是全局只读工具。它用 sessionPersistence.stat 检查管理 Session，但不会恢复它；返回当前绑定、manager live/persisted、线列表和修复命令。

根 Session 可以通过 line_claim_manager（全局工具，allowClaim: true，confirm: "bind-manager"）或 CLI 发起 claim。两者都会写入 claim_requests：

    line_claim_manager / CLI -> claim_requests(pending)
    plugin poll -> 校验 root/live/not-bound
      -> 停旧 manager loop，释放租约
      -> 更新 lines.session_id，获取新租约
      -> manager_bindings upsert
      -> 启动 loop，绑定 tools/prompt
      -> claim_requests(claimed|rejected)

line_claim_manager 不自动执行：需要用户明确请求，且 worker 已绑定或非根 Session 会被拒绝。

manager_bindings 是管理 Session 跨重启的持久事实源；profile 配置是 fallback。

## 建线

只有配置的 manager 线（createFrom）且 allowCreate: true 才能调用 line_create。

    line_create(label, role?, workspace?, cwd?, agentPreset?)
      -> label 已存在? 返回 { line, sessionId, role, created: false }
      -> countLines(agent) >= maxLines? LINE_LIMIT
      -> sessionController.create({ sessionId: session-<uuid>, workspaceId? | cwd, agentPreset })
      -> store.acquire + 启动 DeliveryLoop + 绑定 prompt
      -> 返回 { line, sessionId, role, cwd, created: true }

新线是同一 DSH 进程里的普通 DSH Session；不创建 OS 进程、profile、端口或 handover。记录 created_by，管理线启动时可恢复。

line_create 通过 workspaceRegistry.resolveByPath(managerCwd) 解析管理线工作区。找到时传 workspaceId（不传 cwd），让 sessionController.create 调 workspace.attachSession。可选 workspace 指定已有工作区 path/id；workspace 与 cwd 互斥。没有工作区时回退 cwd，线保持未分组。

line_move_workspace({ line, workspace }) 把已有线 Session 挂到已有工作区。DSH 的 attachSession 要求 Session 存储的 cwd 与工作区 path 完全一致；不同目录会 WORKSPACE_ATTACH_FAILED，不会迁移 Session。如果 Session 创建成功但注册失败，错误里带 detail.sessionId，Session 不会自动删除。

## 回声与回复深度

- rootMessageId 标识回复链；根消息为 null。
- hop 根消息为 0，回复为 parent.hop + 1。
- maxReplyDepth（默认 8）超过时拒绝：LINE_REPLY_DEPTH_EXCEEDED。
- noReply: true 标记通知；回复会被拒绝：LINE_NO_REPLY。
- 默认禁止自己发自己：LINE_SELF_SEND_FORBIDDEN。
- 不传 key 时，dedupeWindowMs（默认 5 秒）内的相同发送会合并；forceDistinct: true 可跳过。

## 幂等键

- caller:<key>：调用方控制；相同 key 返回已有消息。
- auto:<sha256>：每次发送生成；两条故意相同的消息仍然不同。
- 数据库对 idempotency_key 有 UNIQUE 约束。

## 错误

| 代码 | 含义 |
|---|---|
| LINE_INVALID_CONFIG | 配置缺失/非法 |
| LINE_INVALID_AGENT / LINE_INVALID_LINE | 地址部分非法 |
| LINE_INVALID_TARGET | 目标格式错误 |
| LINE_NOT_FOUND | 目标/发送方线未注册 |
| LINE_LEASE_HELD | 另一个 live 进程持有该线 |
| LINE_LEASE_LOST | 当前进程不再持有该线 |
| LINE_MESSAGE_NOT_FOUND | ack 未知消息 |
| LINE_NOT_DELIVERED | 投递前 ack |
| LINE_MESSAGE_TOO_LARGE | 正文超过 maxMessageBytes |
| LINE_NETWORK_FILESYSTEM | DB 位于 NFS/CIFS/SMB/FUSE |
| LINE_WRONG_SESSION / LINE_NOT_BOUND | 从当前进程不服务的 Session 调用工具 |
| LINE_LIMIT | line_create 会超过 maxLines |
| LINE_CREATE_DISABLED | 该 profile 未启用 allowCreate |
| LINE_CREATE_FORBIDDEN | 调用方不是配置的 createFrom manager |
| LINE_SESSION_BOUND | claim 目标已绑定到另一条线 |
| SESSION_NOT_LIVE / NOT_ROOT | claim 目标不是 live 根 Session |
| LINE_INVALID_ARGUMENT | 工具参数非法，例如 limit |
| LINE_CLAIM_DISABLED | allowClaim 为 false |
| LINE_CLAIM_CONFIRM_REQUIRED | confirm 不是 "bind-manager" |
| LINE_NOT_ROOT | 非根 Session 尝试 claim manager |
| LINE_SELF_SEND_FORBIDDEN | 禁止自己发自己 |
| LINE_NO_REPLY | 回复 noReply 消息 |
| LINE_REPLY_DEPTH_EXCEEDED | 回复链超过 maxReplyDepth |
| LINE_REPLY_TARGET_NOT_FOUND | replyTo 指向未知消息 |
| session/writer-held (DSH) | 另一个 DSH 进程持有目标 Session 的 writer 锁；关闭另一个视图或使用专用 Session |
