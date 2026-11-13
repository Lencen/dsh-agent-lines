# 更新记录

[English](CHANGELOG.en.md) | 中文

## 0.12.0 (2026-11-26)

### 看板增强（L1.5 列表 / 独立详情页 / 成员页 / 4 指标）+ 线层任务分层

- **看板增强**：任务视图顶部新增 L1.5 大任务全量列表（4 指标：L2/L3 数量、agent 执行次数、token 消耗）；大任务独立详情页（甘特，时间轴 / 表格双视图）；成员独立详情页 + 统一头像组件；旧详情抽屉保留为 fallback。
- **数据口径（必须知道）**：L2 时间来自真实消息（firstAt/latestAt）；**计划时间 planned 未采集**；agent 执行次数与 token 消耗是**按线采样的估计**，不是账单口径；**各 workItem 的 token 不可横向加总**（采样窗口 / 线 / 会话可能重叠）。
- **负责人交接**：line_handover_manager 支持 create:true 自动新建根 Session；旧负责人自动退役（原 0.11.6 内容并入）。
- **线层任务与分层**：看板任务页默认线层任务，按 taskRef 聚合、L2/L3 分层、详情抽屉；LINE_TASKS 暴露 parentTaskRef、byTaskRef 不覆盖快照（PARENT-REF v0.4）。
- **文档门禁**：C14 / C14b / D1；docs consistency 15 → 18；PROTOCOL 中英错误码 46/46。
- **已知限制（0.13 backlog）**：总览 5 独立区块重构（目标 / 计划 / 工作流 / 节奏 / L1.5 五区块重排）**本版未包含**，计划 0.13 单独评估。
- 工具数 27；schema v15、protocolVersion 0.4 不变；无 DB 迁移。
- **0.11.6 未单独发布，其内容已并入本版。**

## 0.11.6 (2026-11-11，未单独发布；内容并入 0.12.0)

### 负责人交接 + 旧负责人退役

- **负责人交接工具**：新增 line_handover_manager（manager-only，confirm: "handover-manager"），把负责人角色交给已存在的 live 根 Session；不创建 root Session。
- **旧负责人自动退役**：line_claim_manager 与 line_handover_manager 在旧 manager 在线时自动给旧 Session 标题加 【退役YYMMDD】；交接写入 line_events（rebind）。
- **看板任务页默认显示线层任务**：线层任务为主页签，按 taskRef 聚合为卡片列表，支持状态筛选与点击查看消息时间线详情；组织视图 L2 显示线任务、L3 成员显示从 L2 拆分的官方任务；官方任务保留为次级页签。
- **工具数 26 → 27**；无 schema / protocol 变更；schema v15、protocolVersion 0.4 不变。
- **边界**：已下线 Session 不能靠插件补 rename（DSH 公开 API 限制）；必须在交接时完成。

**0.11.6 未单独发布；当前发布以 0.11.5 为准，0.11.6 内容并入 0.12.0。**

## 0.11.5 (2026-11-11)

### 文章与双语文档

- 新增短版文章《关于AI组织的思考与探索》（中英）：中文文件使用中文名 docs/关于AI组织的思考与探索.md，英文文件使用英文名 docs/en/THOUGHTS-ON-AI-ORGANIZATION.md。
- 新增论文版《从流程到岗位：长期 AI 团队的组织设计》（中英）：中文 docs/从流程到岗位.md，英文 docs/en/FROM-WORKFLOW-TO-POSITION.md。
- README 增加文章入口；文档一致性门禁增加两对中英文章配对；站点版本同步到 0.11.5。
- 兼容：无代码、schema、协议变更；schema v15、protocolVersion 0.4 不变。

**以 0.11.5 为准，0.11.4 为回退位。**

## 0.11.4 (2026-11-11)

### CLI 一致 + schema v15 去重索引 + 测试假绿修复

