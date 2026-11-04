# dsh-agent-lines

[English](README.en.md) | 中文

> DeepSeek Harness 社区插件，不是 DeepSeek 官方产品。

> **100% Vibe Coding。** 架构、代码、测试、文档都在 AI agent 会话中完成。它是实验性项目：生产使用前请审阅代码并跑一遍集成测试。

DSH agent 的 super agent 平替插件。给 DSH agent 线（line）用的、可寻址的持久消息层。一条线是一个普通 DSH Session 加一个稳定 label；一个 DSH 进程可以承载多条线，管理线还可以通过 `line_create` 在对话里创建新线。

## 什么时候用

如果所有 worker 都是同一个 DSH 进程里、同一个父 Agent 的子任务，**优先用内置 subagent / Agent Teams**；更简单，不需要插件。

需要下面这些时再用 **dsh-agent-lines**：

- 线要能按 `agent#line` 寻址；
- 线是独立 DSH Session，有自己的上下文和生命周期；
- 收件箱要能跨接收方重启存活；
- 同机多个 DSH 进程共享一个线数据库；
- 管理线通过自然语言让模型创建 worker 线。

插件只做传输 + 轻量建线，不做任务编排。**交接（handover）没有实现**。

## 传输

`transport` 默认 `sqlite`（local-first），也是 0.3 唯一发布的 transport；安装插件不需要 Postgres 或 Python 服务。

## 架构

~~~mermaid
flowchart LR
  U[用户] --> M[管理线 DSH Session]
  M -->|line_create / line_send| P[dsh-agent-lines]
  P --> Q[(SQLite lines.db)]
  P -->|prompt requestId| W1[前端线 Session]
  P -->|prompt requestId| W2[后端线 Session]
  W1 -->|line_inbox / line_ack| P
  W2 -->|line_inbox / line_ack| P
~~~

DSH 适配层负责线身份和“把消息送进 Session”；transport 负责持久消息和跨进程存储。默认是本地 SQLite。公开架构说明：[English](docs/ARCHITECTURE.en.md) | [中文](docs/ARCHITECTURE.md)。

## 要求

- DSH `>=0.2.1-rc.5 <0.3.0`
- Node.js `^22.19.0 || >=24.0.0`
- 本地文件系统（NFS/CIFS/SMB/FUSE 会被拒绝）

## 安装

```bash
dsh plugin --profile <profile> add dsh-agent-lines@0.3.0
```

离线或 npm 不可用时，用本地 tarball 安装：

```bash
dsh plugin --profile <profile> add ./dsh-agent-lines-0.3.0.tgz
```

不知道 `<profile>` 是什么，可以直接用一键脚本（自动选 `web`，没有 web 时选唯一 profile）：

```bash
curl -fsSL https://raw.githubusercontent.com/Lencen/dsh-agent-lines/main/install.sh -o install.sh
bash install.sh
# npm 未发布时：bash install.sh ./dsh-agent-lines-0.3.0.tgz
```

手动安装时，`<profile>` 是 **DSH profile 名**（对应 `~/.dsh/profiles/<profile>`），不是线名，也不是 agent 名。

- 已有 profile：先 `ls ~/.dsh/profiles`，填实际目录名，例如 `web`、`headless`；
- 想隔离安装：用新名字，例如 `agent-lines`，命令会自动初始化：

```bash
dsh plugin --profile agent-lines add dsh-agent-lines@0.3.0
```

不要把 `manager-line`、`research` 这类线名填进 `--profile`。

### 管理线配置

```yaml
- id: agent-lines
  name: dsh-agent-lines
  config:
    agentId: agent-demo
    dbPath: /home/me/.dsh/agent-lines/lines.db
    allowCreate: true
    allowClaim: true
    allowSelfSend: false
    dedupeWindowMs: 5000
    maxReplyDepth: 8
    createFrom: manager-line
    maxLines: 16
    childPreset: standard
    lines:
      - label: manager-line
        sessionId: session-lines-manager
        role: 任务对接、拆解与调度
```

