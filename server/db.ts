import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { APP_CONFIG } from "./config.ts";

const DATA_DIR = APP_CONFIG.dataDir;
const DB_PATH = APP_CONFIG.dbPath;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema version tracking ────────────────────────────────────────────────────
export const SCHEMA_VERSION = 2;

function initSchema(): void {
  // Create schema_version table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(version)
    )
  `);

  // Check current version
  const versionRow = db
    .prepare("SELECT version FROM schema_versions ORDER BY id DESC LIMIT 1")
    .get() as { version: number } | undefined;
  const currentVersion = versionRow ? versionRow.version : 0;

  if (currentVersion < SCHEMA_VERSION) {
    applyMigrations(currentVersion);
  }
}

function applyMigrations(fromVersion: number): void {
  // Migration 1 → 2: Add source_mappings table for attachment matching
  if (fromVersion < 2) {
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS source_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        announcement_id TEXT,
        adjunct_url TEXT,
        sha256 TEXT,
        notebook_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_title TEXT,
        local_path TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(notebook_id, source_id)
      )
    `,
    ).run();

    // Create index for faster lookups
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_source_mapping_project ON source_mappings(project_id)",
    ).run();
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_source_mapping_announcement ON source_mappings(announcement_id)",
    ).run();

    // Record version change
    db.prepare(
      `
      INSERT INTO schema_versions (version, applied_at)
      VALUES (?, CURRENT_TIMESTAMP)
    `,
    ).run(2);
  }
}

initSchema();

// ── Core Tables ────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  notebook_id TEXT,
  notebook_title TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  current_step INTEGER NOT NULL DEFAULT 0,
  manifest_path TEXT,
  pdf_dir TEXT,
  report_path TEXT,
  download_success INTEGER NOT NULL DEFAULT 0,
  upload_success INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  error TEXT,
  output TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  path TEXT,
  status TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