- **CLI 与工具层一致**：send 增加 --kind/--task-ref/--parent-task-ref/--task-scope/--subteam-policy/--max-members/--cc-manager/--require-approval/--force-distinct/--dedupe-window；digest 使用与工具层相同的 11 个字段；DSH_AGENT_LINES_DEDUPE_WINDOW_MS 供插件与 CLI 共用。
- **schema v15**：messages 增加 dedupe_digest 列与 messages_dedupe 索引；去重查询从 LIKE 全表扫描改为等值索引；新增 messages_kind_created / messages_task_ref_created 服务 lineTasks；旧窗口 key 自动回填。
- **测试假绿修复**：npm test 先跑 scripts/check-test-set.mjs；包内无 test/ 时明确失败（不再 0 tests 也 exit 0），单测需从仓库运行；CI 增加“包内测试必须 fail-closed”的反例校验。
- 文档：USAGE-BOUNDARY 补 0.11.2 及之前跨桶重复、0.11.3 修复的历史说明；README/AGENTS 同步 CLI 参数/schema v15。
- 兼容：protocolVersion 0.4 不变；schema v14 -> v15 为 additive；升级前备份 lines.db，不建议降级。

**以 0.11.4 为准，0.11.3 为回退位。**
## 0.11.3 (2026-11-11)

### 使用边界 + 去重修复 + 看板收口

- **去重窗口修复**：改固定时间桶为滑动窗口（store 层 BEGIN IMMEDIATE 查最近 windowMs 内同 digest），跨桶边界不再重复；CLI 与工具层共用；新增跨桶/窗口外/显式 key/forceDistinct/self-send/CLI 测试。
- **README 正式版化**：删除 0.11.0-13 至 0.11.0-30 内测构建小节（逐条保留在本 CHANGELOG），C6b 门禁只要求覆盖正式版本。
- **看板线层任务视图**：任务页可切换「官方任务 / 线层任务」；/api/live.lineTasks 只读聚合 kind=task/taskRef，不伪造 DAG。
- **teamRoot sidecar**：插件把配置的 teamRoot 写入 db 同目录 team-root，board 启动按「参数 → env → sidecar」解析并打印结果。
- **只读说明**：看板页脚增加「为什么只读」链接。
- **/api/live.tokens**：删除 0.11 早期遗留 unavailable 占位字段；成本数据仍来自 /api/team-metrics。
- **使用边界文档**：新增 docs/USAGE-BOUNDARY.md 与英文版，README 引用并加一句摘要；不写早期/评分/无 SLA 等描述。
- **CI**：安装 Chromium，运行 test:board-e2e --require-chrome；e2e 不再是 SKIP。
- **历史注记**：0.11.2 安全清理导致 v0.9.0/v0.10.0/v0.11.0/v0.11.1 四个已发布 tag 的 target/commit SHA 变化；按 SHA 固定请改用版本号/npm。已发布 tag 不再 force-push/重指。
- 兼容：无 DB 迁移（schema v14）、protocolVersion 0.4 不变；删除 /api/live.tokens 属 board API 兼容性变更。

**以 0.11.3 为准，0.11.2 为回退位。**
## 0.11.2 (2026-11-11)

### 反馈修复：看板渲染、换代、交接与兼容字段

- **P1-04**：`/api/team-board` 快照归一（数组/对象 map/仅计数）+ `tasksShape/tasksDiagnostic`；前端 `asArray`、错误可见、任务空态四态；新增 headless `board-render-e2e`。
- **P1-01**：`/api/live` 每线增加 `oldSessionId` 与 `rebinds[]`（line_events 单 SQL 聚合），看板「版本与交接」显示换代。
- **P1-02**：`line_create({replace})` / `line_retire` 自动把旧 Session 标题改为 `【退役YYMMDD】原标题`；失败降级不影响主流程。
- **P1-03**：`line_handoff` 增加可选 `sections`（当前/待办/口径/坑）与 `extra`，超长截断并返回 `truncated`。
- **P2-02**：历史区包含换代（旧/新 sessionId、原因）；**P2-04**：replace 返回继承 role/title；**P2-05**：恢复 `/api/live` 兼容 `counts`；**P2-06**：任务阶段读 TEAM.md `## 协作流程`，缺失显示「未采集」。
- **P3-01**：TEAM.md 模板加填写提示；**P3-02**：成本页拆分缓存读/输出/未缓存输入。
- 兼容：无 DB 迁移（schema v14）、protocolVersion 0.4 不变；新增脚本 `scripts/board-render-e2e.mjs`（`npm run test:board-e2e`）。
- 安装/打包/CI：`install.sh` 默认改为 `@latest`（本地有当前版本 tgz 时用本地包），移除写死的 0.7.0；README 去除 0.6.0 tarball 示例、注明 0.6.5 为历史只读前记录；删除死文件 `web/board.v11-port.html`；新增 GitHub Actions `ci.yml`（Node 22/24 跑 npm test + pack dry-run）。