只有 `createFrom` 指定的线能调用 `line_create`。worker profile 不要开 `allowCreate`。

### Worker profile

```yaml
- id: agent-lines
  name: dsh-agent-lines
  config:
    agentId: agent-demo
    dbPath: /home/me/.dsh/agent-lines/lines.db
    lines:
      - label: frontend-line
        sessionId: session-lines-frontend
        role: 前端
```

旧的单线写法 `line: frontend-line` + `sessionId: ...` 仍然兼容。

## 快速开始

1. 安装：<code>dsh plugin --profile &lt;profile&gt; add dsh-agent-lines@0.3.0</code>，或用本地 tarball（见“安装”）。
2. 配置一条管理线：<code>allowCreate: true</code>、<code>allowClaim: true</code>、<code>createFrom: manager-line</code>。
3. 启动 profile，打开任意根 Session。
4. 先调用 <code>line_status</code>。如果当前会话未绑定，调用 <code>line_claim_manager({ confirm: "bind-manager" })</code>；CLI 兜底：
   ~~~bash
   dsh-agent-lines claim --agent agent-demo --line manager-line --session "$DSH_SESSION_ID"
   ~~~
5. 对管理线说：“创建 frontend-line、backend-line、ops-line，然后分别发一条 hello。”
6. worker 可以是独立 profile（共享同一个 <code>dbPath</code>），也可以是管理线进程内创建的线。

任何新会话先看 <code>line_status</code>：它会告诉你是否绑定、manager 是谁、下一步怎么修。

## 首次使用：组建开发团队

在新根会话里直接复制下面这段。它会先绑定管理线，再创建一支团队；后续任务再单独发，不要让它自己开工。

> 使用 dsh-agent-lines。如果当前会话尚未绑定，先调用 line_claim_manager，confirm 用 "bind-manager"。
>
> 你是开发团队负责人：负责任务拆解与分配、协调团队沟通、跟踪成员工作状态与进度、汇总工作结果、总结并汇报。你只做管理和协调，不执行具体开发任务。
>
> 请用 line_create 创建成员线，label 用英文，role 用中文：research（调研）、architecture（架构）、uiux（UIUX）、dev（开发）、test（测试）、acceptance（验收）、release（发布）、ops（运维）。
>
> 创建后用 line_list 确认，然后待命，等我发第一个任务；不要自行开始具体工作。

label 必须是 ASCII 标识符；中文放在 role 里，不要用中文 label。这个提示词只创建一个团队；0.3 不支持同一插件实例同时多个团队。

可直接复制的调用（由管理线 Session 执行）：

~~~js
line_create({ label: "research", role: "调研" })
line_create({ label: "architecture", role: "架构" })
line_create({ label: "uiux", role: "UIUX" })
line_create({ label: "dev", role: "开发" })
line_create({ label: "test", role: "测试" })
line_create({ label: "acceptance", role: "验收" })
line_create({ label: "release", role: "发布" })
line_create({ label: "ops", role: "运维" })
~~~

创建后用 line_list 确认。

![首次使用：绑定管理线、创建 8 条成员线、line_list 确认](docs/assets/first-use.gif)

真实 DSH Web 演示 profile、通用 label；不含内部数据。


## 场景：一个管理线 + 多条执行线

只要 profile 里有管理线配置，Session 不必预先绑定。打开任意根 Session，直接说：

> 你是管理线。先用 line_claim_manager 把自己绑定为管理线，然后负责任务拆分与调度。需要建几个任务执行线，由你安排分配任务；你负责协调执行线中的工作内容、裁决纠纷、回收任务结果、汇总、总结、汇报。

接下来会发生：

