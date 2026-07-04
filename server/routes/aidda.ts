import { Router } from "express";
import fs from "fs";
import path from "path";
import {
  DATA_DIR,
  createJob,
  deleteProject,
  finishJob,
  getJob,
  getProject,
  listJobs,
  listProjects,
  updateProject,
  upsertProject,
} from "../db.ts";
import { parseLastJSON, runPythonScript } from "../python.ts";

export const aiddaRouter = Router();

function readJSON(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

aiddaRouter.get("/projects", (_req, res) => {
  res.json({ projects: listProjects() });
});

aiddaRouter.get("/projects/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: "项目不存在" });
  }
  res.json({ project });
});

aiddaRouter.delete("/projects/:id", (req, res) => {
  deleteProject(req.params.id);
  res.json({ ok: true });
});

aiddaRouter.get("/jobs/:id", (req, res) => {
  const job = getJob(Number(req.params.id));
  if (!job) {
    return res.status(404).json({ error: "任务不存在" });
  }
  res.json({ job });
});

aiddaRouter.post("/projects", async (req, res) => {
  const jobId = createJob(null, "create_project");
  try {
    const { stockCode, projectName = "", stockName = "" } = req.body;
    if (!stockCode) {
      finishJob(jobId, "failed", "", "股票代码不能为空");
      return res.status(400).json({ error: "股票代码不能为空" });
    }

    const { stdout } = await runPythonScript("notebooklm_create_project.py", [
      "--stock-code",
      stockCode,
      "--project-name",
      projectName,
      "--stock-name",
      stockName,
    ]);
    const payload = parseLastJSON(stdout);
    if (!payload) {
      finishJob(jobId, "failed", stdout, "项目创建输出无法解析");
      return res.status(500).json({ error: "项目创建输出无法解析", output: stdout });
    }

    const project = upsertProject({
      id: payload.project_id,
      name: payload.project_name,
      stockCode: payload.stock_code,
      stockName: payload.stock_name,
      notebookId: payload.notebook_id,
      notebookTitle: payload.notebook_title,
      status: "idle",
      currentStep: 0,
      meta: { source: "notebooklm_create_project.py" },
    });

    finishJob(jobId, "completed", stdout);
    res.json({ project: payload, record: project, output: stdout });
  } catch (error: any) {
    finishJob(jobId, "failed", "", error.message || "项目创建失败");
    res.status(500).json({ error: error.message || "项目创建失败" });
  }
});

aiddaRouter.post("/projects/:id/download-and-upload", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: "项目不存在" });
  }

  const jobId = createJob(project.id, "download_and_upload");
  updateProject(project.id, { status: "downloading", currentStep: 1, error: null });

  try {
    const {
      stockCode = project.stockCode,
      notebookId = project.notebookId,
      periodicYears = 3,
      recentLimit = 200,
    } = req.body;

    if (!stockCode || !notebookId) {
      throw new Error("stockCode 和 notebookId 不能为空");
    }

    runPythonScript("download_upload_aidda_project.py", [
      "--project-id",
      project.id,
      "--stock-code",
      stockCode,
      "--notebook-id",
      notebookId,
      "--periodic-years",
      String(periodicYears),
      "--recent-limit",
      String(recentLimit),
      "--wait-ready",
    ])
      .then(({ stdout }) => {
        const summary = parseLastJSON(stdout);
        updateProject(project.id, {
          status: "idle",
          currentStep: 1,
          manifestPath: summary?.manifest_path || "",
          pdfDir: summary?.pdf_dir || "",
          downloadSuccess: summary?.download_success || 0,
          uploadSuccess: summary?.upload_success || 0,
          error: null,
        });
        finishJob(jobId, "completed", stdout);
      })
      .catch((error: any) => {
        updateProject(project.id, {
          status: "failed",
          error: error.message || "公告下载与上传失败",
        });
        finishJob(jobId, "failed", "", error.message || "公告下载与上传失败");
      });

    res.status(202).json({
      message: "公告下载与 NotebookLM 上传任务已启动",
      jobId,
      project: getProject(project.id),
    });
  } catch (error: any) {
    updateProject(project.id, { status: "failed", error: error.message || "公告下载与上传失败" });
    finishJob(jobId, "failed", "", error.message || "公告下载与上传失败");
    res.status(500).json({ error: error.message || "公告下载与上传失败" });
  }
});

