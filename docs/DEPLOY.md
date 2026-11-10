# 部署

[English](DEPLOY.en.md) | 中文

## 一个进程，一条或多条线

0.3 支持在同一个 DSH 进程里跑多条线，每条线绑定一个普通 DSH Session。配置 allowCreate: true 和 createFrom 的管理线，可以用 line_create 继续建线；这些线都在同一个 DSH 进程、管理线的工作目录下。

也可以继续一条线一个 DSH 进程（0.1 风格），多个进程共享同一个 dbPath：

    DSH 进程 A（profile lines-a，端口 3081，line frontend） ┐
    DSH 进程 B（profile lines-b，端口 3082，line backend）  ┼─ ~/.dsh/agent-lines/lines.db
    DSH 进程 C（profile lines-c，端口 3083，line asset）    ┘

line_create 不会创建独立进程/profile/端口。如果需要进程隔离，或每条线要用不同工作目录，请为每条线单独起 DSH profile/进程。

## 数据库放哪里

- 只放本地磁盘；NFS/CIFS/SMB/FUSE 会在启动时拒绝。
- 默认：~/.dsh/agent-lines/lines.db。
- 父目录权限 0700，数据库权限 0600。

## 团队工作区（teamRoot，可选）

团队档案（TEAM.md / charters / decisions / registry）默认跟随 manager 当前工作区：不配置 `teamRoot` 时，`line_init_team({teamName})` 落在 `<manager cwd>/<团队名>`。

也可以显式配置：

- `teamRoot` 配成工作区父目录：团队目录 = `<teamRoot>/<团队名>`；`line_status` 和看板会自动解析最新子团队；
- `teamRoot` 配成团队目录本身：直接使用该目录；
- 看板 `--team-root` 也可给父目录，团队新建后刷新即可跟随。

生产建议：一个工作区一个团队；需要固定归档位置时再显式配 `teamRoot`。

## Session 所有权

一个 DSH Session 同时只有一个 writer。线的 Session 正在被某个进程服务时，不要在另一个 DSH 进程（例如 3080 的主 Web UI）里打开它。DSH 会以 session/writer-held 拒绝插件 prompt，消息在重试预算耗尽后失败。

要查看线的 Session，使用该线进程自己的 Web UI（它是 writer），或先停掉线进程。生产环境建议每条线独立 Session，不要从另一个 DSH 实例浏览该 Session。

## 常在线

线只在它的 DSH 进程存活时消费消息。需要常在线时，把 DSH web profile 做成用户服务：

    [Unit]
    Description=DSH web (agent line frontend)
    After=network.target

    [Service]
    Type=simple
    # 替换成你自己的 dsh 路径
    ExecStart=%h/.npm-global/bin/dsh --profile lines-a web --no-open --host 127.0.0.1 --port 3081
    Restart=on-failure
    RestartSec=5

    [Install]
    WantedBy=default.target

进程不在时消息保持 queued，重启后继续投递。0.3 不会按需拉起进程。

## 管理线绑定与 claim

如果配置里的管理 Session 已失效，任意 live 根 Session 可以调用：

    line_claim_manager({ "confirm": "bind-manager" })

这个全局工具会校验 Session 是否为 live 根会话，释放旧管理租约、重绑、启动新的投递循环，并把选择写入 manager_bindings。必须设置 allowClaim: true，不需要重启。CLI 兜底：

    dsh-agent-lines claim --agent agent-demo --line manager --session "$DSH_SESSION_ID"

如果启动时配置的管理 Session 不存在，插件不会获取它，也不会显示 online；line_status 会显示缺失状态和修复命令。

## Session id

配置的线需要已存在的 sessionId；在 DSH 会话列表/日志里找，或用 dsh-agent-lines doctor 查看队列。错误的 id 会以 session/not-found 永久失败，消息进入 failed。

line_create 会在管理线工作区（或回退 cwd）生成新的 session-<uuid> 并返回。新线是普通 DSH Session，不是 subagent，也没有独立 OS 进程。

动态线会记录 created_by；有 allowCreate 的管理线在启动时恢复自己创建的线并重新获取租约。如果另一个进程仍持有某条线，恢复会跳过它。从未落盘的空白 Session 首次投递可能失败；给它发一条任务或重新创建即可。

## 升级

1. 停掉 DSH 进程（或让 systemd 重启）。
2. dsh plugin --profile <p> add dsh-agent-lines@<version>。
3. 重启。
4. 运行 dsh-agent-lines doctor，检查租约/线列表。

SQLite schema 用 PRAGMA user_version 版本化；0.3 是 version 6（新增 lines.role、lines.created_by、claim_requests、manager_bindings，以及消息 hop/no_reply/root_message_id）。现有 version-1 数据库打开时原地迁移。跨 minor 版本升级前先备份 lines.db。

## 卸载 / 回滚

1. 从 profile patch 删除插件条目，并运行 dsh plugin --profile <p> remove dsh-agent-lines。
2. 重启 DSH。
3. 数据库不会自动删除；确认不再需要队列消息后，再移动或删除 lines.db。
4. 插件不会修改 ~/.dsh/sessions。