**以 0.11.2 为准，0.11.1 为回退位。**
## 0.11.1 (2026-11-10)

### 文档补齐（与 0.11.0 功能代码一致）

- 补 README「阅读顺序」与「它不是什么（DAG/工作流引擎、聊天机器人花名册、IM 的区别；组织底座 vs 业务智能）」；
- 官网补「为什么不是普通多 agent 插件」、阅读顺序、0.11.1 版本；设计思想补边界句与 T6/T7；KNOWN_ISSUES/DEPLOY/AGENTS 同步。
- 无代码、无协议、无 DB 迁移（schema v14 / protocolVersion 0.4 不变）。
- 说明：0.11.0 发布时使用了文档未补齐的初版候选；npm 不可覆盖，故以 0.11.1 补齐。

**以 0.11.1 为准，0.11.0 为回退位。**
## 0.11.0 (2026-11-10)

### 团队工作区、真实数据看板与"建完即见"

- 新增团队工作区（line_init_team）：TEAM.md / charters / decisions / registry；看板五视图读真实数据，组织页按 TEAM.md 渲染目标与可选「协作流程」。
- **建线可见性行为变更**：line_create 始终 onboarding 并等待会话 blank=false 后返回；逐次 bootstrap:false 被忽略（部署级 bootstrapOnCreate:false 仍可关）。属于体验变更，非协议 breaking。
- **团队目录跟随工作区**：teamRoot 可选；未配置时团队落在 manager 当前工作区；父目录自动解析最新子团队，line_status 同步发现。
- **token 口径**：line_metrics/看板默认 totalTokens（未缓存输入+输出+缓存读写），保留 output 分桶。
- 批量建线 lines[]；批量 replace 返回 JSON-safe；看板原型静态演示数据全部移除，缺失显示"暂无/不可得/未采集"。
- 无 DB 迁移、无协议变更（schema v14 不变）。

**以 0.11.0 为准，0.10.0 为回退位。**
## 0.11.0-30（内测构建，已并入 0.11.0）

### teamRoot 语义统一：工作区父目录 / 当前工作区回退（S5n）

- `line_init_team({teamName})`：显式 `teamRoot` > 配置 `teamRoot` > **manager 当前工作区（cwd）**；团队目录 = base/<teamName>。不配 `teamRoot` 也能把团队建在当前工作区。
- `teamRoot` 可以是**工作区父目录**：`line_status.teamWorkspace` 与看板都会自动解析最新子团队；也可以直接给团队目录。
- `line_status` 在未配置 `teamRoot` 时，从当前 Session cwd 找团队（工作区/<团队名>），不再显示 disabled。
- 文档：AI-USAGE 说明"不配就落当前工作区"；AGENTS 更新 teamRoot 语义。
- 无 DB 迁移、无协议变化。

## 0.11.0-29（内测构建，已并入 0.11.0）

### 看板 --team-root 支持父目录自动跟随团队（S5m）

- `--team-root` 给父目录且该目录没有 TEAM.md/registry.json 时，看板自动解析到最新创建的子团队（mtime），新建团队后刷新即可看到，无需改参数/重启。
- 每个团队的目标/协作流程仍读各自 TEAM.md（`## 协作流程`），不同团队不会串流程。
- 无 DB 迁移、无协议变化、只读。

## 0.11.0-28（内测构建，已并入 0.11.0）

### 建线默认立即可见（bootstrap:false 失效）（S5l）

- 用户反馈：`bootstrap:false` 建出的线在 DSH Web 侧栏看不到，体验不可接受；**可见性优先于 token**。
- 现行为：`line_create` 始终发送 onboarding（除非部署级配置 `bootstrapOnCreate:false`），并**等待新会话 `blank=false`** 后再返回（结果含 `visibleInSidebar`、`bootstrapForced`）；批量结果同样带这些字段。
- 逐次 `bootstrap:false` 保留参数但被忽略（兼容旧调用）；文档改为"不要靠隐藏线省 token"。
- 无 DB 迁移、无协议变化。

