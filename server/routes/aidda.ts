/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIDDA API — intentionally small.
 *
 * User flow:
 *   create project -> run due diligence -> poll status -> read report
 */

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import {
  DATA_DIR,
  createJob,
  db,
  deleteProject,
  finishJob,
  getProject,
  listProjects,
  tryStartProjectJob,
  upsertProject,
  updateProject,
  getSourceMappingsByProject,
} from "../db.ts";
import { parseLastJSON, runPythonScript } from "../python.ts";
import { runPythonScriptLogged } from "../python.ts";
import { AppError, asyncHandler } from "../middleware/error-handler.ts";
import { APP_CONFIG } from "../config.ts";
import {
  evaluateSourceCompleteness,
  SourceCompletenessInput,
  SourceCompletenessResult,
} from "../services/source-completeness.ts";

export const aiddaRouter = Router();

// ── Path safety helpers ──────────────────────────────────────────────────────
// Project IDs may originate from untrusted Python script output, so any path
// built from them must be contained within DATA_DIR.
const PROJECT_ID_RE = /^[A-Za-z0-9_-]+$/;

function validateProjectId(id: string): string {
  if (typeof id !== "string" || !PROJECT_ID_RE.test(id)) {
    throw new AppError("非法的项目标识", 400);
  }
  return id;
}

// Resolve a path that must remain inside DATA_DIR; throws on any traversal
// attempt (e.g. project id containing "..").
function safeDataPath(...segments: string[]): string {
  const dataRoot = path.resolve(DATA_DIR);
  const target = path.resolve(DATA_DIR, ...segments);
  if (target !== dataRoot && !target.startsWith(dataRoot + path.sep)) {
    throw new AppError("非法的文件路径", 400);
  }
  return target;
}

// Parse a single JSONL line, returning null for blank or malformed lines.
function safeParseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    console.warn("safeParseJsonLine: skipping malformed manifest line");
    return null;
  }
}

// ── Auth status endpoint (public) ────────────────────────────────────────────
aiddaRouter.get("/auth/status", (_req: Request, res: Response) => {
  res.json({ required: !!APP_CONFIG.authToken });
});

// ── Health check is handled in server.ts ────────────────────────────────────

// Privacy endpoint - returns non-sensitive system information (authenticated)
aiddaRouter.get(
  "/privacy",
  asyncHandler(async (_req: Request, res: Response) => {
    // Return only non-sensitive info - do NOT expose tokens, paths, or secrets
    res.json({
      service: "aidda-workbench",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      features: ["source-completeness-check", "checkpoint-recovery", "python-process-management"],
    });
  }),
);

type RunMode = "lite" | "standard" | "deep";
type QuestionMethod = "chat" | "report";
type QuestionRound = {
  round_id: string;
  round_no: number;
  round_name: string;
  target_sections?: string[];
  prompt: string;
  question_method?: QuestionMethod;
  enabled?: boolean;
};

const TEMPLATES_DIR = path.join(process.cwd(), "templates");
const QUESTION_ROUNDS_PATH = path.join(TEMPLATES_DIR, "question_rounds.json");
const ANNOUNCEMENT_FILTERS_PATH = path.join(DATA_DIR, "announcement_filters.json");

const RUN_MODES: Record<
  RunMode,
  { label: string; periodicYears: number; recentLimit: number; maxQuestionRounds: number }
> = {
  lite: {
    label: "精简",
    periodicYears: 3,
    recentLimit: 0,
    maxQuestionRounds: 1,
  },
  standard: {
    label: "标准",
    periodicYears: 3,
    recentLimit: 0,
    maxQuestionRounds: 0,
  },
  deep: {
    label: "深度",
    periodicYears: 3,
    recentLimit: 200,
    maxQuestionRounds: 0,
  },
};

function readJSON(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readQuestionRounds(): QuestionRound[] {
  if (!fs.existsSync(QUESTION_ROUNDS_PATH)) return [];
  const data = JSON.parse(fs.readFileSync(QUESTION_ROUNDS_PATH, "utf-8"));
  return Array.isArray(data) ? (data as QuestionRound[]) : [];
}

function writeQuestionRounds(rounds: QuestionRound[]) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  fs.writeFileSync(QUESTION_ROUNDS_PATH, `${JSON.stringify(rounds, null, 2)}\n`, "utf-8");
}

