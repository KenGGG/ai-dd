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
  deleteProject,
  finishJob,
  getProject,
  listProjects,
  upsertProject,
  updateProject,
} from "../db.ts";
import { parseLastJSON, runPythonScript } from "../python.ts";
import { runPythonScriptLogged } from "../python.ts";
import { AppError, asyncHandler } from "../middleware/error-handler.ts";

export const aiddaRouter = Router();

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
      if (!answerFile || !fs.existsSync(answerFile)) return result;
      return {
        ...result,
        answer: fs.readFileSync(answerFile, "utf-8"),
      };
    }),
  };
}

function countManifestRecords(projectId: string) {
  const manifestPath = path.join(DATA_DIR, "manifests", `${projectId}_announcements.jsonl`);
  if (!fs.existsSync(manifestPath)) {
    return { manifestPath, total: 0, downloaded: 0, uploaded: 0, failed: 0, filtered: 0 };
  }

  const records = fs
    .readFileSync(manifestPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return {
    manifestPath,
    total: records.length,
    downloaded: records.filter((record) =>
      ["downloaded", "skipped_existing_source"].includes(record.download_status),
    ).length,
    uploaded: records.filter((record) =>
      ["uploaded", "skipped_existing_source"].includes(record.upload_status),
    ).length,
    filtered: records.filter((record) => record.download_status === "skipped_filter").length,
    failed: records.filter(
      (record) =>
        String(record.download_status || "").startsWith("download_failed") ||
        record.download_status === "failed" ||
        record.upload_status === "upload_failed",
    ).length,
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

function readManifestRows(projectId: string): Array<Record<string, any>> {
  const manifestPath = path.join(DATA_DIR, "manifests", `${projectId}_announcements.jsonl`);
  if (!fs.existsSync(manifestPath)) return [];
  return fs
    .readFileSync(manifestPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function hasSufficientSources(projectId: string, config: (typeof RUN_MODES)[RunMode]) {
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
  return path.join(DATA_DIR, "reports", `${projectId}_dd_report.md`);
}

function getAnswersDir(projectId: string) {
  return path.join(DATA_DIR, "answers", projectId);
}

function getRunLogPath(projectId: string) {
  return path.join(DATA_DIR, "logs", `${projectId}_latest.log`);
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
  const answersDir = path.join(DATA_DIR, "answers", project.id);
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
  const project = getProject(req.params.id);
  if (!project) throw new AppError("项目不存在", 404);
  res.json({ status: buildProjectStatus(project) });
});

aiddaRouter.get("/projects/:id/report", (req: Request, res: Response) => {
  const reportPath = path.join(DATA_DIR, "reports", `${req.params.id}_dd_report.md`);
  if (!fs.existsSync(reportPath)) throw new AppError("报告不存在", 404);
  res.json({ content: fs.readFileSync(reportPath, "utf-8"), path: reportPath });
});

aiddaRouter.delete("/projects/:id", (req: Request, res: Response) => {
  deleteProject(req.params.id);
  res.json({ ok: true });
});

aiddaRouter.post(
  "/projects",
  asyncHandler(async (req: Request, res: Response) => {
    const stockCode = String(req.body?.stockCode || "")
      .trim()
      .toUpperCase();
    if (!stockCode) throw new AppError("股票代码不能为空", 400);

    const { stdout } = await runPythonScript("notebooklm_create_project.py", [
      "--stock-code",
      stockCode,
    ]);
    const payload = parseLastJSON(stdout);
    if (!payload) throw new AppError("项目创建输出无法解析", 500, "PARSE_ERROR");

    const project = upsertProject({
      id: payload.project_id as string,
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
  const jobId = createJob(project.id, `run_${mode}_${method}`);
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
  const project = getProject(req.params.id);
  if (!project) throw new AppError("项目不存在", 404);
  if (!project.stockCode || !project.notebookId) {
    throw new AppError("项目缺少股票代码或 NotebookLM 笔记 ID", 400);
  }

  const roundId = String(req.params.roundId || "").trim();
  const question = readQuestionRounds().find((item) => item.round_id === roundId);
  if (!question) throw new AppError("问题不存在", 404);

  const jobId = createJob(project.id, `retry_round_${roundId}`);
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
      const { stdout } = await runPythonScript("notebooklm_auth_status.py");
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
  }

  const sourceStats = countManifestRecords(project.id);
  updateProject(project.id, {
    status: "querying",
    currentStep: 2,
    manifestPath:
      typeof downloadSummary?.manifest_path === "string"
        ? downloadSummary.manifest_path
        : path.join(DATA_DIR, "manifests", `${project.id}_announcements.jsonl`),
    pdfDir:
      typeof downloadSummary?.pdf_dir === "string"
        ? downloadSummary.pdf_dir
        : path.join(DATA_DIR, "pdfs", project.id),
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
      ...(questionMethod === "chat" ? ["--max-question-sources", "3"] : []),
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
  finishJob(jobId, "completed", `${download.stdout}\n${report.stdout}`);
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
      ...(questionMethod === "chat" ? ["--max-question-sources", "3"] : []),
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
