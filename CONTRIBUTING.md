# Contributing

感谢参与 AIDDA Workbench。

## 本地开发

```bash
./aidda.sh install
./aidda.sh start
```

默认访问地址：

```text
http://localhost:3871
```

## 提交前检查

```bash
./aidda.sh check
python3 -m py_compile scripts/*.py
```

`./aidda.sh check` 会执行 Prettier、TypeScript、ESLint、Node 单测和生产构建。

Python lint 可在单独的 conda/venv 开发环境中启用：

```bash
pip install -r requirements-dev.txt
npm run ruff
```

## 工程约定

- 前端页面通过 `src/api/aidda.ts` 访问后端，不在组件中散落 HTTP 细节。
- 后端 API 放在 `server/routes/`，数据库访问放在 `server/db.ts`。
- Python 集成脚本放在 `scripts/`，由 `server/python.ts` 通过 `execFile` 调用。
- 运行时数据保存在 `data/`，不提交 PDF、报告、SQLite 数据库或日志。
- 不用 mock 数据冒充真实公告下载、NotebookLM 上传或报告生成结果。