function readAnnouncementFilters(): string[] {
  const data = readJSON(ANNOUNCEMENT_FILTERS_PATH);
  const terms = Array.isArray(data?.terms) ? data.terms : [];
  return terms.map((term) => String(term).trim()).filter(Boolean);
}

function writeAnnouncementFilters(terms: string[]) {
  fs.mkdirSync(path.dirname(ANNOUNCEMENT_FILTERS_PATH), { recursive: true });
  const normalized = Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));
  fs.writeFileSync(
    ANNOUNCEMENT_FILTERS_PATH,
    `${JSON.stringify({ terms: normalized }, null, 2)}\n`,
    "utf-8",
  );
  return normalized;
}

function attachAnswerContent(manifest: Record<string, unknown>) {
  const results = Array.isArray(manifest.results) ? manifest.results : [];
  return {
    ...manifest,
    results: results.map((item) => {
      if (!item || typeof item !== "object") return item;
      const result = item as Record<string, unknown>;
      const answerFile = typeof result.answer_file === "string" ? result.answer_file : "";
      if (!answerFile) return result;
      // answer_file comes from untrusted script output — verify containment.
      const resolvedAnswerFile = safeDataPath(answerFile);
      if (!fs.existsSync(resolvedAnswerFile)) return result;
      return {
        ...result,
        answer: fs.readFileSync(resolvedAnswerFile, "utf-8"),
      };
    }),
  };
}

