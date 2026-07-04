# Changelog

All notable changes to AIDDA Workbench will be documented in this file.

## 0.1.0 - 2026-07-04

### Added

- Full-stack local application structure with React/Vite frontend, Express API, SQLite persistence, and Python workers.
- `aidda.sh` control script for start, stop, restart, status, logs, build, test, check, and database maintenance.
- AIDDA project APIs for project creation, NotebookLM status checks, download/upload jobs, status polling, manifest loading, and report loading.
- SQLite job lifecycle with startup recovery for interrupted `running` jobs.
- Node test suite for database helpers and Python stdout JSON parsing.
- GitHub Actions CI, Apache-2.0 license, contribution guide, security policy, and architecture documentation.

### Changed

- Frontend API calls are centralized in `src/api/aidda.ts`.
- Runtime configuration is centralized in `server/config.ts`.
- Package metadata now declares Node.js 22+ and separates runtime dependencies from development dependencies.

### Known Gaps

- `src/App.tsx` is still too large and should be split into pages, hooks, and reusable components.
- Long-running Python jobs are marked failed after process interruption but are not automatically resumed.
- Python linting config exists, but ruff is not yet installed as a project-managed dependency.
