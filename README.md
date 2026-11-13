# dsh-agent-lines

> **给 agent：第一次用先读 [docs/AI-USAGE.md](docs/AI-USAGE.md)**（五步建团队，不要扫源码/试错）。

[English](README.en.md) | 中文

GitHub: [Lencen/dsh-agent-lines](https://github.com/Lencen/dsh-agent-lines)

> 当前发布：v0.12.0（2026-11-13）——Board 2.0 看板重设计、线层任务分层、负责人交接自动化。

> DeepSeek Harness 社区插件，不是 DeepSeek 官方产品。

> **100% Vibe Coding、快速迭代期。**
>
> 范围与稳定面见 [使用边界](docs/USAGE-BOUNDARY.md)：负责长期角色/消息/交接/只读看板；不负责 DAG、跨机、多团队。

DSH 的 super agent 平替插件。

你不用每次新开会话、手动把背景复制给几个 agent。让一个负责人 agent 带一支长期协作的团队：每个成员有名字、各负责一块，任务和消息不会丢，结果由负责人汇总给你。

## Quick Context（给 AI 助手）

> 这一段是给 AI 读的结构化上下文：把本插件粘给 AI 让它安排团队时，先让它读这里，能少猜、少幻觉。人类读者可跳过。

- **运行环境**：DeepSeek Harness (DSH) 社区插件，运行在 DSH Host 进程内，不是独立应用、不是官方产品。DSH `>=0.2.1-rc.5 <0.3.0`；Node `^22.19.0 || >=24.0.0`。
- **数据存储**：本地 SQLite（默认 `DSH_HOME/agent-lines/lines.db`，可用配置 `dbPath` 或环境变量 `DSH_AGENT_LINES_DB` 覆盖）；网络文件系统会被拒绝。
- **核心实体**：**Manager Line**（`createFrom` 指定的负责人线）/ **Worker Line**（成员线）；每条线 = `label`（稳定名字） + `sessionId`（可替换会话） + 租约。
- **关键约束**：只有 `createFrom` 线（且 `allowCreate: true`）能调用 `line_create`；**worker profile 不要开 `allowCreate`**；一个 Session 同时只有一个 writer；不要在另一个 DSH 进程打开线 Session（会 `session/writer-held`）。
- **零配置行为**：未绑定根会话可调用 `line_claim_manager({ confirm: "bind-manager" })` 自行绑定（需 `allowClaim: true`，零配置下默认开启）。
- **投递语义**：至少一次；幂等权威是 DSH 的 `requestId`；失败态可查可救（`line_messages` / `line_trace` / `line_redeliver`），**ack 超时只报数不自动重投**。
- **AI 操作契约**：[AGENTS.md](AGENTS.md)（配置字段、27 个工具、`line_status` 字段、硬性约束）；设计思想：[docs/PHILOSOPHY.md](docs/PHILOSOPHY.md)｜[网页版](https://lencen.github.io/dsh-agent-lines/philosophy.html)。

## 阅读顺序（先看哪一页）

| 你是 | 先读 | 需要时再看 |
|---|---|---|
| 第一次听说，判断值不值得用 | 本文「什么时候用」「两种团队」 | 「安装」「快速开始」 |
| 让 AI 帮你建团队 | [docs/AI-USAGE.md](docs/AI-USAGE.md)（五步，别扫源码） | [AGENTS.md](AGENTS.md)（工具/配置契约） |
| 部署与配置 | [docs/DEPLOY.md](docs/DEPLOY.md) | [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) |
| 团队工作区与看板 | [docs/TEAM-WORKSPACE.md](docs/TEAM-WORKSPACE.md) | 本文「看板」 |
| 设计 / 贡献 | [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/PROTOCOL.md](docs/PROTOCOL.md) |
| 排障 / 升级 | [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | [CHANGELOG.md](CHANGELOG.md) |

**延伸阅读：关于 AI 组织**

- 短版（中文）：[关于AI组织的思考与探索](docs/关于AI组织的思考与探索.md)
- 短版（英文）：[Reflections on AI Organizations](docs/en/THOUGHTS-ON-AI-ORGANIZATION.md)
- 论文版（中文）：[从流程到岗位：长期 AI 团队的组织设计](docs/从流程到岗位.md)
- 论文版（英文）：[From Workflow to Position](docs/en/FROM-WORKFLOW-TO-POSITION.md)

## 什么时候用 / 什么时候不用

| 场景 | 选 dsh-agent-lines | 不选（更适合别的方案） |
|---|---|---|
| 长期项目，不想每次重讲背景 | ✅ 每个角色有长期记忆 | ❌ 一次性小任务，用普通会话更快 |
| 多个 agent 长期固定分工（调研/开发/测试/发布） | ✅ 直接点名派任务 | ❌ 只需要一个会话里临时并发，用 DSH 官方智能体团队插件（DSH内置）即可 |
| 任务做到一半要关窗口、重启还要接着做 | ✅ 消息与状态落盘 | ❌ 不需要跨重启，DSH 官方智能体团队插件（DSH内置）更轻 |
| 会话满了要换人但角色不能换 | ✅ `line_handoff` / `line_rebind` | ❌ 只要一次性的多 agent 协作 |
| 需要任务依赖管控、质量门控、任务看板 | ⚠️ 只读融合官方任务板，不自己做 DAG | ✅ 用 DSH 官方智能体团队插件（DSH内置）（任务 DAG + 面板） |
| 需要跨机/多活/强隔离 | ❌ 不支持（本地 SQLite + 本地租约） | ✅ 另选分布式方案 |


## 两种团队长什么样

### DSH 官方智能体团队插件（DSH内置）

~~~text
一个 DSH 会话
  └─ 会话里的若干子 agent
~~~

- 一个会话就是一个官方团队；
- 子 agent 是任务型成员：围绕任务启动，任务结束后通常释放或复用；
- 子 agent 不是长期角色，不要把它当成有长期记忆的固定成员；
- 官方团队有任务板、任务依赖、网页面板；
- 团队内可以并发处理子任务。

### dsh-agent-lines

~~~text
多个 DSH 会话组成团队
  ├─ 负责人会话
  ├─ 开发角色会话
  ├─ 测试角色会话
  └─ 校对角色会话
~~~

- 团队由会话组成，不是“一个会话里塞很多子 agent”；
- 每个会话有自己的持久记忆；
- 角色可以在自己的会话里连续做任务，也可以隔一段时间再做；
- 会话满了可以换新会话，但角色不换；
- 负责人在自己的会话里做拆解、调度、验收；
- dsh-agent-lines 自己不提供任务板。

## 和 DSH 官方智能体团队插件（DSH内置）的区别

不是替代关系，是互补关系。一句话：**DSH 官方智能体团队插件（DSH内置）管“一个会话里的团队”，dsh-agent-lines 管“多个会话组成的长期团队”。**

| 维度 | DSH 官方智能体团队插件（DSH内置）（实验性） | dsh-agent-lines |
|---|---|---|
| 组织单位 | 一个会话 + 会话里的子 agent | 多个 DSH 会话组成团队 |
| 成员性质 | 任务型子 agent，任务结束通常释放/复用 | 长期角色会话，可连续或不连续做任务 |
| 记忆 | 会话有记忆；团队成员子 agent 不是长期角色，换子 agent 可能丢失成员记忆 | 团队每个成员都是独立会话，有持久记忆；会话不删除，记忆不丢 |
| 任务板 | 有，一个团队一个任务板 | 没有自己的任务板 |
| 并发 | 会话内子 agent 并发 | 会话之间并行 |
| 换人 | 换会话就是换团队；会话里换子 agent 就是换成员；换子 agent 会丢成员记忆 | 换会话（交接）可以继承任务与关键记忆；历史会话记忆保留在团队里 |
| 网页面板 | 官方任务/成员面板 | 组织树 + 成员会话台 |
| 适合 | 一次性或短周期多子 agent 协作 | 长期小说、视频、研究、运营团队 |

line 的交接继承的是任务状态和关键记忆（交接单、文件），不是完整复制模型上下文。

DSH 官方智能体团队插件（DSH内置）目前是实验性的；dsh-agent-lines 是社区插件，不是 DeepSeek 官方产品。

## 它不是什么（和常见多 agent 方案的区别）

选型时先把边界说清楚：

- **不是 DAG / 工作流引擎**：插件不内置任务依赖、状态机、自动验收/返工。流程由负责人按目标、`TEAM.md`「协作流程」和角色提示词编排；需要强管控的子任务，让角色线按 `subteamPolicy` 用 DSH 官方「智能体团队」临时小队（lines 只记录、展示、审计，不硬拦截）。
- **不是聊天机器人花名册**：一等公民是长期角色线（`label` 稳定、Session 可换），带消息邮箱、租约、交接、唤醒；不是只换人设的 Bot。
- **不是 IM / 聊天软件**：消息是工作痕迹（`kind` / `state` / `replyTo` / ack），有投递、确认、审计语义，不做社交。
- **组织基础设施与业务智能解耦**：插件负责角色、消息、持久化、只读看板；怎么拆任务、怎么验收、流程怎么走，归负责人模型和角色提示词。
- **看板只读真实数据**：不编造进度；缺失显示「未采集 / 不可得」。

三种协作方式（同一套底座，可混用）：

1. **固定 SOP**：把顺序和卡点写进 `TEAM.md`「协作流程」与角色提示词，插件只负责送达与留痕；
2. **负责人动态调度（默认）**：manager 按对话拆活、派单、返工、汇总；
3. **局部强管控**：角色线在需要并行或独立验收时，按 `subteamPolicy` 拉起官方 L3 临时小队，任务结束即释放。

## 与 DSH 官方智能体团队插件（DSH内置）的融合（只读，0.5.1 起；0.6.0 增部门视图）

用户只给负责人发任务。负责人自动读取 DSH 官方智能体团队插件（DSH内置）的任务和成员，按成员名字自动对应角色；不要求用户导出任务、不要求配置对应关系、不要求点插件按钮。

前提：负责人必须同时是 DSH 官方智能体团队插件（DSH内置）的负责人或成员；否则显示不可用，不降级到用户导出。

只读：不写任务、不改角色、不触发负责人回合；双向写回未批准。

### 融合后的三级组织

~~~~text
L1 管理线会话（用户只说目标）
  └─ L2 角色线会话（长期角色、持久记忆、line 能力）
       └─ L3 该角色会话里的 DSH 官方智能体团队插件（DSH内置）（teammate，任务型、并行、用完释放）
~~~~

- **L1 管线**：建线、派任务、批策略（`subteamPolicy`）、验收；
- **L2 管活**：拆解任务、决定"自己做还是开内部团队"、产出与自检、把结果回 L1；
- **L3 管并行**：只做被切出来的子任务/交叉验证/一次性质量点，**不是长期角色**；
- 记忆与交付证据在**文件**里；官方任务板的 owner 只能是 teammate（L1/L2 不能当 owner）。

### 谁干活：二级线自己做，还是开线内团队

**默认由 L2 自己做**；满足下列任一条件、且不触犯禁令时才开 L3：

- 需要 ≥2 个独立方案/审查视角（并行验证）；
- 能切成 ≥3 个互不依赖的产出单元（可并行生产）；
- 需要产出后的独立质量点（审读/校对/事实核查）；
- 关键路径长、并行能明显缩短时间窗。

**始终 L2**：需要长期角色记忆与口径 / 同一批文件会写冲突 / 任务小于一个回合 / 需要对用户做最终验收 / 需要跨会话交接。

完整策略（7 个判定维度、A/B 规则、`subteamPolicy` 三档语义、一次委派的标准动作、持续更新机制与复盘指标）：[docs/DELEGATION-POLICY.md](docs/DELEGATION-POLICY.md)。
只读融合的字段与看板：[docs/AGENT-TEAMS.md](docs/AGENT-TEAMS.md)。

> 边界：插件**不自动识别任务、不自动派发、不硬拦截建队**——判断由 L2 的 agent 按上面策略执行；插件负责记录、展示、审计。硬门禁要等官方提供 per-line 上限或 spawn 前拦截 API。

## 团队类型不限于开发

插件不限定团队类型。本质是“一个负责人 + 若干长期成员”的协作方式。
下面用开发团队做示例；小说、视频、研究、运营团队只换角色和任务，不需要改插件或代码。

- 小说：总编、大纲、写手、编辑、校对、审读；
- 视频：负责人、策划、脚本、剪辑、封面、发布；
- 开发：负责人、开发、测试、验收；
- 研究：负责人、资料、分析、写作、审阅。

第一次不需要自己想清楚角色：直接对负责人说“帮我建个小说创作团队，按小说创作的流程建立工作流程与机制”，它会先给团队结构和流程建议，你确认或补充即可。

## 设计思想（为什么这样设计）

一句话：**DSH 会话是人，子 agent 是临时帮手，任务是事，文件是记忆，负责人做编排，质量归角色，用户只说目标。**

支点只有一个：`line = label（稳定身份） + sessionId（可替换载体）`。因为 DSH 里唯一承载跨轮记忆的是 Session，所以长期角色必须落在 Session 上；又因为 Session 会满、会换，所以身份不能绑在 Session 上——`line_retire` / `line_rebind` / `line_handoff` 都是这一条推出来的。

四条硬约定（破坏任意一条即为 bug）：

- 一条线同一时刻最多一个 live owner（本地租约，不是分布式锁）；
- 同一 msgId 在目标 Session 日志中最多生效一次（幂等权威是 DSH，不是 SQLite 队列）；
- label 恒定、Session 可换：换人不换角色，retired 不删历史；
- 对端消息永远是 peer content，永不升格为用户指令。

**明确不做**：exactly-once、跨机多活、进程隔离与插件内策略沙箱、静态加密与发送方签名、官方任务板双向写回、内置组织模板与固定质量门禁、完整 IM。

完整版（不变量 I1–I7、五条取舍的代价、Non-goals、演进规则、术语表）：[docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) ｜ [English](docs/PHILOSOPHY.en.md)。
已知会坏的地方与待修缺口：[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)。

## 版本能力与业务场景

### 0.13.0：Board 2.0 完整对齐（已发布 2026-11-14）

- 总览 5 独立区块（目标+计划双栏 / 工作流 7 阶段 / 节奏 / L1.5 独立 section）；组织页角色与 agent（不挂 L3）；任务页 L1.5→L2 分组；大任务详情 v2 八分区；成员页 v2。
- 全站 Board 2.0 tokens + 窄屏 390；旧样式零残留；BOARD2 默认 on，显式 off 回退 0.12.0 旧视图（legacy 冻结）。
- 无 schema / protocol 变更；工具数 27。

### 0.12.0：看板增强（L1.5 列表 / 独立详情页 / 成员页 / 4 指标）+ 线层任务分层（历史版本，0.13.0 回退位）

- **看板增强**：任务视图顶部新增 L1.5 大任务全量列表（4 指标：L2/L3 数量、agent 执行次数、token 消耗）；大任务独立详情页（甘特，时间轴/表格双视图）；成员独立详情页与统一头像；旧详情抽屉保留为 fallback。
- **本版不含**：总览 5 独立区块重构（目标 / 计划 / 工作流 / 节奏 / L1.5 五区块重排），计划 0.13 评估（见 KNOWN_ISSUES）。
- **数据口径（必须知道）**：L2 时间来自真实消息；**计划时间未采集**；agent 执行次数与 token 是**按线采样的估计**、非账单；**各 workItem 的 token 不可横向加总**。
- **负责人交接 / 线层任务 / 分层**：create:true 新建根 Session、旧负责人退役、任务页默认线层任务并按 taskRef 聚合（原 0.11.6 内容并入）。
- 文档门禁 C14 / C14b / D1；PROTOCOL 错误码 46/46；工具数 27；schema v15 / protocolVersion 0.4 不变。

### 0.11.6：负责人交接 + 旧负责人退役（未单独发布，内容并入 0.12.0）

- 新增 `line_handover_manager`：manager 把负责人角色交给 live 根 Session，0.12.0 起支持 create:true 自动创建新 root。
- `line_claim_manager` / 负责人交接在旧 manager 在线时自动给旧 Session 加 `【退役YYMMDD】` 标题；交接事件写入 line_events。
- 看板任务页默认显示线层任务：按 taskRef 聚合卡片，支持筛选和点击看消息时间线；组织视图 L2 显示线任务、L3 成员显示从 L2 拆分的任务；官方任务保留为次级页签。
- 工具数 26 → 27；无 schema / protocol 变更；schema v15、protocolVersion 0.4 不变。
- 已下线 Session 不能靠插件补 rename（DSH 公开 API 限制）；必须在交接时完成。

### 0.11.5：文章与双语文档

- 新增短版《关于AI组织的思考与探索》与论文版《从流程到岗位：长期 AI 团队的组织设计》，中英各一份；中文文件用中文名，英文文件用英文名。
- README 增加文章入口；文档一致性门禁覆盖中英文章配对。
- 兼容：无代码/DB/协议变更；schema v15、protocolVersion 0.4 不变。

### 0.11.4：CLI 一致 + 去重索引 + 测试假绿修复

- CLI send 新增 `--kind/--task-ref/--parent-task-ref/--task-scope/--subteam-policy/--max-members/--cc-manager/--require-approval/--force-distinct/--dedupe-window`，digest 与工具层同字段；`DSH_AGENT_LINES_DEDUPE_WINDOW_MS` 供插件与 CLI 共用。
- schema v15：messages 增加 `dedupe_digest` 与索引，去重查询由全表 LIKE 改为等值索引；新增 lineTasks 查询索引；旧库自动回填。
- npm 包不再“0 个测试也绿”：`npm test` 先跑 fail-closed 守卫；包内无 test/ 时明确失败，单测需从仓库运行。
- 文档：使用边界补历史说明；README/CHANGELOG/AGENTS 同步 CLI 参数、schema v15；`/api/live.tokens` 的历史兼容说明保留。
- 兼容：protocolVersion 0.4 不变；schema v14→v15 为 additive，升级前请备份 lines.db。
### 0.11.3：使用边界 + 去重修复 + 看板收口（历史）

- 去重窗口改为滑动窗口：跨时间桶边界的相同发送不再重复；CLI 与工具层同语义；补跨桶/窗口外/forceDistinct/self-send/CLI 测试。
- README 正式版化：删除 `0.11.0-13`～`0.11.0-30` 内测构建小节，逐条保留在 CHANGELOG；C6b 门禁只要求覆盖正式版本。
- 看板任务页增加「官方任务 / 线层任务」切换；线层任务从 `kind=task` / `taskRef` 聚合，不伪造 DAG。
- board 启动自动解析 teamRoot sidecar（插件写入），不再静默 off；页脚增加「为什么只读」链接。
- 删除 `/api/live.tokens` 遗留占位字段；成本数据继续由 `/api/team-metrics` 提供。
- 新增 `docs/USAGE-BOUNDARY.md`（中英）：范围/稳定面/会变/已知边界/失效恢复与数据责任。
- 记录 0.11.2 安全清理导致 v0.9.0/v0.10.0/v0.11.0/v0.11.1 四个 tag SHA 变化；按 SHA 固定请改用版本号/npm。
- CI 安装 Chromium 并跑 `test:board-e2e --require-chrome`，e2e 不再 SKIP。
- 兼容：无 DB 迁移（schema v14）、protocolVersion 0.4 不变；`/api/live` 删除 tokens 属 board API 兼容性变更。
### 0.11.2：反馈修复（历史）

- 看板 P1 修复：任务/组织页不再因快照结构差异空白；`/api/team-board` 归一数组/对象/计数并给出诊断；前端 `asArray` + 错误可见 + headless e2e。
- 换代可见：`/api/live` 增加 `oldSessionId/rebinds[]`，组织详情显示每代；历史区包含换代。
- 换人更好用：replace/retire 自动给旧 Session 标题加 `【退役YYMMDD】`；`line_handoff` 支持 `sections/extra` 业务交接。
- 任务阶段改读 TEAM.md `## 协作流程`；replace 返回继承 role；恢复 `/api/live` `counts`；成本页拆分缓存读/输出。
- 无 DB 迁移、无协议变化；`npm run test:board-e2e` 新增。
### 0.11.1：文档补齐（0.11.1 历史）

- 0.11.1 与 0.11.0 功能代码一致，只补文档与站点：README 增加「阅读顺序」和「它不是什么」边界、官网增加「为什么不是普通多 agent 插件」、设计思想补 T6/T7 与边界说明、KNOWN_ISSUES/DEPLOY/AGENTS 同步。
- 0.11.0 发布时用的是 22:43 的初版候选（文档未补齐）；npm 0.11.0 不可覆盖，因此以 0.11.1 补齐文档。
### 0.11.0：团队工作区 + 建完即见 + 数据驱动看板（历史）

- **团队工作区**：`line_init_team` 生成 TEAM.md / charters / decisions / registry；看板五视图（总览/组织/任务/数据/消耗）读真实数据，组织页按 TEAM.md 渲染目标与「协作流程」。
- **建线即见**：`line_create` 默认 onboarding 并等会话 `blank=false` 才返回，成员建完立即出现在 DSH 侧栏；逐次 `bootstrap:false` 不再生效（0.11.0 行为变更）。
- **团队目录跟随工作区**：`teamRoot` 可选；不配时团队落在 manager 当前工作区，配父目录时看板/状态自动解析最新子团队，避免"建到不知道的目录"。
- **token 口径**：`line_metrics`/看板默认 totalTokens（未缓存输入+输出+缓存读写），保留 output 分桶。
- **批量建线**、JSON-safe 批量返回、看板静态演示数据全部清除、UIUX 恢复高保真原型。
- 0.11.0 内测构建 -13～-30 已并入本版；逐条见 CHANGELOG。

### 0.10.0：成本趋势与休眠

场景：团队长期挂着，想知道每天花了多少 token、空闲线怎么停。
用法：line_metrics 看 tokens.today/perDay[]、byLine[].ratePerMinute（估算口径，非账单级）；tokenSampleMs / tokenRetentionDays 控制采样与保留；line_hibernate / line_wake 让空闲线休眠/唤醒（停投递、**该线出站发送也拒绝**、释放 lease、保留 Session/历史；默认不自动唤醒）。
效果：成本可答（按日增量与速率）；采样去重 + 默认 30 天保留；休眠与 retire 区分，显式唤醒。

### 0.9.0：协议版本化与可校验

场景：多个实现或多个插件版本之间要互通，消息出问题要能定位。
用法：消息信封带 protocolVersion（0.4）；用 schema/ 与 conformance/ 自测互操作；line_status.capabilities 看运行环境能力；失败消息用 line_messages / line_trace / line_redeliver 处置。
效果：major 不兼容拒收（LINE_PROTOCOL_MISMATCH）、minor 兼容忽略未知字段；旧消息按 0.3 兼容；schema v13→v14 为 additive（无需手工迁移）；新增 memory transport。

### 0.8.1：打包自包含

场景：拿到发布包（npm/Release asset）要能直接做回测。
用法：解包后直接跑包内脚本：scripts/business-smoke.mjs、scripts/check-docs-consistency.mjs、scripts/check-bento-alignment.mjs。
效果：包内可自跑 9 项业务冒烟与文档/看板门禁；无功能变更。

### 0.8.0：消息可观测与处置

场景：消息发出去没回音或失败，要知道卡在哪、能不能救、会不会重投。
用法：line_messages（按状态查 failed/expired）、line_trace（生命周期时间线）、line_redeliver（失败/过期重投）、line_purge（清理，默认 dryRun）、ackTimeoutMs（只报数）、doctor health。
效果：消息全生命周期可查；失败不丢、可救；ack 超时只标记不自动重投（守 I2）。

### 0.7.0：设计宪法与文档版（无代码行为变更）

场景：想知道"为什么这样设计、什么不能碰、哪些永远不会做"，或者要给外部实现对齐。
用法：读 [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) 与 [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)；CHANGELOG 起分「破坏性 / 非破坏性」两栏。
效果：不变量 I1–I7、五条取舍、Non-goals 成文；已知边界与待修缺口分级列出；**插件行为不变**。
说明：看板只读裁剪**实际已在 0.6.6 发布**，0.7.0 不再重复声明 breaking。

### 0.6.6：Web 看板 UIUX 验收版

场景：需要按 UIUX 线的 Bento 规范（DESIGN-SPEC §11，2026-11-09 定稿）看组织/任务/部门/沟通/数据。
用法：dsh-agent-lines board --port 4090 --db $DSH_HOME/agent-lines/lines.db。
效果：只读；固定四槽、同行等高、卡内滚动、data-level、面包屑；看板侧不做操作/消息。

### 0.6.5：负责人本地操作

场景：负责人在 Web 看板上直接发消息、批准/拒绝 pending、生成 handoff。
用法：dsh-agent-lines board --port 4090 --db $DSH_HOME/agent-lines/lines.db；用启动日志 token。
效果：本地 token 保护；默认 127.0.0.1；POST 后 /api/live 刷新消息数；不硬拦截。

> 注意：**0.6.6 起看板已改为只读**，本节是 0.6.5 的历史记录，当前版本不可用；当前边界见「限制」。

### 0.6.4：只读 Web 看板

场景：负责人不想每次让模型调工具，想直接在浏览器看团队任务/部门。
用法：dsh-agent-lines board --port 4090，打开 http://127.0.0.1:4090/。
效果：只读；读取 team-board.json / team-board.<line>.json / team-metrics.json；默认只绑 127.0.0.1。

### 0.6.3：统一数据看板

场景：负责人要一个只读数据面，看任务/线/子团队统计和消息趋势。
用法：line_metrics({ days }) 返回任务/线/子团队当前统计、消息 kind/state 与按日趋势、每线 token 当前值。
效果：明确标注官方任务无时间字段、无每任务 token；不伪造趋势。

### 0.6.2：会话沟通看板

场景：负责人要查看线与线、线与本线官方团队之间的工作消息。
用法：line_communications({ line/taskRef/kind/state/limit }) 只读筛选。
效果：返回消息和关联任务字段；不暴露官方内部子 agent 私聊；不改消息状态。

### 0.6.1：内部团队策略 + 审计

场景：负责人给角色线派任务时，要限制是否允许建内部团队、最多几人。  
用法：line_send 带 subteamPolicy（auto/ask/never）与 maxMembers；看板显示线级策略和审计。  
效果：line_team_board.lines[] 显示该线策略；line_department_board 返回 task 策略与 subteamAudit；只记录/展示/审计，不硬拦截官方 spawn。

### 0.6.0：三级组织 + 部门视图

场景：负责人下面有多条长期角色线，每条线自己也带官方团队。  
用法：负责人调用 line_department_board({ line }) 按线懒取该线的官方团队、任务、摘要、消息。  
效果：组织树三级；上级只看部门摘要，不合并下级任务板；taskScope 防止同名 task id 串味。

### 0.5.1：官方团队看板接入 + 主机快照

场景：团队既有长期角色，又想看DSH 官方智能体团队插件（DSH内置）的任务板。  
用法：负责人调用 line_team_board；插件自动读官方任务/成员并写 team-board.json。  
效果：只读融合；不要求用户导出/配置；同版本补齐 messages/quality/team/approval/deliveries 契约。

### 0.4.1：管理线看得到跨线消息

场景：成员线之间直接同步，管理线需要知道发生了什么，但不希望每条消息都打断自己。  
用法：line_observe({ line: "writer", limit: 20 }) 或 CLI observe --json。  
效果：只读 feed，显示 from/to/state/摘要；不注入 prompt、不改消息状态；line_send 语义不变。

### 0.3.8：什么时候该换线

场景：管理线想知道哪条线快满了、哪条线最近没动静。  
用法：line_status / line_list 看 activity.level、turns、steps、lastActivityAt。  
效果：给出低/中/高活跃度，不伪造“上下文使用率 78%”；真实窗口等 DSH 上游提供。

### 0.3.7：换人之前先交接

场景：新写手不知道旧线做到哪、下一步是什么、哪些坑不能踩。  
用法：line_handoff({ line: "writer", format: "md" })。  
效果：生成结构化交接单（进度、积压、最近消息、生命周期），不调用模型；新线先读交接单再继续。

### 0.3.6：上下文满了，角色可以换人

场景：写手线连续工作很久，上下文配额耗尽；继续写容易出现前后矛盾。  
用法：管理线调用 line_create({ label: "writer", replace: true, force: true, reason: "context full" })。  
效果：同一个 label 切到干净 Session，旧 Session 只 retired、不删除；queued/claimed 消息迁移，delivered/acked 不重投；管理线不需要手工改路由。

## 安装

### 让 DSH 帮你装（推荐给新手）

在 DSH 新会话里说：

~~~text
帮我检查并安装 GitHub 上 Lencen/dsh-agent-lines 插件。
只从官方仓库或官方 npm 安装，不要从其他 fork 安装。
安装前先告诉我准备执行什么命令，等我确认后再执行。
安装完成后按插件要求加载；如果需要重启 DSH Web，先告诉我重启后打开哪个地址、
怎么新开会话、第一句该说什么，并提醒当前会话会断开；等我确认后再重启。
~~~

重启后当前会话会断开，agent 无法再自动通知你；重启后的步骤会在重启前给你。

### 手动安装

一条命令安装（推荐，不需要自己找 profile）：

    curl -fsSL https://raw.githubusercontent.com/Lencen/dsh-agent-lines/main/install.sh -o install.sh
    bash install.sh

脚本会自动选择 DSH Web 使用的 profile，安装后检查 agent-lines 是否可用；如果判断不了，会列出已有配置并提示你怎么指定。

**安装或更新后必须重启 DSH Web。** 运行中的进程不会加载新插件代码。插件没有 config 时走零配置：启动一条未绑定 manager，根会话可以调用 line_claim_manager 自己绑定。显式“管理线配置”是可选的，用于固定 manager/worker。

离线或 npm 不可用时，用本地 tarball：

    bash install.sh ./dsh-agent-lines-0.12.0.tgz

安装并重启后，不写配置也可以直接使用；需要固定管理线/worker 时，再把下面“管理线配置”粘贴到脚本打印的配置文件。

### 管理线配置（可选）

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

### 新线 bootstrap

管理线调用 line_create 创建新线时，插件默认排队一条不要求执行任务的 onboarding 消息，让空白 Session 产生第一条消息并出现在侧栏；传 bootstrap: false 可关闭。

line_status / line_list 会返回 materialized、visibleInSidebar、bootstrapQueued；新线在首条消息前可能仍是 blank。

## 快速开始

1. 运行上面的安装脚本。
2. **重启 DSH Web**，让插件加载。
3. 打开任意根会话。零配置路径不需要改 YAML。
4. 先调用 line_status；如果当前会话未绑定，调用 line_claim_manager({ confirm: "bind-manager" })。
5. 直接说“按首次使用创建团队”，然后等它建好成员线；第一个任务再单独发。

## 首次使用：组建开发团队

在新根会话里直接复制下面这段。它会先绑定管理线，再创建一支团队；后续任务再单独发，不要让它自己开工。

> 使用 dsh-agent-lines。先把这个会话设为开发团队的管理线；如果还没绑定，就先完成绑定。
>
> 你是开发团队负责人：负责任务拆解与分配、协调沟通、跟踪进度、汇总结果、总结汇报。你只做管理和协调，不执行具体开发任务。
>
> 请组建开发团队。成员名字用简短英文，岗位用中文：research（调研）、architecture（架构）、uiux（UIUX）、dev（开发）、test（测试）、acceptance（验收）、release（发布）、ops（运维）。
>
> 团队建好后先待命，不要自动开工，等我发第一个任务。

成员名字用英文短名，中文放在岗位上。这个提示词只创建一个团队；0.3 不支持同一插件实例同时多个团队。

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

负责人先建好团队，后面才是具体任务。

1. 负责人按角色建立成员：调研、架构、UIUX、开发、测试、验收、发布、运维。
2. 你给负责人一个具体任务，例如“给报表页加 CSV 导出，带测试和一页 runbook”。
3. 负责人把任务拆开，派给对应的成员；每条消息都会留在本地。
4. 成员收到任务、执行、确认收到，需要时回复负责人。
5. 负责人收集结果，处理成员之间的分歧，统一口径。
6. 你看到负责人的汇总；每个成员保留自己的上下文和消息记录。

这只是“用提示词组织团队”的方式，不是插件内置的组织架构；怎么拆任务由负责人模型决定。技术细节（消息、状态、工具）在下面的“使用”和“投递语义”。

## 上下文活跃度

line_status / line_list 返回 activity：turns/steps/decodeTokens/level/lastActivityAt。
level 是活跃度代理（low/medium/high），不是上下文使用率百分比；DSH 当前不暴露上下文窗口。

## 团队成本趋势（0.10.0 起）

`line_metrics` 按日展示 token 增量与速率（估算口径，非账单级）：`tokenSampleMs` 控制采样频率，`tokenRetentionDays`（默认 30 天）控制样本保留；值未变化时不重复采样。

## 消息可观测与处置（0.8.0 起）

失败态不再是黑洞，四个工具 + 一个 CLI：

- `line_messages({ line?, states?, since?, limit? })`：按状态查消息（含 `failed`/`expired`），返回 `counts.byState`；管理线可查任意线，其它线只能查自己。
- `line_trace({ messageId })`：单条消息的完整生命周期（每次状态变化的时间、attempt、actor、错误），来自 `message_events`。
- `line_redeliver({ messageId, to?, resetAttempts? })`：管理线专用；只对 `failed`/`expired` 生效，可改投同 agent 的其它线，保留 hop、写审计事件。
- `line_purge({ before, states?, dryRun? })`：管理线专用；`before` 必填、`dryRun` 默认 true、默认只清 `failed`/`expired`/`acked`，删除前写 `purged` 审计事件。
- `ackTimeoutMs`（默认 600000）：`delivered` 超过该时长只**标记 + 报数**（`line_metrics.messages.ackOverdue`），**绝不自动重投**（否则会破坏 I2）。
- CLI：`dsh-agent-lines --json doctor` 输出 `health { failed, expired, ackOverdue }` 并给出下一步命令；`tail --line` 看全状态。

## 使用

管理线可以完全由对话驱动：

> 你是管理线。用 `line_create` 创建 frontend-line、backend-line、ops-line，然后用 `line_list` 确认。

工具：

| 工具 | 作用 |
|---|---|
| `line_status` | 只读：当前会话绑定、manager Session 是否存在/live、线列表、修复命令；未绑定也可见；含 activity 活跃度（不是 contextUsage） |
| `line_claim_manager` | 把当前 live 根 Session 绑成 manager；需要 `allowClaim: true` 和 `confirm: "bind-manager"`；全局工具，不需要 shell；旧 manager 在线时自动加退役标题 |
| `line_handover_manager` | 仅管理线：把负责人角色交给 live 根 Session；`create:true` 自动创建新 root；旧 manager 在线时自动加退役标题 |
| `line_list` | 列出线、状态、未读数、当前线和 role |
| `line_create` | 仅管理线：创建新线；同 label 幂等；传 replace:true 可给同 label 换新 Session |
| `line_handoff` | 仅管理线：生成结构化交接单（JSON/Markdown），不调模型 |
| `line_observe` | 仅管理线：只读跨线消息 feed；显示 kind/审批状态，不注入 prompt、不改状态 |
| `line_manager_ack` | 仅管理线：对 pending_approval 的 task 做 approve/reject |
| `line_team_board` | 仅管理线：只读融合看板；自动读 Agent Teams 任务/成员 + lines，无用户导出/配置 |
| `line_retire` | 仅管理线：软下线；拒绝新发送，保留 Session/历史 |
| `line_rebind` | 仅管理线：把线原子切到新的 live Session，可迁移积压 |
| `line_rename` | 仅管理线：改侧栏标题，持久化到 lines.db |
| `line_move_workspace` | 仅管理线：把已有线的 Session 挂到路径完全匹配的工作区 |
| `line_send` | 发到 `line` 或 `agent#line`；可选 `kind`、`ccManager`、`idempotencyKey`、`replyTo`、`noReply`、`forceDistinct`、`ttlMs` |
| `line_inbox` | 读当前线已投递消息 |
| `line_ack` | 确认已处理 |

除 `line_status`、`line_claim_manager` 外，line 工具只注册在已绑定线的 Session 上；这两个控制工具是全局的：status 只读，claim 仅限根会话且受 allowClaim 控制。

`line_create` 在管理线所属工作区（没有工作区时回退当前目录）创建普通 DSH Session；它**不会**创建独立 OS 进程、profile 或端口，也不转移已有 Session。

### 上下文满时换人

线不会自动继承旧 Session 的上下文。推荐流程：

1. 让旧线写交接单（0.3.7 起可用 `line_handoff`）；
2. 管理线调用 `line_create({ label, replace: true, force: true, reason: "context full" })`；
3. 插件创建干净 Session、同 label 原子切换，旧 Session 标记 retired 但保留；
4. queued/claimed 消息迁移到新线；delivered/acked 留在旧 Session，不重投。

`migrate: "none"` 时若还有 queued/claimed 会直接报 `LINE_BACKLOG_NOT_EMPTY`，不会静默切走。

创建的线会记录 `created_by`，进程重启时由管理线恢复。line_create 会解析管理线所属工作区并传 workspaceId（DSH 会自动 attach），所以新线出现在该工作区而不是“未分组”；如果管理线本身不在工作区，则回退 cwd，线保持未分组。传 `workspace`（已有路径或 id）可指定其他工作区。若某条线的 Session 还从未落盘，首次投递可能 `session/not-found`；给它发一条任务（或重新创建）即可让它持久化。

CLI：

```bash
dsh-agent-lines list
dsh-agent-lines send --from frontend-line --to backend-line --text "hi"
dsh-agent-lines send --from manager --to writer --text "写第 1 章" --kind task --task-ref T-1
dsh-agent-lines send --from manager --to writer --text "告警" --kind alert --cc-manager
dsh-agent-lines send --from manager --to writer --text "重复测试" --dedupe-window 60000
dsh-agent-lines inbox --line backend-line
dsh-agent-lines ack --line backend-line --id msg_...
dsh-agent-lines --json observe --line writer --limit 20
dsh-agent-lines claim --agent agent-demo --line manager --session "$DSH_SESSION_ID"
dsh-agent-lines doctor
```

用 `--db` 或 `DSH_AGENT_LINES_DB` 指向插件同一个数据库；CLI 与插件的窗口可用 `DSH_AGENT_LINES_DEDUPE_WINDOW_MS` 共享。CLI 的 `--kind task` 默认 `ccManager` 为 true；需要进入审批时加 `--require-approval`。

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

~~~text
dsh-agent-lines/
├── Manager Line            # 负责人线（createFrom）：拆解、调度、汇总
│   ├── line_create         # 创建成员线（仅 manager 可调用）
│   ├── line_send           # 向成员派活 / 回消息
│   ├── line_inbox          # 接收成员回报
│   └── line_messages / line_trace / line_redeliver / line_purge   # 可观测与处置（0.8.0+）
├── Worker Line             # 成员线：执行具体任务
│   ├── (持久化记忆)         # 会话重启后上下文保留
│   └── line_inbox / line_ack
├── DSH 官方智能体团队插件（DSH内置）    # 任务板 / 依赖 / 面板（只读融合）
└── lines.db                # 本地状态：线、角色、消息、事件、租约
~~~

DSH 适配层负责线身份和“把消息送进 Session”；transport 负责持久消息和跨进程存储。默认是本地 SQLite。公开架构说明：[English](docs/ARCHITECTURE.en.md) | [中文](docs/ARCHITECTURE.md)。

## 要求

- DSH `>=0.2.1-rc.5 <0.3.0`
- Node.js `^22.19.0 || >=24.0.0`
- 本地文件系统（NFS/CIFS/SMB/FUSE 会被拒绝）

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

## 消息类型与任务审批

`line_send` 支持四种 kind：

| kind | 含义 | 非管理线发送 |
|---|---|---|
| info | 信息同步 | 直接投递 |
| request | 请求协助 | 直接投递 |
| task | 派任务 | 进入 pending_approval，管理线 approve 后才投递 |
| alert | 告警 | 直接投递 |

管理线发 task 不进入审批。管理线用 `line_observe` 看 pending，再用 `line_manager_ack({ messageId, decision: "approve" | "reject" })` 决定。

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
- 接收方离线时消息留在队列；插件不会自动拉起进程。
- **一个 Session 只能有一个 writer。** 不要在另一个 DSH 进程（例如主 Web UI）里打开某条线的 Session；否则会 `session/writer-held`。关掉另一个视图，或给线独立 Session。

## 安全

- 插件在 DSH Host 进程内运行，拥有主机权限；只安装可信包。
- 默认本地 SQLite，不开网络监听。
- 只有 `createFrom` 管理线能建线；`maxLines` 限制增长。
- 对端消息在 prompt 里明确标为 peer content，不是用户指令。
- 详见 [docs/SECURITY.md](docs/SECURITY.md)。

## 限制

- 不能把 Session 迁移到不同目录（`line_move_workspace` 只在 Session cwd 与 workspace path 完全一致时可挂载）；换人用 `line_handoff` / `line_rebind` / `line_create({ replace: true })`。
- 多线是同进程多 Session，不是进程隔离。
- 一个插件实例只支持一个 manager/团队；同一个 DSH 进程里同时跑开发、小说等多个团队不支持；独立 profile/DB 只是临时 workaround，不是产品模型。
- 没有 `line_delete`；建线会产生持久行，测试也会留下真实记录。
- 空白线 Session 可能需要第一条任务后才落盘。
- 一个 Session 只能有一个 writer；不要从另一个 DSH 进程打开线 Session。

## 状态

当前发布 `0.12.0`（快速迭代期）。请同时锁定 DSH 与插件版本；升级前读 CHANGELOG / KNOWN_ISSUES。

## 致谢

- 人类 vibecoding：**Lencen**
- 开发 agent：**DeepSeek Harness agent (DSH)**
- 使用模型：**deepseek v4.1 flash 1017**
- 邮箱：[iamlencen@qq.com](mailto:iamlencen@qq.com)

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)；行为准则 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；文档站 [lencen.github.io/dsh-agent-lines](https://lencen.github.io/dsh-agent-lines/)。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
## 团队创建命名规范（0.12.0 起）

- **label**：小写 kebab（如 dev、qa、release），团队内唯一，建议等于角色；沿用既有匹配规则，不允许中文/大写。
- **title**：创建时必须显式给中文角色名（不要依赖默认 role/label；title 不建议等于 label）。
- **侧栏标题**：推荐「<角色名>（<label>）」；团队名可得时「<团队名> · <角色名>（<label>）」。
- **三处名称应一致**：DB title / DSH 侧栏标题 / 章程头部「# <角色名>（<label>）章程」；不一致会出现「侧栏看到的 ≠ 看板/负责人看到的」。
- **存量团队不强制改名**：用 line_list 自查，必要时 line_rename 修正；只读检测接口（titleCheck）在 0.13 提供。