function countManifestRecords(projectId: string) {
  validateProjectId(projectId);
  const manifestPath = safeDataPath("manifests", `${projectId}_announcements.jsonl`);
  if (!fs.existsSync(manifestPath)) {
    return {
      manifestPath,
      total: 0,
      discovered: 0,
      excluded: 0,
      required: 0,
      downloaded: 0,
      uploaded: 0,
      ready: 0,
      failed: 0,
      filtered: 0,
    };
  }

  const records = fs
    .readFileSync(manifestPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(safeParseJsonLine)
    .filter((record): record is Record<string, unknown> => record !== null);

  const discovered = records.length;
  const excluded = records.filter((record) => record.download_status === "skipped_filter").length;
  const required = records.filter(
    (record) =>
      String(record.download_status || "") !== "skipped_filter" &&
      String(record.download_status || "") !== "skipped_duplicate",
  ).length;
  const downloaded = records.filter((record) =>
    ["downloaded", "skipped_existing_source"].includes(String(record.download_status || "")),
  ).length;
  const uploaded = records.filter((record) =>
    ["uploaded", "skipped_existing_source"].includes(String(record.upload_status || "")),
  ).length;
  const ready = records.filter(
    (record) =>
      String(record.upload_status || "") === "uploaded" && (record.source_id || record.notebook_id),
  ).length;
  const failed = records.filter(
    (record) =>
      String(record.download_status || "").startsWith("download_failed") ||
      record.download_status === "failed" ||
      String(record.upload_status || "") === "upload_failed",
  ).length;

  return {
    manifestPath,
    total: discovered,
    discovered,
    excluded,
    required,
    downloaded,
    uploaded,
    ready,
    failed,
    filtered: excluded,
  };
}

function buildSourceDetails(projectId: string) {
  const rows = readManifestRows(projectId);
  const requiredRows = rows.filter(
    (row) =>
      row.download_status !== "skipped_filter" && row.download_status !== "skipped_duplicate",
  );
  const readyRows = requiredRows.filter((row) =>
    ["uploaded", "skipped_existing_source"].includes(String(row.upload_status || "")),
  );
  const missingRows = requiredRows.filter(
    (row) => !["uploaded", "skipped_existing_source"].includes(String(row.upload_status || "")),
  );

  return {
    required: requiredRows.length,
    ready: readyRows.length,
    missing: missingRows.length,
    records: rows.map((row, index) => ({
      id: String(row.announcement_id || row.id || `${projectId}-${index}`),
      title: String(row.title || ""),
      date: String(row.date || ""),
      announcementType: String(row.announcement_type || ""),
      sourceLayer: String(row.source_layer || ""),
      downloadStatus: String(row.download_status || ""),
      uploadStatus: String(row.upload_status || ""),
      readyStatus: String(row.ready_status || ""),
      notebookId: String(row.notebook_id || ""),
      sourceId: String(row.source_id || ""),
      sourceTitle: String(row.source_title || ""),
      localPath: String(row.local_path || ""),
      errorMessage: String(row.error_message || ""),
    })),
  };
}

function toNumber(val: unknown, fallback: number = 0): number {
  const result = Number(val);
  return Number.isFinite(result) && result >= 0 ? result : fallback;
}

function readManifestRows(projectId: string): Array<Record<string, any>> {
  const manifestPath = safeDataPath("manifests", `${projectId}_announcements.jsonl`);
  if (!fs.existsSync(manifestPath)) return [];
  return fs
    .readFileSync(manifestPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(safeParseJsonLine)
    .filter((record): record is Record<string, unknown> => record !== null);
}

function hasSufficientSources(projectId: string, config: (typeof RUN_MODES)[RunMode]): boolean {
  // Check for a recent source snapshot artifact first
  try {
    const snapshot = db
      .prepare(
        "SELECT meta_json FROM artifacts WHERE project_id = ? AND kind = 'source_snapshot' ORDER BY id DESC LIMIT 1",
      )
      .get(projectId) as { meta_json: string } | undefined;

    if (snapshot) {
      const data = safeParseJsonLine(snapshot.meta_json) ?? {};

      // Validate snapshot fields match current expectations
      // Use strict comparison for all critical fields
      const expectedPeriodicYears = config.periodicYears;
      const expectedRecentLimit = config.recentLimit;

      // Compare periodic years - if different, reject snapshot
      if ((data.periodic_years as number) !== expectedPeriodicYears) {
        return false;
      }

      // Compare recent limit - if different, reject snapshot
      if ((data.recent_limit as number) !== expectedRecentLimit) {
        return false;
      }

      // Check source completeness
      const hasPeriodic = (data.periodic_ready as number) >= (data.periodic_expected as number);
      const hasRecent =
        config.recentLimit === 0
          ? true
          : (data.recent_ready as number) >= (data.recent_expected as number);
      const noFailed = (data.failed_count as number) === 0;

      return hasPeriodic && hasRecent && noFailed;
    }
  } catch (e) {
    // Snapshot parsing failed, fall through to manifest-based check
  }

  // Fallback: check manifest records (legacy path)
  const rows = readManifestRows(projectId);
  const readyRows = rows.filter((row) =>
    ["uploaded", "skipped_existing_source"].includes(String(row.upload_status || "")),
  );
  const hasPeriodic = readyRows.some((row) =>
    ["periodic_report_3y", "both"].includes(String(row.source_layer || "")),
  );
  const hasRecent = readyRows.some((row) =>
    ["recent_200", "both"].includes(String(row.source_layer || "")),
  );
  if (config.recentLimit > 0) return hasPeriodic && hasRecent;
  return hasPeriodic;
}

function getReportPath(projectId: string) {
  validateProjectId(projectId);
  return safeDataPath("reports", `${projectId}_dd_report.md`);
}

function getAnswersDir(projectId: string) {
  validateProjectId(projectId);
  return safeDataPath("answers", projectId);
}

function getRunLogPath(projectId: string) {
  validateProjectId(projectId);
  return safeDataPath("logs", `${projectId}_latest.log`);
}

function resetRunArtifacts(projectId: string, restartQuestions: boolean) {
  const reportPath = getReportPath(projectId);
  if (fs.existsSync(reportPath)) fs.rmSync(reportPath, { force: true });
  if (restartQuestions) {
    const answersDir = getAnswersDir(projectId);
    if (fs.existsSync(answersDir)) fs.rmSync(answersDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(getRunLogPath(projectId)), { recursive: true });
  fs.writeFileSync(getRunLogPath(projectId), "", "utf-8");
}

function readRunLog(projectId: string) {
  const logPath = getRunLogPath(projectId);
  if (!fs.existsSync(logPath)) return { path: logPath, content: "" };
  const content = fs.readFileSync(logPath, "utf-8");
  return {
    path: logPath,
    content: content.length > 20000 ? content.slice(-20000) : content,
  };
}

function buildProjectStatus(project: NonNullable<ReturnType<typeof getProject>>) {
  const answersDir = safeDataPath("answers", project.id);
  const answersManifestPath = path.join(answersDir, "answers_manifest.json");
  const reportPath = getReportPath(project.id);
  const answersManifest = fs.existsSync(answersManifestPath) ? readJSON(answersManifestPath) : null;
  const sourceStats = countManifestRecords(project.id);
  const sourceDetails = buildSourceDetails(project.id);
  const runLog = readRunLog(project.id);

  return {
    projectId: project.id,
    project,
    sourceStats,
    sourceDetails,
    answersManifest: answersManifest ? attachAnswerContent(answersManifest) : null,
    runLog,
    reportPath: fs.existsSync(reportPath) ? reportPath : project.reportPath || "",
    hasReport: fs.existsSync(reportPath) || Boolean(project.reportPath),
  };
}

function getQuestionMethodForRound(projectId: string, roundId: string): QuestionMethod {
  const manifestPath = path.join(getAnswersDir(projectId), "answers_manifest.json");
  const manifest = fs.existsSync(manifestPath) ? readJSON(manifestPath) : null;
  const results = Array.isArray(manifest?.results) ? manifest.results : [];
  const result = results.find(
    (item) =>
      item && typeof item === "object" && (item as Record<string, unknown>).round_id === roundId,
  ) as Record<string, unknown> | undefined;
  return result?.question_method === "report" ? "report" : "chat";
}

aiddaRouter.get("/projects", (_req: Request, res: Response) => {
  res.json({ projects: listProjects() });
});

aiddaRouter.get("/question-rounds", (_req: Request, res: Response) => {
  res.json({ questions: readQuestionRounds() });
});

aiddaRouter.put("/question-rounds", (req: Request, res: Response) => {
  const incoming = Array.isArray(req.body?.questions) ? req.body.questions : null;
  if (!incoming) throw new AppError("questions 必须是数组", 400);

  const existing = readQuestionRounds();
  const existingById = new Map(existing.map((round) => [round.round_id, round]));
  const normalized = incoming.map((item: Record<string, unknown>, index: number) => {
    const roundId = String(item.round_id || item.id || "").trim();
    const previous = existingById.get(roundId);
    const prompt = String(item.prompt || "").trim();
    const roundName = String(item.round_name || item.title || "").trim();

    if (!roundId) throw new AppError(`第 ${index + 1} 个问题缺少 round_id`, 400);
    if (!roundName) throw new AppError(`第 ${index + 1} 个问题标题不能为空`, 400);
    if (!prompt) throw new AppError(`第 ${index + 1} 个问题内容不能为空`, 400);

    return {
      ...(previous || {}),
      round_id: roundId,
      round_no: index,
      round_name: roundName,
      target_sections: Array.isArray(previous?.target_sections) ? previous.target_sections : [],
      prompt,
      question_method:
        item.question_method === "report" || previous?.question_method === "report"
          ? "report"
          : "chat",
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
    };
  });

  writeQuestionRounds(normalized);
  res.json({ questions: normalized, path: QUESTION_ROUNDS_PATH });
});

aiddaRouter.get("/announcement-filters", (_req: Request, res: Response) => {
  res.json({ terms: readAnnouncementFilters(), path: ANNOUNCEMENT_FILTERS_PATH });
});

aiddaRouter.put("/announcement-filters", (req: Request, res: Response) => {
  const rawTerms = Array.isArray(req.body?.terms)
    ? req.body.terms
    : String(req.body?.text || "")
        .replace(/，/g, ",")
        .split(/[\n,]/);
  const terms = rawTerms.map((term: unknown) => String(term).trim()).filter(Boolean);
  res.json({ terms: writeAnnouncementFilters(terms), path: ANNOUNCEMENT_FILTERS_PATH });
});

aiddaRouter.get("/projects/:id/status", (req: Request, res: Response) => {
  validateProjectId(req.params.id);
  const project = getProject(req.params.id);
  if (!project) throw new AppError("项目不存在", 404);
  res.json({ status: buildProjectStatus(project) });
});

aiddaRouter.get("/projects/:id/report", (req: Request, res: Response) => {
  validateProjectId(req.params.id);
  const reportPath = safeDataPath("reports", `${req.params.id}_dd_report.md`);
  if (!fs.existsSync(reportPath)) throw new AppError("报告不存在", 404);
  res.json({ content: fs.readFileSync(reportPath, "utf-8"), path: reportPath });
});

/**
 * 安全清理项目关联的本地文件。
 * 只允许在 DATA_DIR 下的指定子目录操作，防止路径穿越。
 */
function cleanProjectFiles(projectId: string): boolean {
  validateProjectId(projectId);
  const dataRoot = path.resolve(DATA_DIR);
  const dirsToClean = [
    safeDataPath("pdfs", projectId),
    safeDataPath("manifests", `${projectId}_announcements.jsonl`),
    safeDataPath("answers", projectId),
    safeDataPath("reports", `${projectId}_dd_report.md`),
    safeDataPath("logs", `${projectId}_latest.log`),
  ];

  let allSucceeded = true;
  for (const dir of dirsToClean) {
    try {
      const realPath = path.resolve(dir);
      // 确保清理目标在 DATA_DIR 下（防御性校验）
      if (realPath !== dataRoot && !realPath.startsWith(dataRoot + path.sep)) {
        console.warn(`跳过路径穿透检查: ${dir} for project ${projectId}`);
        continue;
      }
      if (fs.existsSync(dir)) {
        if (fs.statSync(dir).isDirectory()) {
          fs.rmSync(dir, { recursive: true, force: true });
        } else {
          fs.unlinkSync(dir);
        }
      }
    } catch (err) {
      console.error(`清理文件失败 ${dir}: ${err}`);
      allSucceeded = false;
    }
  }

  return allSucceeded;
}

aiddaRouter.delete("/projects/:id", (req: Request, res: Response) => {
  validateProjectId(req.params.id);
  const projectId = req.params.id;
  const deleteFiles = req.query.deleteFiles === "true"; // 支持 ?deleteFiles=true 清理本地文件

  const project = getProject(projectId);
  if (!project) {
    // 项目不存在，但仍需清理相关的数据库记录（若存在）
    db.prepare("DELETE FROM jobs WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM artifacts WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM source_mappings WHERE project_id = ?").run(projectId);
    if (deleteFiles) {
      // 即使项目不存在，也尝试清理相关文件（幂等操作）
      cleanProjectFiles(projectId);
    }
    res.json({ ok: true });
    return;
  }

  // 不允许删除运行中的项目
  if (["downloading", "uploading", "querying", "synthesizing"].includes(project.status)) {
    res.status(409).json({ error: "项目正在运行中，无法删除。请等待任务完成或失败后再试。" });
    return;
  }

  // 先清理文件（如果请求），再删除数据库记录
  let cleanupSuccess = true;
  if (deleteFiles) {
    cleanupSuccess = cleanProjectFiles(projectId);
  }

  // 删除数据库记录
  db.prepare("DELETE FROM jobs WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM artifacts WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM source_mappings WHERE project_id = ?").run(projectId);
  deleteProject(projectId);

  if (cleanupSuccess) {
    res.json({ ok: true, message: deleteFiles ? "项目及本地数据已删除" : "项目已删除" });
  } else {
    res.status(200).json({
      ok: true,
      message: deleteFiles ? "项目已删除，但部分本地文件清理失败" : "项目已删除",
      warning: "请手动清理剩余文件",
    });
  }
});

aiddaRouter.post(
  "/projects",
  asyncHandler(async (req: Request, res: Response) => {
    const stockCode = String(req.body?.stockCode || "")
      .trim()
      .toUpperCase();
    if (!stockCode || !/^\d{6}$/.test(stockCode)) {
      throw new AppError("股票代码必须是六位数字", 400);
    }

    const { stdout } = await runPythonScript(
      "notebooklm_create_project.py",
      ["--stock-code", stockCode],
      false,
    );
    const payload = parseLastJSON(stdout);
    if (!payload) throw new AppError("项目创建输出无法解析", 500, "PARSE_ERROR");

    const projectId = typeof payload.project_id === "string" ? payload.project_id : "";
    validateProjectId(projectId);
    const project = upsertProject({
      id: projectId,
      name: payload.project_name as string,
      stockCode: payload.stock_code as string,
      stockName: payload.stock_name as string,
      notebookId: payload.notebook_id as string,
      notebookTitle: payload.notebook_title as string,
      status: "idle",
      currentStep: 0,
      meta: {
        source: "notebooklm_create_project.py",
        notebookSourceCount: payload.notebook_source_count || 0,
      },
    });

    res.json({ project, raw: payload });
  }),
);

aiddaRouter.post("/projects/:id/run", (req: Request, res: Response) => {
  validateProjectId(req.params.id);
  const project = getProject(req.params.id);
  if (!project) throw new AppError("项目不存在", 404);
  if (!project.stockCode || !project.notebookId) {
    throw new AppError("项目缺少股票代码或 NotebookLM 笔记 ID", 400);
  }

  const mode = String(req.body?.mode || "standard") as RunMode;
  const questionMethod = String(req.body?.questionMethod || "chat") as QuestionMethod;
  const restartQuestions = Boolean(req.body?.restartQuestions);
  const config = RUN_MODES[mode] || RUN_MODES.standard;
  const method = questionMethod === "report" ? "report" : "chat";

  // CAS 运行锁
  const jobId = tryStartProjectJob(project.id, `run_${mode}_${method}`);
  if (jobId === null) {
    res.status(409).json({ error: "该项目已有任务运行中，请等待当前任务完成或失败后再试。" });
    return;
  }

  resetRunArtifacts(project.id, restartQuestions);

  updateProject(project.id, {
    status: "downloading",
    currentStep: 1,
    reportPath: "",
    error: null,
  });

  runDueDiligence(project, config, jobId, restartQuestions, method).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "尽调任务失败";
    updateProject(project.id, { status: "failed", error: message });
    finishJob(jobId, "failed", "", message);
  });

  res.status(202).json({
    message: `${config.label}尽调任务已启动`,
    jobId,
    project: getProject(project.id),
    mode,
    questionMethod: method,
    config,
  });
});

aiddaRouter.post("/projects/:id/question-rounds/:roundId/retry", (req: Request, res: Response) => {
  validateProjectId(req.params.id);
  const project = getProject(req.params.id);
  if (!project) throw new AppError("项目不存在", 404);
  if (!project.stockCode || !project.notebookId) {
    throw new AppError("项目缺少股票代码或 NotebookLM 笔记 ID", 400);
  }

  // 不允许在已有任务运行时重试
  if (["downloading", "uploading", "querying", "synthesizing"].includes(project.status)) {
    res.status(409).json({ error: "该项目已有任务运行中，无法重试。" });
    return;
  }

  const roundId = String(req.params.roundId || "").trim();
  const question = readQuestionRounds().find((item) => item.round_id === roundId);
  if (!question) throw new AppError("问题不存在", 404);

  // CAS 运行锁（重试也需独占项目）
  const jobId = tryStartProjectJob(project.id, `retry_round_${roundId}`);
  if (jobId === null) {
    res.status(409).json({ error: "该项目已有任务运行中，请等待当前任务完成或失败后再试。" });
    return;
  }

  resetSingleQuestionArtifacts(project.id, roundId);

  updateProject(project.id, {
    status: "querying",
    currentStep: 2,
    reportPath: "",
    error: null,
  });

  const questionMethod = getQuestionMethodForRound(project.id, roundId);

  retryQuestionRound(project, roundId, jobId, questionMethod).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "单题重试失败";
    updateProject(project.id, { status: "failed", error: message });
    finishJob(jobId, "failed", "", message);
  });

  res.status(202).json({
    message: `已启动单题重试：${question.round_name}`,
    jobId,
    project: getProject(project.id),
    roundId,
    questionMethod,
  });
});

