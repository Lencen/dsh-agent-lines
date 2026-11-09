# 与DSH 官方“智能体插件”（实验性） 融合（只读，0.5.0）

> 一句话：line 管人，team 管事，文件管记忆。
> 用户只给 manager 发任务；不导出、不配置、不点插件按钮。

## 前提

- manager line 必须同时是DSH 官方“智能体插件”（实验性） 的 Lead 或成员；
- 否则 line_team_board 显示 available=false，不要求用户导出。

## 用户怎么用

只说：

~~~text
帮我把 ch027 写出来，交给写手和校对。
~~~

manager 自动：
1. 在 Agent Teams 任务板创建任务；
2. 用 line 建/复用长期角色；
3. 读 官方智能体插件服务.listTasks/listMembers；
4. 按 teammate name 自动映射 line；
5. 把任务、线、待审批放进 line_team_board。

## 看板内容

- tasks：id、subject、status、ownerName、ownerLine、blockedBy、staleOwner；
- lines：label、role、session、在线、未读、activity；
- inbox：pending_approval、blocked、stale_owner、line_offline、unavailable。

## 只看不写

- 不写 Agent Teams 任务；
- 不写 lines.db；
- 不触发管理线 turn；
- 没有 taskRef 的消息只进沟通流，不硬挂任务。

## 限制

- 官方智能体插件服务 是 experimental 内部服务，不是稳定公开 API；
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