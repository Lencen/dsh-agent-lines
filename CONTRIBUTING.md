# 贡献指南

[English](CONTRIBUTING.en.md) | 中文

感谢你愿意贡献。这个项目是 DSH 社区插件，不是 DeepSeek 官方产品。

## 适合贡献什么

- 新 transport（当前只有 SQLite，HTTP 是未来方向）；
- 新 tool / CLI 能力，但不要改变 0.3 的单 writer 和 manager 模型；
- 文档、示例、集成报告；
- 可复现的 bug 和最小修复；
- 测试和协议一致性改进。

## 开发环境

- Node.js ^22.19.0 或 >=24；
- DSH >=0.2.1-rc.5 <0.3.0；
- 本地文件系统（SQLite 不支持 NFS/CIFS/SMB/FUSE）。

    git clone https://github.com/Lencen/dsh-agent-lines.git
    cd dsh-agent-lines
    npm install
    npm test

## 提交前检查

    npm test
    npm pack --dry-run

要求：

- 测试通过；
- pack 不包含 test、临时 DB、本地路径、凭据；
- 不改变公开 API 时，说明兼容性；
- 不提交 node_modules、*.tgz、.env、lines.db；
- 不在日志或 issue 中放真实 Session 内容、token、客户数据。

## PR 约定

1. 一个 PR 只做一件事；
2. 写清复现/验证命令和结果；
3. 涉及协议/状态的改动要同步 docs/PROTOCOL.md 和 docs/ARCHITECTURE.md；
4. 涉及安装/升级的改动要同步 docs/DEPLOY.md；
5. 新增行为要有测试；没有测试的修复请说明原因；
6. 遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 安全

漏洞不要开公开 issue，按 [SECURITY.md](SECURITY.md) 报告。

## 许可

贡献按 Apache-2.0 授权（inbound = outbound）。