1. 管理线调用 <code>line_create</code> 创建前端线、后端线、运维线、数据线，再用 <code>line_list</code> 确认。
2. 用户给一个具体任务，例如：“给报表页加 CSV 导出，带测试和一页 runbook。”
3. 管理线拆解后，用 <code>line_send</code> 发给对应执行线；消息落 SQLite。
4. 执行线用 <code>line_inbox</code> 收任务、执行、<code>line_ack</code> 确认，需要时用 <code>line_send</code> 回复。
5. 管理线收集结果；如果前端和后端对接口结构有分歧，管理线裁决并统一口径。
6. 管理线汇总、总结、汇报；各执行线保留自己的上下文和消息历史。

这是一个“提示词组织模式”，不是插件内置的组织架构：怎么拆任务由管理线模型决定。插件提供的是持久传输和硬约束：

- <code>maxLines</code> 限制建线数量；
- <code>noReply</code>、<code>maxReplyDepth</code> 和默认 self-send 禁止，防止自动回声；
- <code>line_status</code> 诊断 manager 绑定；
- 一个 Session 只能有一个 writer。

如果管理线没绑定，<code>line_status</code> 会给出修复命令；先调用 <code>line_claim_manager</code>（或 CLI）再跑这个场景。

## 使用

管理线可以完全由对话驱动：

> 你是管理线。用 `line_create` 创建 frontend-line、backend-line、ops-line，然后用 `line_list` 确认。

工具：

| 工具 | 作用 |
|---|---|
| `line_status` | 只读：当前会话绑定、manager Session 是否存在/live、线列表、修复命令；未绑定也可见 |
| `line_claim_manager` | 把当前 live 根 Session 绑成 manager；需要 `allowClaim: true` 和 `confirm: "bind-manager"`；全局工具，不需要 shell |
| `line_list` | 列出线、状态、未读数、当前线和 role |
| `line_create` | 仅管理线：在管理线工作区（或指定的已有工作区）创建 DSH Session 并注册为线；同 label 幂等 |
| `line_move_workspace` | 仅管理线：把已有线的 Session 挂到路径完全匹配的工作区 |
| `line_send` | 发到 `line` 或 `agent#line`；可选 `idempotencyKey`、`replyTo`、`noReply`、`forceDistinct`、`ttlMs` |
| `line_inbox` | 读当前线已投递消息 |
| `line_ack` | 确认已处理 |

除 `line_status`、`line_claim_manager` 外，line 工具只注册在已绑定线的 Session 上；这两个控制工具是全局的：status 只读，claim 仅限根会话且受 allowClaim 控制。

`line_create` 在管理线所属工作区（没有工作区时回退当前目录）创建普通 DSH Session；它**不会**创建独立 OS 进程、profile 或端口，也不转移已有 Session。

创建的线会记录 `created_by`，进程重启时由管理线恢复。line_create 会解析管理线所属工作区并传 workspaceId（DSH 会自动 attach），所以新线出现在该工作区而不是“未分组”；如果管理线本身不在工作区，则回退 cwd，线保持未分组。传 `workspace`（已有路径或 id）可指定其他工作区。若某条线的 Session 还从未落盘，首次投递可能 `session/not-found`；给它发一条任务（或重新创建）即可让它持久化。

CLI：

```bash
dsh-agent-lines list
dsh-agent-lines send --from frontend-line --to backend-line --text "hi"
dsh-agent-lines inbox --line backend-line
dsh-agent-lines ack --line backend-line --id msg_...
dsh-agent-lines claim --agent agent-demo --line manager --session "$DSH_SESSION_ID"
dsh-agent-lines doctor
```

用 `--db` 或 `DSH_AGENT_LINES_DB` 指向插件同一个数据库。

## 工作区

DSH 侧边栏按 workspace 的 sessionIds 成员表分组，不是按 cwd。line_create 通过 workspaceRegistry.resolveByPath 找到管理线所属工作区，传 workspaceId，DSH 会在创建时 attachSession，新线就不会落到“未分组”。如果管理线没有 workspace，插件回退 cwd，线仍未分组。