## 0.11.0-27（内测构建，已并入 0.11.0）

### 看板「协作流程」改为数据驱动（S5k）

- 「组织 → 协作流程」此前是原型里的**静态 demo**（需求/架构/开发/评审/测试/验收/发布 + 来源 README.md·2026-11-04），换团队后仍显示开发流程；现改为读取 `TEAM.md` 可选小节 `## 协作流程`（`→`/顿号/逗号/每行一条皆可），缺省显示「未采集」。
- `parseTeamGoal` 新增 `workflow` 字段；`/api/live` 的 teamGoal 随之带出。
- 文档：TEAM-WORKSPACE 补 2e 协作流程小节；AI-USAGE 补「可选第五节」。
- 无 DB 迁移、无协议变化、只读。

## 0.11.0-26（内测构建，已并入 0.11.0）

### 修复 line_create 批量 replace 输出非 lossless JSON（S5j）

- 现象：`line_create({lines:[...], replace:true, ...})` 在 DSH 里报 `tool "line_create" returned invalid output: value is not lossless JSON`。
- 原因：批量返回的每个 item 里 `lifecycle` 取自 create/replace 结果；replace 路径没有 `lifecycle` 字段 → `undefined`，DSH 工具输出要求 lossless JSON，拒绝并报错。**操作本身已执行完**（rebind/title 事件已落库），只是返回校验失败。
- 修复：批量 item 统一做 JSON-safe 归一（`sessionId/role/title/lifecycle` 缺失给 null，新增 `replaced:true|false`），不再出现 undefined。
- 新增回归测试：batch replace 输出可 JSON round-trip 且递归无 undefined。
- 无 DB 迁移、无协议变化。

## 0.11.0-25（内测构建，已并入 0.11.0）

### token 统计切到 totalTokens（输入+输出+缓存）（S5i）

- 采样读取 DSH `tokenUsage` 投影（uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens），按 **totalTokens = 未缓存输入 + 输出 + 缓存读写** 记录；token_sample detail 同时保留各分桶。
- `line_metrics.tokens` 默认口径改为 totalTokens：顶层 `total/today/window/perDay[]` 是总 token；新增 `outputTotal/todayOutput/windowOutput/perDayOutput`、`inputTokens/cacheReadTokens/cacheWriteTokens`；byLine 同步给分桶与 totalTokens。
- 看板成本/按线消耗/按日 token 全部改读 totalTokens；采样去重比较全部分桶（任一变化即记录）。
- 文档：AI-USAGE 更新 token 口径（totalTokens 才是 DSH 统计口径，output 不是总成本）。
- 无 DB 迁移、无协议变化、只读。

## 0.11.0-24（内测构建，已并入 0.11.0）

### 批量建线 + 采样不足显示 + token 口径（S5h）

- `line_create` 支持批量 `lines:[{label,role?,title?}]`：一次调用建多条，返回 `{created,skipped,failed,counts}`；已存在 label 记为 skipped、单项失败不中断。用于减少 manager 建团队时的模型步数（每步都要重发上下文，是 DSH 总 token 的大头）。
- 看板成本卡：token 采样数 < 2 时「今日/近 7 天」显示 **采样不足**，并显示 **累计 decodeTokens**（此前首分钟显示 0k，容易被误读成没花钱）。
- 文档：AI-USAGE 补批量建线示例与 **token 口径**——decodeTokens 仅生成 token，DSH 统计总 token（含输入/缓存）实测可差 30–80 倍（干净环境实测：manager 会话 64 步，output 71,400，cacheRead 5,758,848，total 5,916,491）。
- 无 DB 迁移、无协议变化、只读。

## 0.11.0-23（内测构建，已并入 0.11.0）

### line_init_team 参数修复 + 决策状态（S5g）

- 修复：`line_init_team({teamRoot, teamName})` 同时给两个参数时，此前 teamRoot 直接生效、teamName 被忽略，文件被平铺到父目录（agent 只能"先生成再 mv"，并触发 DSH 覆盖写前需 read 的报错链）。现在 teamRoot 视为父目录、teamName 为子目录；只给其一行为不变。
- `decisions/*.md` 支持可选 `## 状态`（如「已采纳」）；看板「需要我决策」只显示待决策项，已处理项不再当作待决策（显示"已处理 N 条"），KPI 待决策数同步修正。
- docs：AI-USAGE 补参数规则与 decisions 约定（初始化留痕不要写 decisions/）；TEAM-WORKSPACE 补 decisions 状态小节。
- 无 DB 迁移、无协议变化、只读。

