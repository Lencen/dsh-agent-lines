# 与DSH 官方“智能体团队插件”（实验性） 融合（只读，0.6.0）

> 一句话：line 管人，team 管事，文件管记忆。
> 用户只给 manager 发任务；不导出、不配置、不点插件按钮。

## 三级组织（融合后的实际形态）

~~~~text
L1 管理线会话（用户只说目标）
  └─ L2 角色线会话（长期角色、持久记忆）
       └─ L3 该角色会话里的官方智能体团队（teammate，任务型、并行、用完释放）
~~~~

- L1 管线：建线、派任务、批 `subteamPolicy`、验收；
- L2 管活：拆解、判断"自己做还是开 L3"、产出与自检、回 L1；
- L3 管并行：子任务、交叉验证、一次性质量点；
- 官方任务板 owner 只能是 teammate（L1/L2 不能当 owner，只读映射）；
- **任务树的父子关系由 lines 层投影**（`parentTaskRef` → `parentTaskId`）：官方任务板不提供 `parentTaskId`，board 只给引用；官方任务的 `officialTaskId` 只在本团队内有效，不等同于 lines 的任务 id；
- 记忆与交付证据在文件里（唯一事实源）。

## 谁干活：L2 自己做，还是开 L3

默认 L2 自己做。满足以下任一且不触犯禁令才开 L3：并行验证（≥2 独立方案/视角）、可切块生产（≥3 独立产出单元）、产出后独立质量点（审读/校对/事实核查）、关键路径长且并行明显缩短。

始终 L2：需要长期角色记忆与口径、同批文件写冲突、任务小于一个回合、需要对用户最终验收、需要跨会话交接。

完整判定（7 个维度、A/B 规则、`subteamPolicy` 语义、标准动作、更新机制）：[DELEGATION-POLICY.md](DELEGATION-POLICY.md)。

> 插件不自动识别/派发/硬拦截；判断由 L2 的 agent 按该策略执行，插件只记录、展示、审计（不变量 I5）。

## 前提

- manager line 必须同时是DSH 官方“智能体团队插件”（实验性） 的 Lead 或成员；
- 否则 line_team_board 显示 available=false，不要求用户导出。

## 用户怎么用

只说：

~~~text
帮我把 ch027 写出来，交给写手和校对。
~~~

manager 自动：
1. 在 Agent Teams 任务板创建任务；
2. 用 line 建/复用长期角色；
3. 读 官方智能体团队插件服务.listTasks/listMembers；
4. 按 teammate name 自动映射 line；
5. 把任务、线、待审批放进 line_team_board。

## 主机快照

负责人调用看板时，自动写 DSH_HOME/agent-lines/team-board.json（权限 0600，原子替换）；用户不需要导出或配置。

## 看板内容

- tasks：id、subject、status、ownerName、ownerLine、blockedBy、staleOwner、**parentTaskId**（由 lines 层按 `parentTaskRef` 投影，官方任务板不提供）；
- lines：label、role、session、在线、未读、activity；
- inbox：pending_approval、blocked、stale_owner、line_offline、unavailable。

## 只看不写

- 不写 Agent Teams 任务；
- 不写 lines.db；
- 不触发管理线 turn；
- 没有 taskRef 的消息只进沟通流，不硬挂任务。

## 限制

- 官方智能体团队插件服务 是 experimental 内部服务，不是稳定公开 API；
- 服务不可用就显示 unavailable；
- L2 双向任务桥未批准。

## 示例

~~~json
{
  "available": true,
  "manager": { "line": "manager" },
  "tasks": [
    { "id": "task-1", "subject": "ch027 初稿", "status": "pending", "ownerName": "writer", "ownerLine": "writer", "staleOwner": false, "blockedBy": [] }
  ],
  "lines": [
    { "label": "writer", "role": "写手", "status": "online", "unread": 0 }
  ],
  "inbox": []
}
~~~