aiddaRouter.get(
  "/notebooklm/status",
  asyncHandler(async (_req: Request, res: Response) => {
    const jobId = createJob(null, "notebooklm_status");
    try {
      const { stdout } = await runPythonScript("notebooklm_auth_status.py", [], false);
      const status = parseLastJSON(stdout);
      finishJob(jobId, "completed", stdout);
      res.json({ status, output: stdout });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "NotebookLM 登录状态检查失败";
      finishJob(jobId, "failed", "", message);
      res.status(200).json({
        status: {
          status: "auth_failed",
          authenticated: false,
          message,
        },
      });
    }
  }),
);

// ── Source Mappings API (authenticated) ─────────────────────────────────────────

aiddaRouter.get(
  "/projects/:id/source-mappings",
  asyncHandler(async (req: Request, res: Response) => {
    validateProjectId(req.params.id);
    const project = getProject(req.params.id);
    if (!project) throw new AppError("项目不存在", 404);

    const mappings = getSourceMappingsByProject(project.id);
    res.json(mappings);
  }),
);

aiddaRouter.get(
  "/projects/:id/source-mappings/count",
  asyncHandler(async (req: Request, res: Response) => {
    validateProjectId(req.params.id);
    const project = getProject(req.params.id);
    if (!project) throw new AppError("项目不存在", 404);

    // Count mappings by announcement_id and sha256 combined
    const mappings = getSourceMappingsByProject(project.id);
    const announcementCount = mappings.filter((m) => m.announcementId).length;
    const sha256Count = mappings.filter((m) => m.sha256).length;
    const uniqueCount = mappings.length;

    res.json({
      project_id: project.id,
      total_mappings: uniqueCount,
      by_announcement_id: announcementCount,
      by_sha256: sha256Count,
    });
  }),
);