## 0.11.0-22（内测构建，已并入 0.11.0）

### 看板按线图补负责人 + 低 token 建团队文档（S5f）

- 数据/消耗视图「按线任务 / 消息 / 消耗」补上 **manager（负责人）** 一条（此前 DATA.agg 只含角色线，manager 被排除）；「消息数」改为按线真实统计（来自 team-board.messages 的 from/to），不再恒为 0。
- `docs/AI-USAGE.md` 新增「低 token 建团队」：建线传 `bootstrap:false`（实测 8 条线省约 6.5 万 tokens）、建团队只调一次 `line_status`、阶段内不调 metrics/board、机械流程用低 reasoning/便宜模型。
- 无 DB 迁移、无协议变化、只读。

## 0.11.0-21（内测构建，已并入 0.11.0）

### 文档：agent 使用手册 v2（S5e）

- 重写 `docs/AI-USAGE.md`：五步建团队（含 teamName 必填、TEAM.md 与 charters 四节要求）、看板说明（启动命令、五视图、版本号来源、数据来源与「暂无/不可得/未采集」口径、`status --json`）、常用工具表、关键规则、**常见错误码 → 下一步**、一次验收清单、更多文档索引。
- 与 0.11.0-20 看板行为对齐（真实数据、插件版本徽标、任务为空是真实状态）。
- 仅文档，无代码行为变化；无 DB 迁移、无协议变化。

## 0.11.0-20（内测构建，已并入 0.11.0）

### 看板细节修正（S5d-3）

- 总览团队目标卡恢复 `来自 TEAM.md` 徽标（标题与徽标分离，不再被文本替换吞掉）；进度条按真实任务完成率显示（无任务为 0）。
- 消耗视图「按线消耗」包含 manager 线（此前只有 8 条角色线，manager 的 21k token 未显示）。
- 其余同 0.11.0-19（高保真原型 UIUX 不变，真实数据驱动）。

## 0.11.0-19（内测构建，已并入 0.11.0）

### 看板静态标记与资源修正（S5d-2）

- 修复 0.11.0-18 中静态数据位未落地的遗漏：顶栏品牌/插件版本徽标、总览目标卡、KPI 数字、组织计划/节奏、数据时间、消耗 KPI、页脚版本号全部改为真实数据位。
- 修复 ECharts 资源路径：原型引用 `echarts.min.js`，看板服务只暴露 `/vendor/echarts.min.js`，导致数据/消耗图表空白；改为 `/vendor/echarts.min.js`。
- 高保真原型版式/组件/交互不变；无 DB 迁移、无协议变化、只读。

## 0.11.0-18（内测构建，已并入 0.11.0）

### 恢复高保真 UIUX + 真实数据适配层（S5d）

- **恢复** `web/board.html` 为已确认的高保真原型（版式/组件/交互/主题全部不变）：总览、组织（线框/树视图/搜索/历史线）、任务、数据（ECharts）、消耗、右侧停靠详情、移动端 sheet、深浅色。
- 重写数据适配层：保留原型的 `DATA` 渲染模型，同步清空演示数据后从 `/api/live` + `/api/team-board` + `/api/team-metrics` + `/api/health` 填充真实数据并重渲染（团队目标/组织/任务/数据/消耗/决策/交接/章程详情）。
- 原型静态演示文案全部改为真实数据位（顶部/总览/组织/数据/消耗/页脚），"UIUX 稿（静态示例，数据为演示值）" 字样移除；页脚显示插件版本。
- 无数据时显示「暂无 / 不可得 / 未采集」，不编造；接口失败时同步清空 → 空态（fail-closed）。
- 移除替身逻辑（`showOrg` 整体替换组织视图、TreeWalker 文本替换补丁）。
- 无 DB 迁移（schema v14）、无协议变化（0.4）、只读。

## 0.11.0-17（内测构建，已并入 0.11.0）

