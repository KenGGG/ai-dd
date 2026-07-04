# AIDDA Workbench Architecture

AIDDA Workbench is structured as a local full-stack application:

```text
React/Vite UI
  -> Express TypeScript API
  -> SQLite application database
  -> Python worker scripts
  -> CNINFO PDF files / NotebookLM / Markdown reports
```

## Frontend

Source: `src/`

- `src/App.tsx` renders the current product workflow:
  - Project management center
  - Due diligence detail workbench
  - Settings center
- `src/api/aidda.ts` is the frontend API client for `/api/aidda/*` and converts backend project records into UI state.
- Browser `localStorage` is only a UI cache fallback. The backend database is the source of truth for project records.

## Backend

Source: `server.ts`, `server/`

- `server.ts` starts Express, exposes `/api/health`, mounts AIDDA routes, and serves Vite or production static assets.
- `server/config.ts` loads `.env` before runtime modules read configuration.
- `server/routes/aidda.ts` owns AIDDA HTTP routes.
- `server/db.ts` owns SQLite schema and persistence helpers.
- `server/python.ts` runs Python scripts through `execFile`, not shell string interpolation.

Long-running actions use a job lifecycle:

```text
POST /api/aidda/projects/:id/download-and-upload
  -> create jobs row
  -> update project status
  -> return 202 + jobId
  -> run Python worker in the background
  -> update jobs/projects rows on completion
  -> frontend polls /api/aidda/projects/:id/status
```

The same pattern is used for report generation.

On startup, `recoverInterruptedJobs()` marks stale `running` jobs as `failed` and writes the interruption reason back to affected projects. This prevents a restart from leaving the UI permanently stuck in a running state.

## Database

Default path: `data/aidda.sqlite`

Tables:

- `projects`: project metadata, stock code, NotebookLM notebook id, current status, report paths.
- `jobs`: auditable backend operations such as project creation, download/upload, report generation.
- `artifacts`: reserved index for files and reports.

Configuration:

```bash
AIDDA_DATA_DIR=data
AIDDA_DB_PATH=data/aidda.sqlite
AIDDA_CONDA_ENV=openclaw
AIDDA_PYTHON_MAX_BUFFER_MB=50
PORT=3871
HOST=0.0.0.0
```

Maintenance commands:

```bash
./aidda.sh db:stats
./aidda.sh db:backup
./aidda.sh db:vacuum
```

## Python Workers

Source: `scripts/`

Python scripts contain the integration logic for:

- CNINFO announcement lookup and PDF validation.
- NotebookLM notebook creation and upload.
- NotebookLM question rounds.
- Markdown report composition.

The TypeScript backend invokes these scripts through `server/python.ts`.

## Generated Data

Generated runtime files are intentionally ignored by git:

- `data/*.sqlite`
- `data/pdfs/`
- `data/manifests/`
- `data/answers/`
- `data/reports/`
- `data/backups/`
- `logs/`
- `dist/`

This keeps the public repository source-focused while preserving local runtime data.

## Quality Gates

Local check:

```bash
./aidda.sh check
python3 -m py_compile scripts/*.py
```

GitHub Actions runs the same Prettier, TypeScript, ESLint, test/build gate and Python script compilation on pull requests.