async function runDueDiligence(
  project: NonNullable<ReturnType<typeof getProject>>,
  config: (typeof RUN_MODES)[RunMode],
  jobId: number,
  restartQuestions: boolean,
  questionMethod: QuestionMethod,
) {
  const logPath = getRunLogPath(project.id);
  let download = { stdout: "", stderr: "" };
  let downloadSummary: Record<string, unknown> | null = null;

  if (hasSufficientSources(project.id, config)) {
    fs.appendFileSync(logPath, "[skip] NotebookLM 已有足够附件，跳过公告下载与上传。\n", "utf-8");
  } else {
    download = await runPythonScriptLogged(
      "download_upload_aidda_project.py",
      [
        "--project-id",
        project.id,
        "--stock-code",
        project.stockCode,
        "--notebook-id",
        project.notebookId,
        "--periodic-years",
        String(config.periodicYears),
        "--recent-limit",
        String(config.recentLimit),
        "--exclude-title-keywords",
        readAnnouncementFilters().join(","),
        "--wait-ready",
      ],
      logPath,
    );
    downloadSummary = parseLastJSON(download.stdout);

    if (!downloadSummary) {
      throw new AppError(
        "公告下载脚本未返回有效 JSON 摘要",
        500,
        "DOWNLOAD_SUMMARY_INVALID",
      );
    }
  }

  const sourceStats = countManifestRecords(project.id);
  updateProject(project.id, {
    status: "querying",
    currentStep: 2,
    manifestPath:
      typeof downloadSummary?.manifest_path === "string"
        ? safeDataPath(downloadSummary.manifest_path)
        : safeDataPath("manifests", `${project.id}_announcements.jsonl`),
    pdfDir:
      typeof downloadSummary?.pdf_dir === "string"
        ? safeDataPath(downloadSummary.pdf_dir)
        : safeDataPath("pdfs", project.id),
    downloadSuccess:
      typeof downloadSummary?.download_success === "number"
        ? downloadSummary.download_success
        : sourceStats.downloaded,
    uploadSuccess:
      typeof downloadSummary?.upload_success === "number"
        ? downloadSummary.upload_success
        : sourceStats.uploaded,
    error: null,
  });

  let periodicReady = 0,
    periodicExpected = 0,
    recentReady = 0,
    recentExpected = 0,
    failedCount = 0;

  if (downloadSummary) {
    periodicReady = toNumber(downloadSummary.periodic_ready);
    periodicExpected = toNumber(downloadSummary.periodic_expected);
    recentReady = toNumber(downloadSummary.recent_ready);
    recentExpected = toNumber(downloadSummary.recent_expected);
    failedCount = toNumber(downloadSummary.failed_count);
  } else {
    try {
      const snap = db
        .prepare(
          "SELECT meta_json FROM artifacts WHERE project_id = ? AND kind = 'source_snapshot' ORDER BY id DESC LIMIT 1",
        )
        .get(project.id) as { meta_json: string } | undefined;
      if (snap) {
        const data = safeParseJsonLine(snap.meta_json) ?? {};
        periodicReady = toNumber(data.periodic_ready ?? 0);
        periodicExpected = toNumber(data.periodic_expected ?? 0);
        recentReady = toNumber(data.recent_ready ?? 0);
        recentExpected = toNumber(data.recent_expected ?? 0);
        failedCount = toNumber(data.failed_count ?? 0);
      }
    } catch {
      /* swallow - snapshot parsing failed, continue with manifest fallback */
    }

    if (periodicReady === 0 && periodicExpected === 0) {
      const rows = readManifestRows(project.id);
      const readyRows = rows.filter((row) =>
        ["uploaded", "skipped_existing_source"].includes(row.upload_status || ""),
      );
      const periodicReadyRows = readyRows.filter((row) =>
        ["periodic_report_3y", "both"].includes(row.source_layer || ""),
      );
      const recentReadyRows = readyRows.filter((row) =>
        ["recent_200", "both"].includes(row.source_layer || ""),
      );
      const downStatuses = rows.map((r) => r.download_status || "");
      const upStatuses = rows.map((r) => r.upload_status || "");
      periodicReady = periodicReadyRows.length;
      periodicExpected = periodicReadyRows.length ? periodicReadyRows.length : 0;
      recentReady = recentReadyRows.length;
      recentExpected = recentReadyRows.length ? recentReadyRows.length : 0;
      failedCount =
        downStatuses.filter((s) => s.startsWith("download_failed") || s === "failed").length +
        upStatuses.filter((s) => s === "upload_failed").length;
    }
  }

  const completeness = evaluateSourceCompleteness({
    periodicReady,
    periodicExpected,
    recentReady,
    recentExpected,
    failedCount,
    recentLimit: config.recentLimit,
  });

  fs.appendFileSync(logPath, "[SOURCE] " + completeness.message + "\n", "utf-8");

  if (!completeness.complete) {
    const errorMsg =
      "来源完整性不达标：periodic=" +
      periodicReady +
      "/" +
      periodicExpected +
      ", recent=" +
      recentReady +
      "/" +
      recentExpected +
      ", failed=" +
      failedCount;
    fs.appendFileSync(logPath, "[BLOCKED] " + errorMsg + "\n", "utf-8");
    updateProject(project.id, { status: "failed", currentStep: 2, error: errorMsg });
    finishJob(jobId, "failed", "", errorMsg);
    throw new AppError(errorMsg, 409, "SOURCE_INCOMPLETE");
  }

  if (downloadSummary) {
    try {
      db.prepare(
        "INSERT INTO artifacts (project_id, kind, title, status, meta_json) VALUES (?, ?, ?, ?, ?)",
      ).run(
        project.id,
        "source_snapshot",
        "snapshot_" + Date.now(),
        "completed",
        JSON.stringify({
          periodic_expected: toNumber(downloadSummary.periodic_expected ?? 0),
          periodic_ready: toNumber(downloadSummary.periodic_ready ?? 0),
          recent_expected: toNumber(downloadSummary.recent_expected ?? 0),
          recent_ready: toNumber(downloadSummary.recent_ready ?? 0),
          failed_count: toNumber(downloadSummary.failed_count ?? 0),
        }),
      );
    } catch {
      /* swallow - snapshot insertion failed, continue */
    }
  }

  const report = await runPythonScriptLogged(
    "run_aidda_project.py",
    [
      "--project-name",
      project.name,
      "--stock-code",
      project.stockCode,
      "--stock-name",
      project.stockName || "",
      "--project-id",
      project.id,
      "--notebook-id",
      project.notebookId,
      "--skip-download",
      "--skip-upload",
      "--max-question-rounds",
      String(config.maxQuestionRounds),
      "--question-method",
      questionMethod,
      ...(restartQuestions ? ["--force-questions"] : []),
    ],
    logPath,
  );

  const reportPath = getReportPath(project.id);
  updateProject(project.id, {
    status: "completed",
    currentStep: 3,
    reportPath: fs.existsSync(reportPath) ? reportPath : "",
    error: null,
  });
  finishJob(jobId, "completed", download.stdout + "\n" + report.stdout);
}