aiddaRouter.get("/notebooklm/status", async (_req, res) => {
  const jobId = createJob(null, "notebooklm_status");
  try {
    const { stdout } = await runPythonScript("notebooklm_auth_status.py");
    const status = parseLastJSON(stdout);
    finishJob(jobId, "completed", stdout);
    res.json({ status, output: stdout });
  } catch (error: any) {
    finishJob(jobId, "failed", "", error.message || "NotebookLM 登录状态检查失败");
    res.status(200).json({
      status: {
        status: "auth_failed",
        authenticated: false,
        message: error.message || "NotebookLM 登录状态检查失败",
      },
    });
  }
});

aiddaRouter.post("/projects/:id/compose-report", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: "项目不存在" });
  }

  const jobId = createJob(project.id, "compose_report");
  updateProject(project.id, { status: "querying", currentStep: 2, error: null });

  try {
    const {
      projectName = project.name,
      stockCode = project.stockCode,
      stockName = project.stockName,
      notebookId = project.notebookId,
    } = req.body;

    if (!stockCode || !notebookId) {
      throw new Error("stockCode 和 notebookId 不能为空");
    }

    runPythonScript("run_aidda_project.py", [
      "--project-name",
      projectName,
      "--stock-code",
      stockCode,
      "--stock-name",
      stockName || "",
      "--project-id",
      project.id,
      "--notebook-id",
      notebookId,
      "--skip-download",
      "--skip-upload",
    ])
      .then(({ stdout }) => {
        const reportDir = path.join(DATA_DIR, "reports");
        const files = fs.existsSync(reportDir)
          ? fs.readdirSync(reportDir).filter((f) => f.startsWith(project.id) && f.endsWith(".md"))
          : [];

        const reportPath = files.length > 0 ? path.join(reportDir, files[0]) : "";
        updateProject(project.id, {
          status: "completed",
          currentStep: 3,
          reportPath,
          error: null,
        });
        finishJob(jobId, "completed", stdout);
      })
      .catch((error: any) => {
        updateProject(project.id, { status: "failed", error: error.message || "报告生成失败" });
        finishJob(jobId, "failed", "", error.message || "报告生成失败");
      });

    res.status(202).json({ message: "报告生成任务已启动", jobId, project: getProject(project.id) });
  } catch (error: any) {
    updateProject(project.id, { status: "failed", error: error.message || "报告生成失败" });
    finishJob(jobId, "failed", "", error.message || "报告生成失败");
    res.status(500).json({ error: error.message || "报告生成失败" });
  }
});

aiddaRouter.get("/projects/:id/status", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: "项目不存在" });
  }

  const status: any = {
    projectId: project.id,
    project,
    jobs: listJobs(project.id),
    downloadStatus: "unknown",
    uploadStatus: "unknown",
    questionStatus: "unknown",
    reportStatus: "unknown",
  };

  const manifestPath = path.join(DATA_DIR, "manifests", `${project.id}_announcements.jsonl`);
  if (fs.existsSync(manifestPath)) {
    status.downloadStatus = "completed";
    status.manifestPath = manifestPath;
  }

  const answersDir = path.join(DATA_DIR, "answers", project.id);
  if (fs.existsSync(answersDir)) {
    const answerFiles = fs.readdirSync(answersDir).filter((f) => f.endsWith(".md"));
    if (answerFiles.length > 0) {
      status.questionStatus = "completed";
      status.answerCount = answerFiles.length;
      status.answersDir = answersDir;
    }
    const answersManifestPath = path.join(answersDir, "answers_manifest.json");
    if (fs.existsSync(answersManifestPath)) {
      status.answersManifest = readJSON(answersManifestPath);
    }
  }

  const reportPath = path.join(DATA_DIR, "reports", `${project.id}_dd_report.md`);
  if (fs.existsSync(reportPath)) {
    status.reportStatus = "completed";
    status.reportPath = reportPath;
  }

  res.json({ status });
});

aiddaRouter.get("/projects/:id/manifest", (req, res) => {
  const manifestPath = path.join(DATA_DIR, "manifests", `${req.params.id}_announcements.jsonl`);
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: "manifest 不存在", path: manifestPath });
  }
  const lines = fs.readFileSync(manifestPath, "utf-8").trim().split("\n").filter(Boolean);
  const records = lines.map((line) => JSON.parse(line));
  res.json({ records, total: records.length });
});

aiddaRouter.get("/projects/:id/report", (req, res) => {
  const reportPath = path.join(DATA_DIR, "reports", `${req.params.id}_dd_report.md`);
  if (!fs.existsSync(reportPath)) {
    return res.status(404).json({ error: "报告不存在" });
  }
  res.json({ content: fs.readFileSync(reportPath, "utf-8"), path: reportPath });
});