### 页脚版本口径修正（S5c-4）

- 页脚直接显示 `/api/health.version` 原值，不再用 `0.11.0-<后缀>` 拼接（该写法只对 0.11.0-x 成立，下一版会显示错）。
- 其余同 0.11.0-16（顶栏/页脚显式显示插件版本）。

## 0.11.0-16（内测构建，已并入 0.11.0）

### 看板显示插件版本（S5c-3）

- 顶栏徽标由裸版本号改为显式「插件版本 v0.11.0-16」（来源 `/api/health.version`），页脚同步显示插件版本。
- 说明：0.11.0-15 页面顶栏已有版本徽标（v0.11.0-15），本次只做显式标注与双位置显示，避免与团队名混淆。

## 0.11.0-15（内测构建，已并入 0.11.0）

### 看板口径修正（S5c-2）

- 总览「成员」改为官方任务板投影的成员数（`team-board.members`），不再与「线 9 / 成员 0」并列造成误读。
- 数据视图同时展示「官方成员（快照）」与「团队板成员」两套来源，差异可见、不合并。
- 其余同 0.11.0-14（看板纯数据驱动、真实章程、任务投影、门禁）。

## 0.11.0-14（内测构建，已并入 0.11.0）

### 看板真实数据修复（S5c）

- 修复 `web/board.html` 内联适配脚本语法错误（`mapLive` 括号错）：该错误导致整段数据映射不执行，页面残留原型演示内容。
- 移除页面全部原型演示数据（`DATA.missions` 等），五视图改为纯数据驱动：团队目标/今日焦点/KPI/待决策/最近交接/任务/数据/消耗全部来自 `/api/live` + `/api/team-board` + `/api/team-metrics`；无数据时显示「暂无 / 不可得 / 未采集」。
- 组织详情读取真实 `charters/<label>.md` 的 sections（定位/职责/标准产出/质量要求/边界/协作/调度）与头部字段，不再回退示例章程。
- 任务视图展示官方任务投影（当前无任务则显示「暂无任务」），不再渲染原型任务。
- 数据/消耗视图接入 `team-metrics.json` 的任务/消息/token 估算趋势（session 级估算，非账单）。
- 新增门禁 `scripts/check-board-scripts.mjs`（内联脚本语法 + 演示数据残留 + 写接口检查），接入 `npm test`。
- `/api/health` 新增 `version` 字段，看板版本徽标不再硬编码；`/api/live` 的 teamWorkspace 线条目新增 `header`/`missingSections`（additive）。
- 无 DB 迁移（schema v14）、无协议变化（0.4）、全部只读。

## 0.11.0-13（内测构建，已并入 0.11.0）

### 团队工作区与看板（S5）

- 新增 teamRoot 配置与只读读取：registry.json、charters/<label>.md、TEAM.md（团队目标/简介/规划/计划节奏）、decisions/<id>.md（决策来源/背景/分析/影响/建议）；缺失显示“暂无/不可得”，不编造。
- 新工具 line_init_team（manager-only，工具 25→26）：幂等初始化/合并 TEAM.md、charters/manager.md、charters/<line>.md、decisions/README.md、registry.json；默认不覆盖（overwrite=true 才覆盖）。
- 零配置 manager 默认 role=负责人；负责人章程明确“只管理不执行、协调资源、从对话提炼目标并更新 TEAM.md”。
- 看板 web 重写：总览/组织/任务/数据/消耗五视图；停靠详情（固定 420、内部滚动）；总览默认团队目标与计划、点决策切换详情；组织 L1/L2/L3 + 交接链 + 历史线；任务卡创建时间（taskRef 估算，缺失不可得）；ECharts（本地 vendor）；刷新控件仅页面可见时轮询（默认 10s，可调，ETag 304）。
- status --json 新增 teamWorkspace / teamGoal / decisions 摘要。
- 无 DB 迁移（schema 14）、无协议变化（0.4）、全部 additive。

## 0.10.0 (2026-11-10)

### 评估（S3c，仅报告）

- `team.yaml`（G9）、线分组（G13）、只读状态接口（G11）：**0.10.0 均不实现**，理由与触发条件见内部评估报告（EVALUATION-0.10.0-S3c）；0.10.0 收敛为 S3a + S3b。