function resetSingleQuestionArtifacts(projectId: string, roundId: string) {
  const reportPath = getReportPath(projectId);
  if (fs.existsSync(reportPath)) fs.rmSync(reportPath, { force: true });
  const answerPath = path.join(getAnswersDir(projectId), `${roundId}.md`);
  if (fs.existsSync(answerPath)) fs.rmSync(answerPath, { force: true });
  fs.mkdirSync(path.dirname(getRunLogPath(projectId)), { recursive: true });
  fs.writeFileSync(getRunLogPath(projectId), "", "utf-8");
}

async function retryQuestionRound(
  project: NonNullable<ReturnType<typeof getProject>>,
  roundId: string,
  jobId: number,
  questionMethod: QuestionMethod,
) {
  const logPath = getRunLogPath(project.id);
  const report = await runPythonScriptLogged(
    "run_aidda_project.py",
    [
      "--project-name",
      project.name,
      "--stock-code",
      project.stockCode,
      "--stock-name",
      project.stockName || "",
      "--project-id",
      project.id,
      "--notebook-id",
      project.notebookId,
      "--skip-download",
      "--skip-upload",
      "--round-ids",
      roundId,
      "--force-questions",
      "--question-method",
      questionMethod,
    ],
    logPath,
  );

  const reportPath = getReportPath(project.id);
  updateProject(project.id, {
    status: "completed",
    currentStep: 3,
    reportPath: fs.existsSync(reportPath) ? reportPath : "",
    error: null,
  });
  finishJob(jobId, "completed", report.stdout);
}
