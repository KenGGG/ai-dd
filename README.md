# AIDDA NotebookLM 尽调助手

AIDDA 是一个本地运行的上市公司公告尽调应用。它把巨潮公告 PDF 下载、NotebookLM 上传、逐轮提问和 Markdown 报告拼接收敛成一个简单流程。

```text
输入股票代码 -> 选择模式 -> 开始尽调 -> 查看报告
```

页面左侧的“问题设置”可以编辑全部 NotebookLM 提问。精简模式固定使用第 1 个问题；标准和深度模式使用全部启用问题。

再次运行已有项目时：

- “继续尽调”会清除旧报告，保留已成功回答的问题，只从断点继续问询；
- “从头问询”会清除旧报告和旧答案，重新向 NotebookLM 提问；
- 单个问题失败时，可以在“问询进度”中点击“重问本题”，只重新执行该问题；
- 如果 NotebookLM 已有足够附件，会跳过公告下载与上传；
- “回复方式”支持对话回复和 NotebookLM 自定义报告生成；
- 页面会持续显示逐题回答进度和 Python 命令行日志。

## 尽调模式

| 模式 | 资料范围                         | 问题数量     | 适用场景                   |
| ---- | -------------------------------- | ------------ | -------------------------- |
| 精简 | 近三年定期报告                   | 1 个问题     | 快速判断企业画像和资料边界 |
| 标准 | 近三年定期报告                   | 全部启用问题 | 默认尽调流程               |
| 深度 | 近三年定期报告 + 最近 200 个公告 | 全部启用问题 | 需要覆盖重大事项和公告事件 |

## 快速开始

```bash
./aidda.sh install
./aidda.sh start
```

访问：

```text
http://localhost:3871
```

NotebookLM 首次使用前需要登录：

```bash
notebooklm login
notebooklm auth check --test
```

## 当前架构

```text
React 单页控制台
  -> Express /api/aidda
  -> SQLite 项目与任务状态
  -> Python worker
  -> 巨潮公告 PDF / NotebookLM / Markdown 报告
```

主要文件：

| 路径                                       | 作用                         |
| ------------------------------------------ | ---------------------------- |
| `src/App.tsx`                              | 单屏尽调控制台               |
| `server/routes/aidda.ts`                   | 项目、运行、状态、报告 API   |
| `scripts/download_upload_aidda_project.py` | 下载公告并上传 NotebookLM    |
| `scripts/run_aidda_project.py`             | 复用资料后执行提问和报告拼接 |
| `scripts/notebooklm_run_questions.py`      | NotebookLM 对话/报告式问答   |
| `scripts/compose_dd_report.py`             | 汇编 Markdown 报告           |
| `templates/question_rounds.json`           | 尽调问题模板                 |
| `templates/dd_report_outline.md`           | 报告大纲                     |

## API

| Method   | Path                             | 说明                                     |
| -------- | -------------------------------- | ---------------------------------------- |
| `GET`    | `/api/aidda/projects`            | 项目列表                                 |
| `POST`   | `/api/aidda/projects`            | 创建项目并绑定 NotebookLM                |
| `POST`   | `/api/aidda/projects/:id/run`    | 按 `lite` / `standard` / `deep` 运行尽调 |
| `GET`    | `/api/aidda/projects/:id/status` | 获取资料、问题和报告状态                 |
| `GET`    | `/api/aidda/projects/:id/report` | 读取 Markdown 报告                       |
| `DELETE` | `/api/aidda/projects/:id`        | 删除项目记录                             |
| `GET`    | `/api/aidda/question-rounds`     | 读取问题模板                             |
| `PUT`    | `/api/aidda/question-rounds`     | 保存问题模板                             |
| `GET`    | `/api/aidda/notebooklm/status`   | 检查 NotebookLM 登录                     |

## 检查

```bash
npm run check
python3 -m py_compile scripts/*.py
```

## 运行时目录

运行数据统一保存在 `data/`，包括 SQLite 数据库、PDF、NotebookLM 回答、报告和日志。仓库只保留空目录占位，不提交真实调试数据。