### 空闲休眠 hibernate / line_wake（S3b）

- 生命周期新增 `hibernating`（与 `retire` 区分）：停投递循环、释放 lease、保留 Session/历史；**入站投递与出站发送都返回 `LINE_HIBERNATING`**（不排队、不自动唤醒）。
- 新工具 `line_hibernate` / `line_wake`（manager-only）；`line_wake` 重新 acquire lease 并恢复投递（同一 Session）。
- `retired` 线不可唤醒；`rebind`/`replace` 要求先唤醒（避免改一个睡着线的身份）。
- 回滚 0.9.0：休眠线被视为非 active（启动跳过循环），需人工把 lifecycle 改回 `active`（runbook 已备案）。

### token 按日趋势（S3a）

- 新增 token 采样：每 `tokenSampleMs`（默认 60s）把各线的累计 `decodeTokens` 写入 `line_events`（action=`token_sample`，detail=JSON）；**无 DB 迁移**（复用既有表/索引）。
- `line_metrics.tokens` 扩展：顶层 `total` / `today` / `window` / `perDay[]` / `perMessage` / `samples` / `sampleIntervalMs` / `windowDays` / `timezoneOffsetMinutes` / `basis`；每线 `byLine[].decodeTokens` / `today` / `window` / `ratePerMinute` / `samples`（估算口径，非账单级；跨会话计数重置按 0 处理）。
- 采样优化：值未变化的线不写新样本；`tokenRetentionDays`（默认 30）每小时清理过期 `token_sample` 事件。
- 修复：`line_handoff` 不再被 `token_sample` 事件挤出（events 过滤采样；`oldSessionId` 改用最近一次 rebind）。
- 文档：AGENTS 配置/工具表补 `tokenSampleMs`/`tokenRetentionDays` 与 token 趋势字段；口径写明「session 级采样、估算」。

## 0.9.0 (2026-11-10)

### 协议（S2a）

- 信封新增 `protocolVersion`（`0.4`）；旧消息按 `0.3` 兼容处理。
- 版本协商：`major` 不同拒收（`LINE_PROTOCOL_MISMATCH`），`minor` 更高忽略未知字段。
- 消息表新增 `protocol_version` 列；schema **13 -> 14**（additive，旧行默认 `0.3`）。
- `claim()` 对 `major` 不兼容的消息不投递：落 `failed` + `last_error=LINE_PROTOCOL_MISMATCH` 并写事件（可查、可 redeliver/purge）。
- 工具输出补 `protocolVersion`（`line_send` / `line_inbox` / `line_messages`）。

### JSON Schema 与 conformance（S2b）

- `schema/envelope.v0_4.json`：wire 信封 JSON Schema（`additionalProperties: true`；`kind`/`ccManager` 可选；旧信封无版本字段兼容）。
- `schema/message.v0_4.json`：**messages 表行模型**（snake_case，required 按真实列）；行 ↔ 信封由 `lib/protocol.js` 的 `toEnvelope(row)` 映射。
- `conformance/`：语言无关用例集（**7 组 25 条**：合法/缺字段/非法地址/major 不兼容/minor 新字段/旧消息无版本/非法类型）+ README（任意语言跑法）。
- `test/conformance.test.js`：自写校验器跑 25 条用例；`test/schema-live.test.js`：**真实 DB 行与 toEnvelope 输出**用 schema 校验（F3 实现路径）；`test/snapshot-version.test.js`：team-board / team-board.<line> / team-metrics 快照带 `protocolVersion`。
- 发布包 `files` 纳入 `schema/` 与 `conformance/`，外部实现可自测。
- 独立验证回填修复：`ccParent`→`ccManager`；畸形 `protocol_version` 不再拖垮整批 claim；补 v13→v14 真迁移测试；conformance 增 `g-invalid-types`。

### 能力探测与传输（S2c）

- `lib/capabilities.js`：`probeCapabilities(ctx)` 三态能力表（true/false/null）+ `requireCapability`（缺 `session.create` -> `LINE_CAPABILITY_MISSING`，带 hint）。
- `line_status` 返回 `capabilities`；**显式**传 `workspace` 且 registry 缺失时 `line_create` 降级到 cwd 并返回 `workspaceFallback: registry-unavailable`（不整体失败；未显式传 workspace 时按 cwd 静默处理）。
- 新增 `memory` transport（内存 SQLite）：证明 transport seam 可换、测试秒级起停（不假装第二种引擎）。
- 快照（team-board/team-metrics）增加 `protocolVersion`，消费方忽略未知字段（F7）。