`);

// Ensure unique index for running job enforcement (partial index, SQLite 3.34+)
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_running_job ON jobs(project_id) WHERE status = 'running'
  `);
} catch {
  // SQLite version too old for partial indexes — ignore
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface AiddaProjectRecord {
  id: string;
  name: string;
  stockCode: string;
  stockName: string;
  notebookId: string;
  notebookTitle: string;
  status: string;
  currentStep: number;
  manifestPath: string;
  pdfDir: string;
  reportPath: string;
  downloadSuccess: number;
  uploadSuccess: number;
  error: string;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SourceMappingRecord {
  id: number;
  projectId: string;
  announcementId: string | null;
  adjunctUrl: string | null;
  sha256: string | null;
  notebookId: string;
  sourceId: string;
  sourceTitle: string | null;
  localPath: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function mapProject(row: any): AiddaProjectRecord {
  return {
    id: row.id,
    name: row.name,
    stockCode: row.stock_code,
    stockName: row.stock_name || "",
    notebookId: row.notebook_id || "",
    notebookTitle: row.notebook_title || "",
    status: row.status,
    currentStep: row.current_step,
    manifestPath: row.manifest_path || "",
    pdfDir: row.pdf_dir || "",
    reportPath: row.report_path || "",
    downloadSuccess: row.download_success || 0,
    uploadSuccess: row.upload_success || 0,
    error: row.error || "",
    meta: JSON.parse(row.meta_json || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSourceMapping(row: any): SourceMappingRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    announcementId: row.announcement_id,
    adjunctUrl: row.adjunct_url,
    sha256: row.sha256,
    notebookId: row.notebook_id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    localPath: row.local_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Project CRUD ───────────────────────────────────────────────────────────────
export function listProjects(): AiddaProjectRecord[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
  return rows.map(mapProject);
}

export function getProject(id: string): AiddaProjectRecord | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? mapProject(row) : null;
}

export function upsertProject(input: {
  id: string;
  name: string;
  stockCode: string;
  stockName?: string;
  notebookId?: string;
  notebookTitle?: string;
  status?: string;
  currentStep?: number;
  meta?: Record<string, unknown>;
}): AiddaProjectRecord {
  db.prepare(
    `
    INSERT INTO projects (
      id, name, stock_code, stock_name, notebook_id, notebook_title,
      status, current_step, meta_json, created_at, updated_at
    ) VALUES (
      @id, @name, @stockCode, @stockName, @notebookId, @notebookTitle,
      @status, @currentStep, @metaJson, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      stock_code = excluded.stock_code,
      stock_name = excluded.stock_name,
      notebook_id = excluded.notebook_id,
      notebook_title = excluded.notebook_title,
      status = excluded.status,
      current_step = excluded.current_step,
      meta_json = excluded.meta_json,
      updated_at = CURRENT_TIMESTAMP
  `,
  ).run({
    id: input.id,
    name: input.name,
    stockCode: input.stockCode,
    stockName: input.stockName || "",
    notebookId: input.notebookId || "",
    notebookTitle: input.notebookTitle || "",
    status: input.status || "idle",
    currentStep: input.currentStep || 0,
    metaJson: JSON.stringify(input.meta || {}),
  });
  return getProject(input.id)!;
}

export function updateProject(
  id: string,
  patch: {
    status?: string;
    currentStep?: number;
    manifestPath?: string;
    pdfDir?: string;
    reportPath?: string;
    downloadSuccess?: number;
    uploadSuccess?: number;
    error?: string | null;
  },
): AiddaProjectRecord | null {
  const current = getProject(id);
  if (!current) return null;

  db.prepare(
    `
    UPDATE projects SET
      status = @status,
      current_step = @currentStep,
      manifest_path = @manifestPath,
      pdf_dir = @pdfDir,
      report_path = @reportPath,
      download_success = @downloadSuccess,
      upload_success = @uploadSuccess,
      error = @error,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `,
  ).run({
    id,
    status: patch.status ?? current.status,
    currentStep: patch.currentStep ?? current.currentStep,
    manifestPath: patch.manifestPath ?? current.manifestPath,
    pdfDir: patch.pdfDir ?? current.pdfDir,
    reportPath: patch.reportPath ?? current.reportPath,
    downloadSuccess: patch.downloadSuccess ?? current.downloadSuccess,
    uploadSuccess: patch.uploadSuccess ?? current.uploadSuccess,
    error: patch.error === null ? "" : (patch.error ?? current.error),
  });
  return getProject(id);
}

export function deleteProject(id: string): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

// ── Job Management ─────────────────────────────────────────────────────────────
export function createJob(projectId: string | null, type: string): number {
  const result = db
    .prepare(`INSERT INTO jobs (project_id, type, status) VALUES (?, ?, 'running')`)
    .run(projectId, type);
  return Number(result.lastInsertRowid);
}

export function finishJob(
  id: number,
  status: "completed" | "failed",
  output = "",
  error = "",
): void {
  db.prepare(
    `UPDATE jobs SET status = ?, output = ?, error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(status, output, error, id);
}

// ── CAS Lock with Transaction (atomic) ─────────────────────────────────────────
/**
 * CAS: 仅当项目没有 running job 时，将其锁为运行中并创建 job。
 * 返回 job id；返回 null 表示项目已被锁定（并发任务正在运行）。
 * 允许 idle、failed、completed 状态的项目启动新任务。
 */
export function tryStartProjectJob(projectId: string, jobType: string): number | null {
  let result: number | null = null;
  db.transaction(() => {
    const running = db
      .prepare("SELECT id FROM jobs WHERE project_id = ? AND status = 'running'")
      .get(projectId);
    if (running) {
      result = null;
      return;
    }

    db.prepare(
      "UPDATE projects SET status = 'downloading', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(projectId);

    const j = db
      .prepare("INSERT INTO jobs (project_id, type, status) VALUES (?, ?, 'running')")
      .run(projectId, jobType);
    result = Number(j.lastInsertRowid);
  });
  return result;
}

// ── Query Helpers ──────────────────────────────────────────────────────────────
export function getJob(id: number): any | null {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) || null;
}

export function listJobs(projectId?: string): any[] {
  if (projectId) {
    return db.prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY id DESC").all(projectId);
  }
  return db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT 100").all();
}

// ── Source Mappings (Attachment Matching) ─────────────────────────────────────
export function getSourceMappingsByProject(projectId: string): SourceMappingRecord[] {
  const rows = db
    .prepare("SELECT * FROM source_mappings WHERE project_id = ? ORDER BY id DESC")
    .all(projectId);
  return rows.map(mapSourceMapping);
}

export function getMatchedMappingCount(
  projectId: string,
  announcementId: string | null,
  sha256: string | null,
): number {
  const sql = `
    SELECT COUNT(*) as cnt FROM source_mappings
    WHERE project_id = ?
      AND (announcement_id = ? OR sha256 = ?)
      AND status = 'active'
  `;
  const row = db.prepare(sql).get(projectId, announcementId, sha256) as { cnt: number };
  return Number(row.cnt);
}

export function createOrUpdateMapping(
  projectId: string,
  mapping: {
    announcementId: string | null;
    sha256: string | null;
    notebookId: string;
    sourceId: string;
    sourceTitle: string | null;
    localPath: string;
  },
): void {
  db.prepare(
    `
    INSERT INTO source_mappings (
      project_id, announcement_id, sha256, notebook_id, source_id, source_title, local_path, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    ON CONFLICT(notebook_id, source_id) DO UPDATE SET
      announcement_id = excluded.announcement_id,
      sha256 = excluded.sha256,
      source_title = excluded.source_title,
      local_path = excluded.local_path,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `,
  ).run(
    projectId,
    mapping.announcementId,
    mapping.sha256,
    mapping.notebookId,
    mapping.sourceId,
    mapping.sourceTitle,
    mapping.localPath,
  );
}

export function cleanMappingsForProject(projectId: string): void {
  db.prepare("DELETE FROM source_mappings WHERE project_id = ?").run(projectId);
}

// ── Interrupted Job Recovery ──────────────────────────────────────────────────
export function recoverInterruptedJobs(reason = "服务重启，后台任务已中断，请重新执行该步骤。"): {
  jobsRecovered: number;
  projectsRecovered: number;
} {
  const interruptedJobs = db
    .prepare("SELECT DISTINCT project_id FROM jobs WHERE status = 'running'")
    .all() as Array<{ project_id: string | null }>;

  const jobsResult = db
    .prepare(
      `
    UPDATE jobs
    SET status = 'failed',
        error = @reason,
        finished_at = CURRENT_TIMESTAMP
    WHERE status = 'running'
  `,
    )
    .run({ reason });

  const projectIds = interruptedJobs
    .map((row) => row.project_id)
    .filter((id): id is string => Boolean(id));

  let projectsRecovered = 0;
  const recoverProject = db.prepare(`
    UPDATE projects
    SET status = 'failed',
        error = @reason,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
      AND status IN ('downloading', 'uploading', 'parsing', 'querying', 'synthesizing')
  `);

  for (const id of projectIds) {
    projectsRecovered += recoverProject.run({ id, reason }).changes;
  }

  return {
    jobsRecovered: jobsResult.changes,
    projectsRecovered,
  };
}

export { DB_PATH, DATA_DIR };
