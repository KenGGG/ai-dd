# Security Policy

## 敏感数据

AIDDA Workbench 会在本地生成或引用以下敏感数据：

- NotebookLM 登录态和浏览器会话；
- SQLite 项目数据库；
- 公告 PDF、manifest、NotebookLM 回答和尽调报告；
- 本地日志中的错误输出。

这些文件默认位于 `data/`，已在 `.gitignore` 中排除。公开仓库或提交 issue 前，请确认没有上传真实项目资料、登录状态、报告或日志。

## 配置

使用 `.env` 管理本地配置，并以 `.env.example` 作为模板。不要提交 `.env`。

## 报告问题

如果发现会泄露本地资料、NotebookLM 登录态、任意文件读取、命令执行或越权访问的问题，请不要在公开 issue 中贴出敏感样本。先用脱敏复现步骤描述问题，再通过私有渠道沟通必要细节。