> 下一车（协议与加固）+ 本车内并入的**文档优化**：让人看得懂、让 AI 读得准（无代码行为变更）。纯文档不单独发版（沿用"0.7.1 取消并入下一车"的口径）。

- README（中/英）：新增「Quick Context（给 AI 助手）」结构化上下文块（运行环境/存储/核心实体/硬约束/零配置/投递语义/入口）；「什么时候用」改为**决策表**（选 lines / 不选 并指向官方 Agent Teams）；架构段补 **ASCII 目录树**（AI 可解析，替代仅靠 Mermaid/截图）。
- 新增根级 `AGENTS.md`：面向 AI 的操作契约（配置字段语义与默认值、22 个工具调用契约与权限、`line_status` 字段表、MUST/MUST NOT、防幻觉清单）；README 中/英均链接。
- 文档门禁新增 **C13**：校验 `AGENTS.md` 与代码一致（工具数量/未知工具/漏列工具、schema 版本、Node/DSH 版本区间、配置键、相对链接）——改代码忘了改 AGENTS.md 会直接红。

## 0.8.1 (2026-11-10)

> 打包自包含补丁：**无功能变更**，仅让发布包能自跑回测门禁（DEC-18/19：不新增功能）。

### 非破坏性

- `package.json files` 增加 `scripts`：发布包内自带 `business-smoke.mjs`、`check-docs-consistency.mjs`、`check-bento-alignment.mjs`，回测无需再从仓库拷脚本。
- 版本号 0.8.0 → 0.8.1；无代码行为变化、无 schema 变化。

### 破坏性

- 无。

## 0.8.0 (2026-11-10)

> 用户 2026-11-10 决定：不单独发 0.7.1，文档修正并入本版；**开发测试完成后即发版，不等固定窗口**。发布执行由商业线排期、github-maintenance-line 执行。

### 文档修正（已落地，原 0.7.1 候选并入）

- 修正 0.6.6 门禁措辞：`check-bento-alignment` 脚本存在但在 **lions 仓库**，不在插件包内、不属 `npm test`（跨仓库误引）；0.7.0 的 GitHub Release 说明已同步更正。
- AGENT-TEAMS（中/英）：补"任务树父子关系由 lines 层投影（`parentTaskRef` → `parentTaskId`），官方任务板不提供该字段"；字段表补 `parentTaskId`。
- PHILOSOPHY（中/英）术语表：补 L1/L2/L3 与管理线/角色线/官方团队（部门/部门团队）的对应关系。
- README（中/英）：Bento 规范措辞改为"UIUX 线的 Bento 规范（DESIGN-SPEC §11）"。

### 可见性与处置（S1）

- `message_events`（append-only 消息级事件流）+ schema **v13**（additive，旧库自动建表）。
- `line_messages({ line?, states?, since?, limit? })`：按状态查（含 `failed`/`expired`）+ `counts.byState`；管理线可查任意线。
- `line_trace({ messageId })`：完整生命周期时间线（状态/时间/attempt/actor/错误）。
- `line_redeliver({ messageId, to?, resetAttempts? })`：管理线专用，仅 `failed`/`expired`，可改投同 agent 其它线，写审计事件。
- `line_purge({ before, states?, dryRun? })`：管理线专用，`before` 必填、`dryRun` 默认 true、默认只清终态，删前写 `purged` 事件。
- `ackTimeoutMs`（默认 600000）：`delivered` 超时只标记 + 报数（`line_metrics.messages.ackOverdue`），**不自动重投**（守 I2）。
- CLI `doctor`：输出 `health { failed, expired, ackOverdue }` + 下一步命令提示；`tail --line` 看全状态。
- 新增插件包内门禁：`scripts/check-bento-alignment.mjs`（9 项）、`scripts/check-docs-consistency.mjs`（11 项），均接入 `npm test`。
- 崩溃注入测试 `test/crash-injection.test.js`：kill -9 ×100 后收敛，0 条不可解释消息。
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