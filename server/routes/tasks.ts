/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { DATA_DIR, createJob, finishJob, getJob, getProject, updateProject } from "../db.ts";
import { parseLastJSON, runPythonScript } from "../python.ts";
import { AppError } from "../middleware/error-handler.ts";
import { downloadAndUploadSchema, composeReportSchema, validate } from "../middleware/validate.ts";

export const tasksRouter = Router();

// Job status endpoint
tasksRouter.get("/jobs/:id", (req: Request, res: Response) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId)) {
    throw new AppError("无效的任务 ID", 400);
  }
  const job = getJob(jobId);
  if (!job) {
    throw new AppError("任务不存在", 404);
  }
  res.json({ job });
});

// Download and upload
tasksRouter.post(
  "/projects/:id/download-and-upload",
  validate({ body: downloadAndUploadSchema }),
  async (req: Request, res: Response) => {
    const project = getProject(req.params.id);
    if (!project) {
      throw new AppError("项目不存在", 404);
    }

    const jobId = createJob(project.id, "download_and_upload");
    updateProject(project.id, { status: "downloading", currentStep: 1, error: null });

    try {
      const {
        stockCode = project.stockCode,
        notebookId = project.notebookId,
        periodicYears = 3,
        recentLimit = 200,
      } = req.body as {
        stockCode?: string;
        notebookId?: string;
        periodicYears?: number;
        recentLimit?: number;
      };

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
            manifestPath: typeof summary?.manifest_path === "string" ? summary.manifest_path : "",
            pdfDir: typeof summary?.pdf_dir === "string" ? summary.pdf_dir : "",
            downloadSuccess: typeof summary?.download_success === "number" ? summary.download_success : 0,
            uploadSuccess: typeof summary?.upload_success === "number" ? summary.upload_success : 0,
            error: null,
          });
          finishJob(jobId, "completed", stdout);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "公告下载与上传失败";
          updateProject(project.id, {
            status: "failed",
            error: message,
          });
          finishJob(jobId, "failed", "", message);
        });

      res.status(202).json({
        message: "公告下载与 NotebookLM 上传任务已启动",
        jobId,
        project: getProject(project.id),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "公告下载与上传失败";
      updateProject(project.id, { status: "failed", error: message });
      finishJob(jobId, "failed", "", message);
      res.status(500).json({ error: message });
    }
  },
);

// Compose report
tasksRouter.post(
  "/projects/:id/compose-report",
  validate({ body: composeReportSchema }),
  async (req: Request, res: Response) => {
    const project = getProject(req.params.id);
    if (!project) {
      throw new AppError("项目不存在", 404);
    }

    const jobId = createJob(project.id, "compose_report");
    updateProject(project.id, { status: "querying", currentStep: 2, error: null });

    try {
      const {
        projectName = project.name,
        stockCode = project.stockCode,
        stockName = project.stockName,
        notebookId = project.notebookId,
      } = req.body as {
        projectName?: string;
        stockCode?: string;
        stockName?: string;
        notebookId?: string;
      };

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
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "报告生成失败";
          updateProject(project.id, { status: "failed", error: message });
          finishJob(jobId, "failed", "", message);
        });

      res.status(202).json({ message: "报告生成任务已启动", jobId, project: getProject(project.id) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "报告生成失败";
      updateProject(project.id, { status: "failed", error: message });
      finishJob(jobId, "failed", "", message);
      res.status(500).json({ error: message });
    }
  },
);