line_move_workspace 把已有线挂到目标 workspace。DSH 只在 Session cwd 与 workspace path 完全一致时允许 attach；否则插件返回 WORKSPACE_ATTACH_FAILED。它不能把 Session 迁移到不同目录（那需要新 Session/交接）。

## manager 绑定与 claim

manager 是一条真实的 DSH Session。你打开另一个会话时，它不是 manager，line 工具会刻意不出现；先调用 `line_status` 看当前绑定和修复命令。

根会话可以直接在对话里绑自己，不需要 shell：

```json
line_claim_manager({ "confirm": "bind-manager" })
```

插件会校验调用者是 live 根会话、释放旧 manager 租约、重绑 manager，并把选择写入 `manager_bindings`。不需要改 profile，也不需要重启；需要 `allowClaim: true`。

运维仍可用 CLI 兜底：

```bash
dsh-agent-lines claim --agent agent-demo --line manager --session "$DSH_SESSION_ID"
```

claim 不会对每个新会话自动执行：需要用户明确要求，或运维显式调用。

## 回声与重复保护

- 同 `idempotencyKey` 返回已有消息。
- 不传 key 时，同一 `dedupeWindowMs`（默认 5 秒）内的相同发送合并为一条；要故意发两条相同正文用 `forceDistinct: true`。
- `replyTo` 会让 `hop` 递增；超过 `maxReplyDepth`（默认 8）返回 `LINE_REPLY_DEPTH_EXCEEDED`。
- `noReply: true` 的消息不能被回复；尝试回复返回 `LINE_NO_REPLY`。
- 默认禁止自己发自己（`LINE_SELF_SEND_FORBIDDEN`）；确需给自己留笔记时设 `allowSelfSend: true`。

这是传输层保护，不保证两个 agent 不会主动继续聊天；用 `noReply` 和 reply depth 约束。

## 投递语义

`queued → claimed → delivered → acked`

- `delivered`：目标 DSH Session 已接受 prompt。
- `acked`：agent 显式调用 `line_ack`。
- **至少一次**；靠 DSH 的 `requestId` 幂等让重试在 Session 日志里“有效一次”。不是分布式 exactly-once。
- 接收方离线时消息留在队列；0.3 不自动拉起进程。
- **一个 Session 只能有一个 writer。** 不要在另一个 DSH 进程（例如主 Web UI）里打开某条线的 Session；否则会 `session/writer-held`。关掉另一个视图，或给线独立 Session。

## 安全

- 插件在 DSH Host 进程内运行，拥有主机权限；只安装可信包。
- 0.3 默认本地 SQLite，不开网络监听。
- 只有 `createFrom` 管理线能建线；`maxLines` 限制增长。
- 对端消息在 prompt 里明确标为 peer content，不是用户指令。
- 详见 [docs/SECURITY.md](docs/SECURITY.md)。

## 限制

- 不做交接；不能把 Session 迁移到不同目录。
- 多线是同进程多 Session，不是进程隔离。
- 一个插件实例只支持一个 manager/团队；同一个 DSH 进程里同时跑开发、小说等多个团队不支持；独立 profile/DB 只是临时 workaround，不是产品模型。
- 没有 `line_delete`；建线会产生持久行，测试也会留下真实记录。
- 空白线 Session 可能需要第一条任务后才落盘。
- 一个 Session 只能有一个 writer；不要从另一个 DSH 进程打开线 Session。

## 状态

实验性 `0.3.x`。DSH 处于 developer preview，API 可能变化；请同时锁定 DSH 与插件版本。

## 致谢

- 人类 vibecoding：**Lencen**
- 开发 agent：**DeepSeek Harness agent (DSH)**
- 使用模型：**deepseek v4.1 flash 1017**
- 邮箱：[iamlencen@qq.com](mailto:iamlencen@qq.com)

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)；行为准则 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；文档站 [lencen.github.io/dsh-agent-lines](https://lencen.github.io/dsh-agent-lines/)。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
