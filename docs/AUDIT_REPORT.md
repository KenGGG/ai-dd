# AIDDA Workbench Engineering Audit

审计日期：2026-07-04

## 当前结论

AIDDA Workbench 已从前端 demo 形态推进为本地全栈应用：

- 前端：React + TypeScript + Vite，包含项目管理中心、尽调详情工作台、设置中心；
- 后端：Express + TypeScript，提供 `/api/aidda/*` API；
- 数据库：SQLite + better-sqlite3，持久化项目、任务和产物索引；
- Worker：Python 脚本执行公告下载、NotebookLM 上传、逐轮提问和报告拼接；
- 工程化：根目录控制脚本、配置模板、CI、测试、数据库维护命令、公开仓库文档已补齐。

## 已完成工程化项

| 项目             | 状态   | 证据                                                                                                                       |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 前后端一体启动   | 已完成 | `aidda.sh start/restart/stop/status`                                                                                       |
| 统一配置         | 已完成 | `server/config.ts`、`.env.example`                                                                                         |
| 数据库持久化     | 已完成 | `server/db.ts`、`data/aidda.sqlite`                                                                                        |
| 长任务 job 模型  | 已完成 | `jobs` 表、`download-and-upload` / `compose-report` 返回 `jobId`                                                           |
| 服务重启恢复     | 已完成 | `recoverInterruptedJobs()` 会把中断的 running job 和项目标记为 failed                                                      |
| 前端 API 边界    | 已完成 | `src/api/aidda.ts`                                                                                                         |
| 前端拆分第一阶段 | 已完成 | `constants/`、`hooks/`、`ErrorBoundary`、`components/layout/`、`pages/ProjectsHub/`、`pages/Settings/` 已从 `App.tsx` 抽离 |
| 格式化           | 已完成 | `.prettierrc`、`.prettierignore`、`npm run format:check`                                                                   |
| 静态检查         | 已完成 | `tsc --noEmit`、`eslint.config.js`、`npm run lint:eslint`                                                                  |
| 测试入口         | 已完成 | `npm test`、`tests/*.test.ts`                                                                                              |
| 本地质量门禁     | 已完成 | `npm run check`、`./aidda.sh check`                                                                                        |
| CI               | 已完成 | `.github/workflows/ci.yml`                                                                                                 |
| 数据库维护       | 已完成 | `db:stats`、`db:backup`、`db:vacuum`                                                                                       |
| 公开仓库基础文件 | 已完成 | `LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、`.gitignore`                                                                  |
| Node 版本约束    | 已完成 | `.nvmrc`、`package.json engines.node`                                                                                      |

## 仍需继续完善

| 项目                      | 优先级 | 说明                                                                                 |
| ------------------------- | -----: | ------------------------------------------------------------------------------------ |
| 端到端小样本验收          |     P0 | 需要用真实 NotebookLM 登录态跑完创建项目、下载上传、生成报告                         |
| 前端上帝组件拆分          |     P0 | 已启动拆分；`src/App.tsx` 仍有约 1169 行，下一步应继续拆 Workbench 的 PDF / 报告区域 |
| 实时进度推送              |     P1 | 当前为轮询，尚未把 Python stdout 转成逐条 PDF 进度                                   |
| manifest / 答案文件查看器 |     P1 | 当前只在完成后汇总展示，缺少逐条复核视图                                             |
| 数据库迁移版本表          |     P1 | 当前为 `CREATE TABLE IF NOT EXISTS`，后续 schema 演进应引入 migrations               |
| 后端路由拆分              |     P1 | `server/routes/aidda.ts` 已接近 300 行，应拆分 project/job/notebooklm/artifact 路由  |
| 后台任务队列              |     P2 | 当前长任务为进程内后台 Promise，服务重启后可标记中断但不能自动续跑                   |
| E2E/UI 自动化             |     P2 | 当前覆盖后端单元测试，缺少浏览器工作流测试                                           |
| Python ruff 门禁          |     P2 | 已有 `pyproject.toml` 和 `requirements-dev.txt`，尚未接入默认 CI                     |
| Word 报告导出             |     P3 | 当前仅输出 Markdown                                                                  |

## 验证命令

```bash
./aidda.sh check
python3 -m py_compile scripts/*.py
./aidda.sh restart
curl -s http://127.0.0.1:3871/api/health
curl -s http://127.0.0.1:3871/api/aidda/projects
```

## 工程边界

- 运行时数据、SQLite、PDF、报告、日志和 NotebookLM 资料不进入 git；
- NotebookLM 登录仍由本机 CLI 完成，设置中心只做状态检查；
- 系统不使用 Gemini API、不使用 n8n、不用 mock 数据替代真实主链路；
- 第一版暂不处理多股票并发、复杂权限和审批流。
